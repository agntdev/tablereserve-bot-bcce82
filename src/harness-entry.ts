import { buildBot } from "./bot.js";
import { HARNESS_FROZEN_NOW, setNow } from "./lib/clock.js";

// The Tests-gate harness imports THIS module and calls makeBot() with no args,
// replaying dialog specs tokenlessly (it fakes the Bot API transport — no real
// Telegram call is made). The token is a placeholder for replay. The agntdev-ci
// orchestrator points AGNTDEV_BOT_MODULE at the compiled dist/harness-entry.js.
//
// Freeze the clock to the same instant dialog specs pin (2026-07-23 noon UTC).
// The gate runs compiled code WITHOUT the VITEST env that freezes time under
// `npm test`, so without this every "today" slot becomes wall-clock-dependent
// and specs that book 13:00 / 18:00 fail when the gate runs after those hours.
export async function makeBot() {
  setNow(HARNESS_FROZEN_NOW);
  return buildBot(process.env.BOT_TOKEN ?? "harness-test-token");
}
