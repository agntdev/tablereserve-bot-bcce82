import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { mainMenuKeyboard } from "../toolkit/index.js";
import { processDueReminders } from "../lib/domain.js";

// Main menu — features register their buttons via registerMainMenuItem.
const composer = new Composer<Ctx>();

export const WELCOME =
  "Welcome to TableReserve!\n\n" +
  "Book a table in a few taps, check your reservation, or manage the restaurant if you're the owner.";

composer.command("start", async (ctx) => {
  clearBookingDraft(ctx);
  // Opportunistic reminder sweep (covers Node; Workers also use DO alarms).
  await processDueReminders({
    sendMessage: (chatId, text) => ctx.api.sendMessage(chatId, text),
  }).catch(() => 0);
  await ctx.reply(WELCOME, { reply_markup: mainMenuKeyboard() });
});

composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  clearBookingDraft(ctx);
  await ctx.editMessageText(WELCOME, { reply_markup: mainMenuKeyboard() });
});

function clearBookingDraft(ctx: Ctx): void {
  ctx.session.step = undefined;
  ctx.session.bookDate = undefined;
  ctx.session.bookTime = undefined;
  ctx.session.bookParty = undefined;
  ctx.session.bookName = undefined;
  ctx.session.bookPhone = undefined;
  ctx.session.rescheduleRef = undefined;
}

export default composer;
