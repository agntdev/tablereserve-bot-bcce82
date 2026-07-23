import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import {
  claimOrCheckOwner,
  getInventory,
  getSettings,
  saveInventory,
  saveSettings,
} from "../lib/domain.js";
import type { TableType } from "../lib/types.js";
import {
  durationKeyboard,
  reminderKeyboard,
  settingsKeyboard,
} from "../lib/ui.js";
import { parseHm } from "../lib/time-util.js";

const composer = new Composer<Ctx>();

function settingsText(
  settings: Awaited<ReturnType<typeof getSettings>>,
  inv: TableType[],
): string {
  const tables = inv
    .map((t) => `${t.count}× ${t.table_type} (${t.seats} seats)`)
    .join("\n· ");
  return (
    `Restaurant settings\n\n` +
    `Hours: ${settings.opening_hours.open}–${settings.opening_hours.close}\n` +
    `Sitting: ${settings.sitting_duration} min\n` +
    `Reminders: ${settings.reminder_offset} hour${settings.reminder_offset === 1 ? "" : "s"} before\n\n` +
    `Tables:\n· ${tables || "None configured"}\n\n` +
    `Tap a button to change something.`
  );
}

async function showSettings(ctx: Ctx, edit: boolean): Promise<void> {
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
  ctx.session.step = undefined;
  const settings = ownership.settings;
  const inv = await getInventory();
  const text = settingsText(settings, inv);
  if (edit) {
    await ctx.editMessageText(text, { reply_markup: settingsKeyboard() });
  } else {
    await ctx.reply(text, { reply_markup: settingsKeyboard() });
  }
}

composer.command("settings", async (ctx) => {
  await showSettings(ctx, false);
});

composer.callbackQuery("settings:home", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showSettings(ctx, true);
});

composer.callbackQuery("settings:hours", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat.id;
  if (userId == null || chatId == null) return;
  const ownership = await claimOrCheckOwner(userId, chatId);
  if (!ownership.ok) {
    await ctx.editMessageText(ownership.reason);
    return;
  }
  ctx.session.step = "settings:hours";
  await ctx.editMessageText(
    "Send opening hours as HH:MM-HH:MM (for example 11:00-22:00).",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("« Settings", "settings:home")],
      ]),
    },
  );
});

composer.callbackQuery("settings:duration", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat.id;
  if (userId == null || chatId == null) return;
  const ownership = await claimOrCheckOwner(userId, chatId);
  if (!ownership.ok) {
    await ctx.editMessageText(ownership.reason);
    return;
  }
  await ctx.editMessageText("How long does a sitting last?", {
    reply_markup: durationKeyboard(),
  });
});

composer.callbackQuery(/^settings:setdur:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat.id;
  if (userId == null || chatId == null) return;
  const ownership = await claimOrCheckOwner(userId, chatId);
  if (!ownership.ok) {
    await ctx.editMessageText(ownership.reason);
    return;
  }
  const mins = Number(ctx.match![1]);
  const settings = await getSettings();
  settings.sitting_duration = mins;
  await saveSettings(settings);
  await ctx.editMessageText(`Sitting duration set to ${mins} minutes.`, {
    reply_markup: settingsKeyboard(),
  });
});

composer.callbackQuery("settings:reminder", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat.id;
  if (userId == null || chatId == null) return;
  const ownership = await claimOrCheckOwner(userId, chatId);
  if (!ownership.ok) {
    await ctx.editMessageText(ownership.reason);
    return;
  }
  await ctx.editMessageText("When should guests get a reminder?", {
    reply_markup: reminderKeyboard(),
  });
});

composer.callbackQuery(/^settings:setrem:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat.id;
  if (userId == null || chatId == null) return;
  const ownership = await claimOrCheckOwner(userId, chatId);
  if (!ownership.ok) {
    await ctx.editMessageText(ownership.reason);
    return;
  }
  const hours = Number(ctx.match![1]);
  const settings = await getSettings();
  settings.reminder_offset = hours;
  await saveSettings(settings);
  await ctx.editMessageText(
    `Reminders will go out ${hours} hour${hours === 1 ? "" : "s"} before each booking.`,
    { reply_markup: settingsKeyboard() },
  );
});

composer.callbackQuery("settings:tables", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat.id;
  if (userId == null || chatId == null) return;
  const ownership = await claimOrCheckOwner(userId, chatId);
  if (!ownership.ok) {
    await ctx.editMessageText(ownership.reason);
    return;
  }
  ctx.session.step = "settings:tables";
  await ctx.editMessageText(
    "Send table inventory as seats:count pairs, comma-separated.\n" +
      "Example: 2:4,4:4,6:2\n" +
      "(four 2-seaters, four 4-seaters, two 6-seaters)",
    {
      reply_markup: inlineKeyboard([
        [inlineButton("« Settings", "settings:home")],
      ]),
    },
  );
});

composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return next();

  if (ctx.session.step === "settings:hours") {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (userId == null || chatId == null) return next();
    const ownership = await claimOrCheckOwner(userId, chatId);
    if (!ownership.ok) {
      await ctx.reply(ownership.reason);
      return;
    }
    const m = text.match(/^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/);
    if (!m) {
      await ctx.reply("Use the format 11:00-22:00 and try again.");
      return;
    }
    const open = normalizeHm(m[1]!);
    const close = normalizeHm(m[2]!);
    if (parseHm(open) >= parseHm(close)) {
      await ctx.reply("Opening time must be before closing time.");
      return;
    }
    const settings = await getSettings();
    settings.opening_hours = { open, close };
    await saveSettings(settings);
    ctx.session.step = undefined;
    await ctx.reply(`Hours updated to ${open}–${close}.`, {
      reply_markup: settingsKeyboard(),
    });
    return;
  }

  if (ctx.session.step === "settings:tables") {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (userId == null || chatId == null) return next();
    const ownership = await claimOrCheckOwner(userId, chatId);
    if (!ownership.ok) {
      await ctx.reply(ownership.reason);
      return;
    }
    const parsed = parseInventory(text);
    if (!parsed.ok) {
      await ctx.reply(parsed.reason);
      return;
    }
    await saveInventory(parsed.inv);
    ctx.session.step = undefined;
    await ctx.reply("Table inventory saved.", {
      reply_markup: settingsKeyboard(),
    });
    return;
  }

  return next();
});

function normalizeHm(raw: string): string {
  const [h, m] = raw.split(":").map(Number);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseInventory(
  text: string,
): { ok: true; inv: TableType[] } | { ok: false; reason: string } {
  const parts = text.split(/[,;]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { ok: false, reason: "Send at least one seats:count pair." };
  }
  const inv: TableType[] = [];
  for (const p of parts) {
    const m = p.match(/^(\d+)\s*:\s*(\d+)$/);
    if (!m) {
      return {
        ok: false,
        reason: `Couldn't read "${p}". Use seats:count like 4:6.`,
      };
    }
    const seats = Number(m[1]);
    const count = Number(m[2]);
    if (seats < 1 || seats > 20 || count < 1 || count > 100) {
      return {
        ok: false,
        reason: "Seats must be 1–20 and count 1–100 per type.",
      };
    }
    inv.push({
      table_type: `${seats}-top`,
      seats,
      count,
    });
  }
  return { ok: true, inv };
}

export default composer;
