import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import {
  bookingSummary,
  getActiveBookingForUser,
  getBooking,
  notifyOwner,
  updateBookingStatus,
} from "../lib/domain.js";
import { datePickerKeyboard, viewBookingKeyboard } from "../lib/ui.js";

registerMainMenuItem({
  label: "View my booking",
  data: "booking:view",
  order: 20,
});

const composer = new Composer<Ctx>();

composer.callbackQuery("booking:view", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  if (userId == null) {
    await ctx.editMessageText("Couldn't identify you — try /start again.");
    return;
  }
  const booking = await getActiveBookingForUser(userId);
  if (!booking) {
    await ctx.editMessageText(
      "No upcoming booking yet — tap Book a table to reserve one.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("Book a table", "booking:start")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }
  await ctx.editMessageText(
    `Your booking:\n\n${bookingSummary(booking)}`,
    { reply_markup: viewBookingKeyboard(booking.reference_code) },
  );
});

composer.callbackQuery(/^booking:cancel:([A-Z0-9]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ref = ctx.match![1]!;
  const booking = await getBooking(ref);
  if (!booking || booking.status !== "confirmed") {
    await ctx.editMessageText("That booking isn't active anymore.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }
  if (booking.guest_user_id !== ctx.from?.id) {
    await ctx.editMessageText("That's not your booking.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }
  await ctx.editMessageText(
    `Cancel booking ${ref} on ${booking.date} at ${booking.time}?`,
    {
      reply_markup: inlineKeyboard([
        [
          inlineButton("Yes, cancel", `booking:cancel_yes:${ref}`),
          inlineButton("Keep it", "booking:view"),
        ],
      ]),
    },
  );
});

composer.callbackQuery(/^booking:cancel_yes:([A-Z0-9]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ref = ctx.match![1]!;
  const booking = await getBooking(ref);
  if (!booking || booking.guest_user_id !== ctx.from?.id) {
    await ctx.editMessageText("Couldn't cancel that booking.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }
  await updateBookingStatus(ref, "cancelled");
  await ctx.editMessageText(
    `Cancelled — ${ref} is free again. Hope to see you another time.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Book again", "booking:start")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
  await notifyOwner(
    { sendMessage: (id, text) => ctx.api.sendMessage(id, text) },
    `Booking cancelled: ${booking.date} ${booking.time}, ref ${ref}, party of ${booking.party_size}.`,
    ctx.from?.id,
  );
});

composer.callbackQuery(/^booking:resched:([A-Z0-9]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ref = ctx.match![1]!;
  const booking = await getBooking(ref);
  if (!booking || booking.status !== "confirmed") {
    await ctx.editMessageText("That booking isn't active anymore.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }
  if (booking.guest_user_id !== ctx.from?.id) {
    await ctx.editMessageText("That's not your booking.", {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }
  ctx.session.rescheduleRef = ref;
  ctx.session.bookParty = booking.party_size;
  ctx.session.bookName = booking.guest_name;
  ctx.session.bookPhone = booking.phone;
  ctx.session.bookDate = undefined;
  ctx.session.bookTime = undefined;
  ctx.session.step = undefined;
  await ctx.editMessageText("Pick a new date for your booking:", {
    reply_markup: datePickerKeyboard(0),
  });
});

export default composer;
