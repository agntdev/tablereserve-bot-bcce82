import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import {
  claimOrCheckOwner,
  getBooking,
  listUpcomingBookings,
  notifyOwner,
  processDueReminders,
  todayCapacitySummary,
  updateBookingStatus,
} from "../lib/domain.js";
import { prettyDate } from "../lib/time-util.js";
import { ownerBookingKeyboard } from "../lib/ui.js";

const composer = new Composer<Ctx>();

async function renderDashboard(ctx: Ctx, edit: boolean): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat.id;
  if (userId == null || chatId == null) {
    const msg = "Couldn't identify you — try again from a private chat.";
    if (edit) await ctx.editMessageText(msg);
    else await ctx.reply(msg);
    return;
  }

  const ownership = await claimOrCheckOwner(userId, chatId);
  if (!ownership.ok) {
    if (edit) await ctx.editMessageText(ownership.reason);
    else await ctx.reply(ownership.reason);
    return;
  }

  await processDueReminders({
    sendMessage: (id, text) => ctx.api.sendMessage(id, text),
  }).catch(() => 0);

  const cap = await todayCapacitySummary();
  const upcoming = await listUpcomingBookings(15);

  let body =
    `Owner dashboard · ${prettyDate(cap.date)}\n\n` +
    `Today's capacity\n` +
    `· Seats free (tightest slot): ${cap.remainingSeats} / ${cap.totalSeats}\n` +
    `· Tables free (tightest slot): ${cap.remainingTables} / ${cap.totalTables}\n` +
    `· Confirmed today: ${cap.bookingCount}\n\n`;

  if (upcoming.length === 0) {
    body += "No upcoming bookings yet — they'll show up here as guests reserve.";
  } else {
    body += "Upcoming bookings:\n";
    for (const b of upcoming) {
      const name = b.guest_name ? ` · ${b.guest_name}` : "";
      body += `· ${b.date} ${b.time} · party ${b.party_size}${name} · ${b.reference_code}\n`;
    }
  }

  const rows = upcoming.slice(0, 8).map((b) => [
    inlineButton(
      `${b.time} ${b.reference_code}`,
      `owner:detail:${b.reference_code}`,
    ),
  ]);
  rows.push([inlineButton("Refresh", "owner:dash")]);
  rows.push([inlineButton("Settings", "settings:home")]);
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);

  if (edit) {
    await ctx.editMessageText(body.trimEnd(), {
      reply_markup: inlineKeyboard(rows),
    });
  } else {
    await ctx.reply(body.trimEnd(), { reply_markup: inlineKeyboard(rows) });
  }
}

composer.command("bookings", async (ctx) => {
  await renderDashboard(ctx, false);
});

composer.callbackQuery("owner:dash", async (ctx) => {
  await ctx.answerCallbackQuery();
  await renderDashboard(ctx, true);
});

composer.callbackQuery(/^owner:detail:([A-Z0-9]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat.id;
  if (userId == null || chatId == null) return;
  const ownership = await claimOrCheckOwner(userId, chatId);
  if (!ownership.ok) {
    await ctx.editMessageText(ownership.reason);
    return;
  }
  const ref = ctx.match![1]!;
  const b = await getBooking(ref);
  if (!b) {
    await ctx.editMessageText("Couldn't find that booking.", {
      reply_markup: inlineKeyboard([[inlineButton("« Dashboard", "owner:dash")]]),
    });
    return;
  }
  const name = b.guest_name ? `\nGuest: ${b.guest_name}` : "";
  const phone = b.phone ? `\nPhone: ${b.phone}` : "";
  await ctx.editMessageText(
    `Booking ${b.reference_code}\n` +
      `${b.date} at ${b.time}\n` +
      `Party of ${b.party_size} · ${b.status}` +
      name +
      phone +
      `\nTable: ${b.table_allocation.tables}× ${b.table_allocation.table_type}`,
    {
      reply_markup:
        b.status === "confirmed"
          ? ownerBookingKeyboard(ref)
          : inlineKeyboard([[inlineButton("« Dashboard", "owner:dash")]]),
    },
  );
});

composer.callbackQuery(/^owner:noshow:([A-Z0-9]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat.id;
  if (userId == null || chatId == null) return;
  const ownership = await claimOrCheckOwner(userId, chatId);
  if (!ownership.ok) {
    await ctx.editMessageText(ownership.reason);
    return;
  }
  const ref = ctx.match![1]!;
  const b = await getBooking(ref);
  if (!b || b.status !== "confirmed") {
    await ctx.editMessageText("That booking isn't active — nothing to mark.", {
      reply_markup: inlineKeyboard([[inlineButton("« Dashboard", "owner:dash")]]),
    });
    return;
  }
  // Allowed even after booking time has passed (edge case from the spec).
  await updateBookingStatus(ref, "no_show");
  await ctx.editMessageText(
    `Marked ${ref} as no-show. Those seats are free again for new guests.`,
    {
      reply_markup: inlineKeyboard([[inlineButton("« Dashboard", "owner:dash")]]),
    },
  );
  // Notify guest if possible (tolerate 403).
  try {
    await ctx.api.sendMessage(
      b.guest_chat_id,
      `Your booking ${ref} was marked as a no-show. Reach out if that was a mistake.`,
    );
  } catch {
    /* guest unreachable */
  }
  await notifyOwner(
    { sendMessage: (id, text) => ctx.api.sendMessage(id, text) },
    `No-show recorded: ${b.date} ${b.time}, ref ${ref}, party of ${b.party_size}.`,
    // still notify even if owner is the one who marked it? skip self
    userId,
  );
});

export default composer;
