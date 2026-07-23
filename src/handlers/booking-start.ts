import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
} from "../toolkit/index.js";
import {
  availableSlots,
  bookingSummary,
  createBooking,
  getBooking,
  notifyOwner,
  processDueReminders,
  rescheduleBooking,
} from "../lib/domain.js";
import { getStore } from "../lib/store.js";
import { prettyDate } from "../lib/time-util.js";
import {
  afterBookingKeyboard,
  confirmBookingKeyboard,
  datePickerKeyboard,
  partySizeKeyboard,
  timePickerKeyboard,
} from "../lib/ui.js";

registerMainMenuItem({ label: "Book a table", data: "booking:start", order: 10 });

const composer = new Composer<Ctx>();

function clearDraft(ctx: Ctx): void {
  ctx.session.step = undefined;
  ctx.session.bookDate = undefined;
  ctx.session.bookTime = undefined;
  ctx.session.bookParty = undefined;
  ctx.session.bookName = undefined;
  ctx.session.bookPhone = undefined;
  // keep rescheduleRef until confirm/abort
}

async function showDatePicker(ctx: Ctx, page = 0, edit = false): Promise<void> {
  ctx.session.step = undefined;
  ctx.session.bookDate = undefined;
  ctx.session.bookTime = undefined;
  ctx.session.bookParty = undefined;
  const text = ctx.session.rescheduleRef
    ? "Pick a new date for your booking:"
    : "Pick a date for your table:";
  const markup = datePickerKeyboard(page);
  if (edit) {
    await ctx.editMessageText(text, { reply_markup: markup });
  } else {
    await ctx.reply(text, { reply_markup: markup });
  }
}

composer.callbackQuery("booking:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.rescheduleRef = undefined;
  clearDraft(ctx);
  await processDueReminders({
    sendMessage: (chatId, text) => ctx.api.sendMessage(chatId, text),
  }).catch(() => 0);
  await showDatePicker(ctx, 0, true);
});

composer.callbackQuery(/^booking:dates:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const page = Number(ctx.match![1]);
  await showDatePicker(ctx, page, true);
});

composer.callbackQuery("booking:abort", async (ctx) => {
  await ctx.answerCallbackQuery();
  clearDraft(ctx);
  ctx.session.rescheduleRef = undefined;
  await ctx.editMessageText(
    "No problem — booking cancelled. Tap /start when you want to try again.",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );
});

composer.callbackQuery(/^booking:date:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const date = ctx.match![1]!;
  ctx.session.bookDate = date;
  ctx.session.bookTime = undefined;
  const slots = await availableSlots(date, undefined, ctx.session.rescheduleRef);
  if (slots.length === 0) {
    await ctx.editMessageText(
      `No free times on ${prettyDate(date)} — try another day.`,
      { reply_markup: datePickerKeyboard(0) },
    );
    return;
  }
  await ctx.editMessageText(
    `Times open on ${prettyDate(date)} — pick one:`,
    { reply_markup: timePickerKeyboard(slots) },
  );
});

composer.callbackQuery(/^booking:time:(\d{2}:\d{2})$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const time = ctx.match![1]!;
  if (!ctx.session.bookDate) {
    await showDatePicker(ctx, 0, true);
    return;
  }
  ctx.session.bookTime = time;
  await ctx.editMessageText(
    `Got it — ${prettyDate(ctx.session.bookDate)} at ${time}.\nHow many people?`,
    { reply_markup: partySizeKeyboard() },
  );
});

composer.callbackQuery(/^booking:party:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const party = Number(ctx.match![1]);
  if (!ctx.session.bookDate || !ctx.session.bookTime) {
    await showDatePicker(ctx, 0, true);
    return;
  }
  // Re-check this slot still fits the party.
  const slots = await availableSlots(
    ctx.session.bookDate,
    party,
    ctx.session.rescheduleRef,
  );
  if (!slots.includes(ctx.session.bookTime)) {
    await ctx.editMessageText(
      "That time can't seat your party anymore. Pick another slot:",
      {
        reply_markup: timePickerKeyboard(
          await availableSlots(ctx.session.bookDate, party, ctx.session.rescheduleRef),
        ),
      },
    );
    return;
  }
  ctx.session.bookParty = party;
  ctx.session.step = "book:name";
  await ctx.editMessageText(
    "Name for the reservation? (optional — tap Skip to continue)",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Skip", "booking:skip_name")],
        [inlineButton("Cancel", "booking:abort")],
      ]),
    },
  );
});

composer.callbackQuery("booking:skip_name", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.bookName = undefined;
  ctx.session.step = "book:phone";
  await ctx.editMessageText(
    "Phone number? (optional — tap Skip to continue)",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Skip", "booking:skip_phone")],
        [inlineButton("Cancel", "booking:abort")],
      ]),
    },
  );
});

composer.callbackQuery("booking:skip_phone", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.bookPhone = undefined;
  await showConfirm(ctx, true);
});

composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return next();

  if (ctx.session.step === "book:name") {
    if (text.length < 1 || text.length > 60) {
      await ctx.reply("Keep the name under 60 characters, or tap Skip.");
      return;
    }
    ctx.session.bookName = text;
    ctx.session.step = "book:phone";
    await ctx.reply("Phone number? (optional — tap Skip to continue)", {
      reply_markup: inlineKeyboard([
        [inlineButton("Skip", "booking:skip_phone")],
        [inlineButton("Cancel", "booking:abort")],
      ]),
    });
    return;
  }

  if (ctx.session.step === "book:phone") {
    if (text.length < 5 || text.length > 30) {
      await ctx.reply(
        "That doesn't look like a phone number — try again, or tap Skip.",
      );
      return;
    }
    ctx.session.bookPhone = text;
    await showConfirm(ctx, false);
    return;
  }

  return next();
});

async function showConfirm(ctx: Ctx, edit: boolean): Promise<void> {
  const { bookDate, bookTime, bookParty, bookName, bookPhone, rescheduleRef } =
    ctx.session;
  if (!bookDate || !bookTime || !bookParty) {
    if (edit) await showDatePicker(ctx, 0, true);
    else await showDatePicker(ctx, 0, false);
    return;
  }
  ctx.session.step = "book:confirm";
  const nameLine = bookName ? `\nName: ${bookName}` : "";
  const phoneLine = bookPhone ? `\nPhone: ${bookPhone}` : "";
  const head = rescheduleRef
    ? `Reschedule to:`
    : `Here's your booking:`;
  const text =
    `${head}\n` +
    `${prettyDate(bookDate)} at ${bookTime}\n` +
    `Party of ${bookParty}` +
    nameLine +
    phoneLine +
    `\n\nTap Confirm to lock it in.`;
  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: confirmBookingKeyboard() });
  } else {
    await ctx.reply(text, { reply_markup: confirmBookingKeyboard() });
  }
}

composer.callbackQuery("booking:confirm", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (userId == null || chatId == null) {
    await ctx.editMessageText("Couldn't identify you — try /start again.");
    return;
  }
  const { bookDate, bookTime, bookParty, bookName, bookPhone, rescheduleRef } =
    ctx.session;
  if (!bookDate || !bookTime || !bookParty) {
    await showDatePicker(ctx, 0, true);
    return;
  }

  if (rescheduleRef) {
    const result = await rescheduleBooking(rescheduleRef, bookDate, bookTime);
    clearDraft(ctx);
    ctx.session.rescheduleRef = undefined;
    if (!result.ok) {
      await ctx.editMessageText(result.reason, {
        reply_markup: inlineKeyboard([
          [inlineButton("Try again", "booking:start")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      });
      return;
    }
    // Keep optional name/phone updates if provided during flow.
    if (bookName || bookPhone) {
      const store = await getStore();
      const b = (await getBooking(result.booking.reference_code)) ?? result.booking;
      if (bookName) b.guest_name = bookName;
      if (bookPhone) b.phone = bookPhone;
      await store.set(`booking:${b.reference_code}`, b);
      result.booking.guest_name = b.guest_name;
      result.booking.phone = b.phone;
    }
    await ctx.editMessageText(
      `You're all set — booking updated.\n\n${bookingSummary(result.booking)}`,
      { reply_markup: afterBookingKeyboard(result.booking.reference_code) },
    );
    await notifyOwner(
      { sendMessage: (id, text) => ctx.api.sendMessage(id, text) },
      `Booking rescheduled: ${result.booking.date} ${result.booking.time}, party of ${result.booking.party_size}, ref ${result.booking.reference_code}.`,
      userId,
    );
    return;
  }

  const result = await createBooking({
    guest_user_id: userId,
    guest_chat_id: chatId,
    guest_name: bookName,
    phone: bookPhone,
    party_size: bookParty,
    date: bookDate,
    time: bookTime,
  });
  clearDraft(ctx);
  ctx.session.rescheduleRef = undefined;

  if (!result.ok) {
    await ctx.editMessageText(result.reason, {
      reply_markup: inlineKeyboard([
        [inlineButton("Try again", "booking:start")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  const b = result.booking;
  await ctx.editMessageText(
    `You're booked!\n\n${bookingSummary(b)}\n\nSave your reference code — you'll need it if you call us.`,
    { reply_markup: afterBookingKeyboard(b.reference_code) },
  );
  await notifyOwner(
    { sendMessage: (id, text) => ctx.api.sendMessage(id, text) },
    `New booking: ${b.date} ${b.time}, party of ${b.party_size}, ref ${b.reference_code}` +
      (b.guest_name ? ` (${b.guest_name})` : "") +
      ".",
    userId,
  );
});

export default composer;
