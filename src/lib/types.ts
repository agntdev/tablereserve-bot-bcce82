/** Table inventory row: a type of table with seat count and how many exist. */
export interface TableType {
  table_type: string;
  seats: number;
  count: number;
}

/** Guest reservation. */
export type BookingStatus = "confirmed" | "cancelled" | "no_show" | "completed";

export interface TableAllocation {
  table_type: string;
  seats: number;
  tables: number;
}

export interface Booking {
  reference_code: string;
  guest_user_id: number;
  guest_chat_id: number;
  guest_name?: string;
  phone?: string;
  party_size: number;
  /** ISO date YYYY-MM-DD in restaurant local calendar. */
  date: string;
  /** HH:MM 24h local. */
  time: string;
  /** Epoch ms for the booking start (date+time interpreted as UTC for simplicity). */
  datetime: number;
  table_allocation: TableAllocation;
  status: BookingStatus;
  reminder_sent?: boolean;
  /** Epoch ms when a reminder should fire. */
  reminder_at?: number;
  created_at: number;
  updated_at: number;
}

export interface CapacitySnapshot {
  date: string;
  time_slot: string;
  remaining_seats: number;
  remaining_tables: number;
}

export interface OpeningHours {
  open: string; // HH:MM
  close: string; // HH:MM
}

export interface Settings {
  owner_user_id?: number;
  owner_chat_id?: number;
  opening_hours: OpeningHours;
  /** Sitting duration in minutes. */
  sitting_duration: number;
  /** Reminder offset in hours before booking. */
  reminder_offset: number;
  /** Optional display name. */
  restaurant_name?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  opening_hours: { open: "11:00", close: "22:00" },
  sitting_duration: 90,
  reminder_offset: 2,
  restaurant_name: "TableReserve",
};

export const DEFAULT_INVENTORY: TableType[] = [
  { table_type: "2-top", seats: 2, count: 4 },
  { table_type: "4-top", seats: 4, count: 4 },
  { table_type: "6-top", seats: 6, count: 2 },
];

/** 15-minute slot granularity; 30-day booking window. */
export const SLOT_MINUTES = 15;
export const BOOKING_WINDOW_DAYS = 30;
