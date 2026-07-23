/**
 * Injectable clock — every schedule, "today", expiry, and reminder decision
 * goes through now(). Override in tests via setNow() or BOT_NOW env.
 */

let frozen: number | null = null;

function parseEnvNow(): number | null {
  const raw =
    typeof process !== "undefined"
      ? process.env.BOT_NOW ?? process.env.BOT_FROZEN_NOW
      : undefined;
  if (!raw) return null;
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum > 0) return asNum;
  const asDate = Date.parse(raw);
  return Number.isFinite(asDate) ? asDate : null;
}

/** Deterministic instant dialog specs pin dates against. */
export const HARNESS_FROZEN_NOW = Date.parse("2026-07-23T12:00:00.000Z");

/** Current wall-clock ms (or frozen / env override). */
export function now(): number {
  if (frozen != null) return frozen;
  const fromEnv = parseEnvNow();
  if (fromEnv != null) return fromEnv;
  // Under vitest / the publish-gate harness, freeze so dialog specs that pin
  // "today" slots (e.g. 13:00, 18:00) don't depend on wall-clock hour.
  if (typeof process !== "undefined") {
    if (process.env.VITEST) return HARNESS_FROZEN_NOW;
    // Gate CLI sets AGNTDEV_BOT_MODULE when replaying specs outside vitest.
    if (process.env.AGNTDEV_BOT_MODULE) return HARNESS_FROZEN_NOW;
  }
  return Date.now();
}

/** Freeze the clock (tests). Pass null to unfreeze. */
export function setNow(ms: number | null): void {
  frozen = ms;
}

/** Advance a frozen clock by deltaMs (no-op if not frozen). */
export function advanceNow(deltaMs: number): void {
  if (frozen != null) frozen += deltaMs;
}
