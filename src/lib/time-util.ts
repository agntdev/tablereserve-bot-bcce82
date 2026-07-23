import { now } from "./clock.js";
import { SLOT_MINUTES } from "./types.js";

/** Parse "HH:MM" → minutes from midnight. */
export function parseHm(hm: string): number {
  const [h, m] = hm.split(":").map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

/** Minutes from midnight → "HH:MM". */
export function formatHm(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** YYYY-MM-DD + HH:MM → epoch ms (treated as UTC wall time for determinism). */
export function toEpoch(date: string, time: string): number {
  return Date.parse(`${date}T${time}:00.000Z`);
}

/** Format epoch as YYYY-MM-DD (UTC). */
export function dateKey(ms: number = now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Add calendar days to a YYYY-MM-DD string (UTC). */
export function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000;
  return dateKey(ms);
}

/** Human label like "Thu 24 Jul". */
export function prettyDate(date: string): string {
  const d = new Date(`${date}T12:00:00.000Z`);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

/** Generate 15-min slots between open (inclusive) and close (exclusive of last full sitting handled separately). */
export function generateSlots(
  openHm: string,
  closeHm: string,
  sittingMinutes: number,
): string[] {
  const open = parseHm(openHm);
  const close = parseHm(closeHm);
  if (!Number.isFinite(open) || !Number.isFinite(close) || close <= open) {
    return [];
  }
  // Last start time must allow a full sitting before close.
  const lastStart = close - sittingMinutes;
  const slots: string[] = [];
  for (let t = open; t <= lastStart; t += SLOT_MINUTES) {
    slots.push(formatHm(t));
  }
  return slots;
}

/** Whether two intervals [start, start+dur) overlap. */
export function intervalsOverlap(
  aStart: number,
  aDurMin: number,
  bStart: number,
  bDurMin: number,
): boolean {
  const aEnd = aStart + aDurMin * 60_000;
  const bEnd = bStart + bDurMin * 60_000;
  return aStart < bEnd && bStart < aEnd;
}
