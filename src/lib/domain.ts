/**
 * Domain operations: settings, inventory, bookings, capacity, reminders.
 * All durable data goes through getStore() with explicit indices — no key scans.
 */

import { now } from "./clock.js";
import { getStore } from "./store.js";
import {
  type Booking,
  type BookingStatus,
  type CapacitySnapshot,
  type Settings,
  type TableAllocation,
  type TableType,
  DEFAULT_INVENTORY,
  DEFAULT_SETTINGS,
  BOOKING_WINDOW_DAYS,
} from "./types.js";
import {
  addDays,
  dateKey,
  generateSlots,
  intervalsOverlap,
  toEpoch,
} from "./time-util.js";

// ── Keys & indices ──────────────────────────────────────────────────────────

const K = {
  settings: "settings",
  inventory: "inventory",
  booking: (ref: string) => `booking:${ref}`,
  /** All active (confirmed) booking refs — owner dashboard index. */
  activeRefs: "index:active_refs",
  /** Per-date confirmed booking refs. */
  dateRefs: (date: string) => `index:date:${date}`,
  /** Dates that have at least one booking index entry. */
  dateList: "index:dates",
  /** Per-user booking refs (any status, newest first). */
  userRefs: (userId: number) => `index:user:${userId}`,
  /** Capacity snapshot for a slot. */
  capacity: (date: string, time: string) => `capacity:${date}:${time}`,
  /** Ref counter for deterministic 6-char codes. */
  refCounter: "meta:ref_counter",
  /** Pending reminder booking refs. */
  reminderQueue: "index:reminder_queue",
};

// ── Settings & inventory ────────────────────────────────────────────────────

export async function getSettings(): Promise<Settings> {
  const store = await getStore();
  const s = await store.get<Settings>(K.settings);
  return s ? { ...DEFAULT_SETTINGS, ...s } : { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const store = await getStore();
  await store.set(K.settings, settings);
}

export async function getInventory(): Promise<TableType[]> {
  const store = await getStore();
  const inv = await store.get<TableType[]>(K.inventory);
  return inv && inv.length > 0 ? inv : DEFAULT_INVENTORY.map((t) => ({ ...t }));
}

export async function saveInventory(inv: TableType[]): Promise<void> {
  const store = await getStore();
  await store.set(K.inventory, inv);
}

/** Ensure the caller is (or becomes) the owner. Returns false if another owner exists. */
export async function claimOrCheckOwner(
  userId: number,
  chatId: number,
): Promise<{ ok: true; settings: Settings } | { ok: false; reason: string }> {
  const settings = await getSettings();
  if (settings.owner_user_id == null) {
    settings.owner_user_id = userId;
    settings.owner_chat_id = chatId;
    await saveSettings(settings);
    return { ok: true, settings };
  }
  if (settings.owner_user_id !== userId) {
    return {
      ok: false,
      reason:
        "Only the restaurant owner can use this. If that's you, open this bot from the owner's account.",
    };
  }
  // Refresh chat id if owner re-starts from a new chat.
  if (settings.owner_chat_id !== chatId) {
    settings.owner_chat_id = chatId;
    await saveSettings(settings);
  }
  return { ok: true, settings };
}

// ── Reference codes ─────────────────────────────────────────────────────────

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

async function nextReferenceCode(): Promise<string> {
  const store = await getStore();
  const n = (await store.get<number>(K.refCounter)) ?? 0;
  await store.set(K.refCounter, n + 1);
  // Encode n as 6-char base-32-ish using the alphabet (deterministic, unique).
  let x = n;
  let out = "";
  for (let i = 0; i < 6; i++) {
    out = REF_ALPHABET[x % REF_ALPHABET.length] + out;
    x = Math.floor(x / REF_ALPHABET.length);
  }
  return out;
}

// ── Index helpers ───────────────────────────────────────────────────────────

async function readList(key: string): Promise<string[]> {
  const store = await getStore();
  return (await store.get<string[]>(key)) ?? [];
}

async function writeList(key: string, list: string[]): Promise<void> {
  const store = await getStore();
  if (list.length === 0) await store.del(key);
  else await store.set(key, list);
}

async function addToList(key: string, item: string): Promise<void> {
  const list = await readList(key);
  if (!list.includes(item)) {
    list.push(item);
    await writeList(key, list);
  }
}

async function removeFromList(key: string, item: string): Promise<void> {
  const list = await readList(key);
  const next = list.filter((x) => x !== item);
  await writeList(key, next);
}

// ── Capacity ────────────────────────────────────────────────────────────────

function totalSeats(inv: TableType[]): number {
  return inv.reduce((s, t) => s + t.seats * t.count, 0);
}

function totalTables(inv: TableType[]): number {
  return inv.reduce((s, t) => s + t.count, 0);
}

/**
 * Allocate tables for a party: smallest table type that fits (one table),
 * or multiple of the largest available if needed.
 */
export function allocateTables(
  inv: TableType[],
  partySize: number,
  usedByType: Record<string, number>,
): TableAllocation | null {
  if (partySize < 1) return null;
  // Prefer a single table that fits, smallest first.
  const sorted = [...inv].sort((a, b) => a.seats - b.seats);
  for (const t of sorted) {
    const used = usedByType[t.table_type] ?? 0;
    const free = t.count - used;
    if (free >= 1 && t.seats >= partySize) {
      return { table_type: t.table_type, seats: t.seats, tables: 1 };
    }
  }
  // Fall back: use as many of the largest type as needed.
  const largest = [...inv].sort((a, b) => b.seats - a.seats)[0];
  if (!largest) return null;
  const need = Math.ceil(partySize / largest.seats);
  const used = usedByType[largest.table_type] ?? 0;
  const free = largest.count - used;
  if (free >= need) {
    return {
      table_type: largest.table_type,
      seats: largest.seats * need,
      tables: need,
    };
  }
  return null;
}

/** Bookings that occupy a given slot (overlap sitting duration). */
export async function getOverlappingBookings(
  date: string,
  time: string,
  sittingMinutes: number,
  excludeRef?: string,
): Promise<Booking[]> {
  const refs = await readList(K.dateRefs(date));
  const store = await getStore();
  const slotStart = toEpoch(date, time);
  const out: Booking[] = [];
  for (const ref of refs) {
    if (excludeRef && ref === excludeRef) continue;
    const b = await store.get<Booking>(K.booking(ref));
    if (!b || b.status !== "confirmed") continue;
    if (
      intervalsOverlap(b.datetime, sittingMinutes, slotStart, sittingMinutes)
    ) {
      out.push(b);
    }
  }
  return out;
}

function usedTables(bookings: Booking[]): Record<string, number> {
  const used: Record<string, number> = {};
  for (const b of bookings) {
    const t = b.table_allocation.table_type;
    used[t] = (used[t] ?? 0) + b.table_allocation.tables;
  }
  return used;
}

export async function remainingCapacity(
  date: string,
  time: string,
  opts?: { excludeRef?: string; settings?: Settings; inventory?: TableType[] },
): Promise<CapacitySnapshot> {
  const settings = opts?.settings ?? (await getSettings());
  const inv = opts?.inventory ?? (await getInventory());
  const overlapping = await getOverlappingBookings(
    date,
    time,
    settings.sitting_duration,
    opts?.excludeRef,
  );
  let seatsUsed = 0;
  let tablesUsed = 0;
  for (const b of overlapping) {
    seatsUsed += b.table_allocation.seats;
    tablesUsed += b.table_allocation.tables;
  }
  return {
    date,
    time_slot: time,
    remaining_seats: Math.max(0, totalSeats(inv) - seatsUsed),
    remaining_tables: Math.max(0, totalTables(inv) - tablesUsed),
  };
}

export async function canAccommodate(
  date: string,
  time: string,
  partySize: number,
  excludeRef?: string,
): Promise<{ ok: true; allocation: TableAllocation } | { ok: false }> {
  const settings = await getSettings();
  const inv = await getInventory();
  const slots = generateSlots(
    settings.opening_hours.open,
    settings.opening_hours.close,
    settings.sitting_duration,
  );
  if (!slots.includes(time)) return { ok: false };

  const overlapping = await getOverlappingBookings(
    date,
    time,
    settings.sitting_duration,
    excludeRef,
  );
  const used = usedTables(overlapping);
  const allocation = allocateTables(inv, partySize, used);
  if (!allocation) return { ok: false };
  return { ok: true, allocation };
}

/** Available time strings for a date that can seat `partySize` (or any party if omitted). */
export async function availableSlots(
  date: string,
  partySize?: number,
  excludeRef?: string,
): Promise<string[]> {
  const settings = await getSettings();
  const all = generateSlots(
    settings.opening_hours.open,
    settings.opening_hours.close,
    settings.sitting_duration,
  );
  // Don't offer past slots for today.
  const today = dateKey(now());
  const nowMs = now();
  const out: string[] = [];
  for (const time of all) {
    const start = toEpoch(date, time);
    if (date < today) continue;
    if (date === today && start <= nowMs) continue;
    if (partySize != null) {
      const check = await canAccommodate(date, time, partySize, excludeRef);
      if (!check.ok) continue;
    } else {
      const cap = await remainingCapacity(date, time, {
        excludeRef,
        settings,
      });
      if (cap.remaining_tables < 1 || cap.remaining_seats < 1) continue;
    }
    out.push(time);
  }
  return out;
}

export async function persistCapacitySnapshot(
  date: string,
  time: string,
): Promise<CapacitySnapshot> {
  const snap = await remainingCapacity(date, time);
  const store = await getStore();
  await store.set(K.capacity(date, time), snap);
  return snap;
}

// ── Bookings ────────────────────────────────────────────────────────────────

export async function getBooking(ref: string): Promise<Booking | undefined> {
  const store = await getStore();
  return store.get<Booking>(K.booking(ref.toUpperCase()));
}

export async function getUserBookings(userId: number): Promise<Booking[]> {
  const refs = await readList(K.userRefs(userId));
  const store = await getStore();
  const out: Booking[] = [];
  for (const ref of refs) {
    const b = await store.get<Booking>(K.booking(ref));
    if (b) out.push(b);
  }
  return out;
}

export async function getActiveBookingForUser(
  userId: number,
): Promise<Booking | undefined> {
  const list = await getUserBookings(userId);
  const upcoming = list
    .filter((b) => b.status === "confirmed" && b.datetime >= now() - 60_000)
    .sort((a, b) => a.datetime - b.datetime);
  return upcoming[0];
}

export async function listActiveBookings(): Promise<Booking[]> {
  const refs = await readList(K.activeRefs);
  const store = await getStore();
  const out: Booking[] = [];
  for (const ref of refs) {
    const b = await store.get<Booking>(K.booking(ref));
    if (b && b.status === "confirmed") out.push(b);
  }
  return out.sort((a, b) => a.datetime - b.datetime);
}

export async function listUpcomingBookings(limit = 20): Promise<Booking[]> {
  const all = await listActiveBookings();
  const t = now();
  return all.filter((b) => b.datetime + 3 * 3_600_000 >= t).slice(0, limit);
}

export interface CreateBookingInput {
  guest_user_id: number;
  guest_chat_id: number;
  guest_name?: string;
  phone?: string;
  party_size: number;
  date: string;
  time: string;
  /** When rescheduling, free this ref's capacity for the check. */
  excludeRef?: string;
}

export type CreateBookingResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: string };

export async function createBooking(
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  const settings = await getSettings();
  const today = dateKey(now());
  const maxDate = addDays(today, BOOKING_WINDOW_DAYS - 1);

  if (input.date < today || input.date > maxDate) {
    return {
      ok: false,
      reason: "That date is outside our booking window. Pick a day within the next 30 days.",
    };
  }

  const slots = generateSlots(
    settings.opening_hours.open,
    settings.opening_hours.close,
    settings.sitting_duration,
  );
  if (!slots.includes(input.time)) {
    return {
      ok: false,
      reason: "We're closed at that time — pick a slot during opening hours.",
    };
  }

  const start = toEpoch(input.date, input.time);
  if (start <= now()) {
    return {
      ok: false,
      reason: "That time has already passed. Pick a later slot.",
    };
  }

  // Real-time slot validation (race-safe within single-threaded handlers).
  const fit = await canAccommodate(
    input.date,
    input.time,
    input.party_size,
    input.excludeRef,
  );
  if (!fit.ok) {
    return {
      ok: false,
      reason:
        "That slot just filled up — try another time or a smaller party.",
    };
  }

  const ref = await nextReferenceCode();
  const ts = now();
  // Fire when now reaches (start − offset). If the guest books inside the
  // reminder window, the next processDueReminders pass sends it immediately.
  const reminderAt = start - settings.reminder_offset * 3_600_000;

  const booking: Booking = {
    reference_code: ref,
    guest_user_id: input.guest_user_id,
    guest_chat_id: input.guest_chat_id,
    guest_name: input.guest_name,
    phone: input.phone,
    party_size: input.party_size,
    date: input.date,
    time: input.time,
    datetime: start,
    table_allocation: fit.allocation,
    status: "confirmed",
    reminder_sent: false,
    reminder_at: reminderAt,
    created_at: ts,
    updated_at: ts,
  };

  const store = await getStore();
  await store.set(K.booking(ref), booking);
  await addToList(K.activeRefs, ref);
  await addToList(K.dateRefs(input.date), ref);
  await addToList(K.dateList, input.date);
  await addToList(K.userRefs(input.guest_user_id), ref);
  await addToList(K.reminderQueue, ref);
  await persistCapacitySnapshot(input.date, input.time);

  return { ok: true, booking };
}

export async function updateBookingStatus(
  ref: string,
  status: BookingStatus,
): Promise<Booking | undefined> {
  const store = await getStore();
  const b = await store.get<Booking>(K.booking(ref));
  if (!b) return undefined;
  b.status = status;
  b.updated_at = now();
  await store.set(K.booking(ref), b);
  if (status !== "confirmed") {
    await removeFromList(K.activeRefs, ref);
    await removeFromList(K.reminderQueue, ref);
  }
  await persistCapacitySnapshot(b.date, b.time);
  return b;
}

export async function rescheduleBooking(
  ref: string,
  date: string,
  time: string,
): Promise<CreateBookingResult> {
  const existing = await getBooking(ref);
  if (!existing || existing.status !== "confirmed") {
    return { ok: false, reason: "I couldn't find an active booking to reschedule." };
  }

  // Temporarily mark cancelled so capacity frees, then re-validate.
  const store = await getStore();
  const oldDate = existing.date;
  const oldTime = existing.time;
  existing.status = "cancelled";
  existing.updated_at = now();
  await store.set(K.booking(ref), existing);
  await removeFromList(K.activeRefs, ref);
  await removeFromList(K.dateRefs(oldDate), ref);
  await removeFromList(K.reminderQueue, ref);

  const fit = await canAccommodate(date, time, existing.party_size);
  if (!fit.ok) {
    // Roll back
    existing.status = "confirmed";
    existing.updated_at = now();
    await store.set(K.booking(ref), existing);
    await addToList(K.activeRefs, ref);
    await addToList(K.dateRefs(oldDate), ref);
    if (existing.reminder_at && !existing.reminder_sent) {
      await addToList(K.reminderQueue, ref);
    }
    return {
      ok: false,
      reason:
        "That new slot isn't free for your party size. Pick another time.",
    };
  }

  const settings = await getSettings();
  const start = toEpoch(date, time);
  if (start <= now()) {
    existing.status = "confirmed";
    await store.set(K.booking(ref), existing);
    await addToList(K.activeRefs, ref);
    await addToList(K.dateRefs(oldDate), ref);
    return { ok: false, reason: "That time has already passed. Pick a later slot." };
  }

  const reminderAt = start - settings.reminder_offset * 3_600_000;
  existing.date = date;
  existing.time = time;
  existing.datetime = start;
  existing.table_allocation = fit.allocation;
  existing.status = "confirmed";
  existing.reminder_sent = false;
  existing.reminder_at = reminderAt;
  existing.updated_at = now();
  await store.set(K.booking(ref), existing);
  await addToList(K.activeRefs, ref);
  await addToList(K.dateRefs(date), ref);
  await addToList(K.reminderQueue, ref);
  await persistCapacitySnapshot(oldDate, oldTime);
  await persistCapacitySnapshot(date, time);
  return { ok: true, booking: existing };
}

// ── Owner dashboard helpers ─────────────────────────────────────────────────

export async function todayCapacitySummary(): Promise<{
  date: string;
  totalSeats: number;
  remainingSeats: number;
  totalTables: number;
  remainingTables: number;
  bookingCount: number;
}> {
  const settings = await getSettings();
  const inv = await getInventory();
  const date = dateKey(now());
  const slots = generateSlots(
    settings.opening_hours.open,
    settings.opening_hours.close,
    settings.sitting_duration,
  );
  // Use the "peak remaining" as min remaining across upcoming slots for today.
  let minSeats = totalSeats(inv);
  let minTables = totalTables(inv);
  for (const time of slots) {
    const start = toEpoch(date, time);
    if (start + settings.sitting_duration * 60_000 < now()) continue;
    const cap = await remainingCapacity(date, time, { settings, inventory: inv });
    minSeats = Math.min(minSeats, cap.remaining_seats);
    minTables = Math.min(minTables, cap.remaining_tables);
  }
  const refs = await readList(K.dateRefs(date));
  const store = await getStore();
  let bookingCount = 0;
  for (const ref of refs) {
    const b = await store.get<Booking>(K.booking(ref));
    if (b && b.status === "confirmed") bookingCount++;
  }
  return {
    date,
    totalSeats: totalSeats(inv),
    remainingSeats: minSeats,
    totalTables: totalTables(inv),
    remainingTables: minTables,
    bookingCount,
  };
}

// ── Reminders ───────────────────────────────────────────────────────────────

export interface DueReminder {
  booking: Booking;
  guestText: string;
  ownerText: string;
}

export async function collectDueReminders(): Promise<DueReminder[]> {
  const refs = await readList(K.reminderQueue);
  const store = await getStore();
  const t = now();
  const due: DueReminder[] = [];
  for (const ref of refs) {
    const b = await store.get<Booking>(K.booking(ref));
    if (!b || b.status !== "confirmed" || b.reminder_sent) {
      await removeFromList(K.reminderQueue, ref);
      continue;
    }
    if (b.reminder_at != null && b.reminder_at <= t) {
      due.push({
        booking: b,
        guestText:
          `Reminder: your table is booked for ${b.time} on ${b.date}` +
          (b.guest_name ? ` (${b.guest_name})` : "") +
          `.\nParty of ${b.party_size}. Ref ${b.reference_code}. See you soon!`,
        ownerText: `Reminder sent to guest for ${b.time} on ${b.date} — ref ${b.reference_code}, party of ${b.party_size}.`,
      });
    }
  }
  return due;
}

export async function markReminderSent(ref: string): Promise<void> {
  const store = await getStore();
  const b = await store.get<Booking>(K.booking(ref));
  if (!b) return;
  b.reminder_sent = true;
  b.updated_at = now();
  await store.set(K.booking(ref), b);
  await removeFromList(K.reminderQueue, ref);
}

/**
 * Process due reminders: send guest + owner messages.
 * Tolerates 403 (user blocked / never started) without aborting the loop.
 */
export async function processDueReminders(send: {
  sendMessage: (chatId: number, text: string) => Promise<unknown>;
}): Promise<number> {
  const due = await collectDueReminders();
  if (due.length === 0) return 0;
  const settings = await getSettings();
  let sent = 0;
  for (const item of due) {
    try {
      await send.sendMessage(item.booking.guest_chat_id, item.guestText);
    } catch {
      /* guest blocked the bot — continue */
    }
    if (settings.owner_chat_id != null) {
      try {
        await send.sendMessage(settings.owner_chat_id, item.ownerText);
      } catch {
        /* owner unreachable — continue */
      }
    }
    await markReminderSent(item.booking.reference_code);
    sent++;
  }
  return sent;
}

/** Best-effort owner notify. Swallows errors (403 etc.). */
export async function notifyOwner(
  send: { sendMessage: (chatId: number, text: string) => Promise<unknown> },
  text: string,
  exceptUserId?: number,
): Promise<void> {
  const settings = await getSettings();
  if (settings.owner_chat_id == null) return;
  if (exceptUserId != null && settings.owner_user_id === exceptUserId) return;
  try {
    await send.sendMessage(settings.owner_chat_id, text);
  } catch {
    /* ignore */
  }
}

export function bookingSummary(b: Booking): string {
  const name = b.guest_name ? ` · ${b.guest_name}` : "";
  const phone = b.phone ? ` · ${b.phone}` : "";
  return (
    `Ref ${b.reference_code}\n` +
    `${b.date} at ${b.time}${name}${phone}\n` +
    `Party of ${b.party_size} · ${b.table_allocation.tables}× ${b.table_allocation.table_type}`
  );
}
