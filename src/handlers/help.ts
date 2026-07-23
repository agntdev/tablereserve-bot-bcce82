import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";

const composer = new Composer<Ctx>();

const HELP =
  "TableReserve helps you book a restaurant table without the back-and-forth.\n\n" +
  "Guests: tap Book a table, pick a date and time, and you'll get a reference code.\n" +
  "Owners: use /bookings for today's capacity and /settings to set hours, tables, and reminders.\n\n" +
  "Tap /start anytime to open the menu.";

const backToMenu = inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);

composer.command("help", async (ctx) => {
  await ctx.reply(HELP);
});

composer.callbackQuery("menu:help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(HELP, { reply_markup: backToMenu });
});

export default composer;
