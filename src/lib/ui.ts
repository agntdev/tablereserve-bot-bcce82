import {
  inlineButton,
  inlineKeyboard,
  type InlineKeyboardMarkup,
} from "../toolkit/index.js";
import { BOOKING_WINDOW_DAYS } from "./types.js";
import { addDays, dateKey, prettyDate } from "./time-util.js";
import { now } from "./clock.js";

export function backToMenuKeyboard(): InlineKeyboardMarkup {
  return inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);
}

export function datePickerKeyboard(
  page = 0,
  pageSize = 8,
): InlineKeyboardMarkup {
  const today = dateKey(now());
  const dates: string[] = [];
  for (let i = 0; i < BOOKING_WINDOW_DAYS; i++) {
    dates.push(addDays(today, i));
  }
  const totalPages = Math.max(1, Math.ceil(dates.length / pageSize));
  const p = Math.min(Math.max(0, page), totalPages - 1);
  const slice = dates.slice(p * pageSize, p * pageSize + pageSize);
  const dateRows = slice.map((d) => {
    const label = d === today ? `Today · ${prettyDate(d)}` : prettyDate(d);
    return [inlineButton(label, `booking:date:${d}`)];
  });
  const nav: ReturnType<typeof inlineButton>[] = [];
  if (p > 0) nav.push(inlineButton("« Earlier", `booking:dates:${p - 1}`));
  if (p < totalPages - 1) {
    nav.push(inlineButton("Later »", `booking:dates:${p + 1}`));
  }
  if (nav.length) dateRows.push(nav);
  dateRows.push([inlineButton("Cancel", "booking:abort")]);
  return inlineKeyboard(dateRows);
}

export function timePickerKeyboard(times: string[]): InlineKeyboardMarkup {
  const rows: ReturnType<typeof inlineButton>[][] = [];
  for (let i = 0; i < times.length; i += 3) {
    rows.push(
      times.slice(i, i + 3).map((t) => inlineButton(t, `booking:time:${t}`)),
    );
  }
  rows.push([inlineButton("« Dates", "booking:start")]);
  rows.push([inlineButton("Cancel", "booking:abort")]);
  return inlineKeyboard(rows);
}

export function partySizeKeyboard(): InlineKeyboardMarkup {
  const row1 = [1, 2, 3, 4].map((n) =>
    inlineButton(String(n), `booking:party:${n}`),
  );
  const row2 = [5, 6, 7, 8].map((n) =>
    inlineButton(String(n), `booking:party:${n}`),
  );
  return inlineKeyboard([
    row1,
    row2,
    [inlineButton("Cancel", "booking:abort")],
  ]);
}

export function confirmBookingKeyboard(): InlineKeyboardMarkup {
  return inlineKeyboard([
    [
      inlineButton("Confirm", "booking:confirm"),
      inlineButton("Cancel", "booking:abort"),
    ],
  ]);
}

export function afterBookingKeyboard(ref: string): InlineKeyboardMarkup {
  return inlineKeyboard([
    [
      inlineButton("Reschedule", `booking:resched:${ref}`),
      inlineButton("Cancel booking", `booking:cancel:${ref}`),
    ],
    [inlineButton("⬅️ Back to menu", "menu:main")],
  ]);
}

export function viewBookingKeyboard(ref: string): InlineKeyboardMarkup {
  return afterBookingKeyboard(ref);
}

export function ownerBookingKeyboard(ref: string): InlineKeyboardMarkup {
  return inlineKeyboard([
    [inlineButton("Mark no-show", `owner:noshow:${ref}`)],
    [inlineButton("« Dashboard", "owner:dash")],
  ]);
}

export function settingsKeyboard(): InlineKeyboardMarkup {
  return inlineKeyboard([
    [inlineButton("Opening hours", "settings:hours")],
    [inlineButton("Sitting duration", "settings:duration")],
    [inlineButton("Reminder timing", "settings:reminder")],
    [inlineButton("Table inventory", "settings:tables")],
    [inlineButton("⬅️ Back to menu", "menu:main")],
  ]);
}

export function durationKeyboard(): InlineKeyboardMarkup {
  return inlineKeyboard([
    [
      inlineButton("60 min", "settings:setdur:60"),
      inlineButton("90 min", "settings:setdur:90"),
      inlineButton("120 min", "settings:setdur:120"),
    ],
    [inlineButton("« Settings", "settings:home")],
  ]);
}

export function reminderKeyboard(): InlineKeyboardMarkup {
  return inlineKeyboard([
    [
      inlineButton("1 hour", "settings:setrem:1"),
      inlineButton("2 hours", "settings:setrem:2"),
    ],
    [
      inlineButton("3 hours", "settings:setrem:3"),
      inlineButton("4 hours", "settings:setrem:4"),
    ],
    [inlineButton("« Settings", "settings:home")],
  ]);
}
