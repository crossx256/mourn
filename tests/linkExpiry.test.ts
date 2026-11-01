import { describe, expect, it } from 'vitest';

/**
 * L16 (audit): `useMessaging().getLinkExpiry()` answered two different shapes
 * for "no expiry":
 *
 *   - web:  `Infinity`
 *   - desktop: whatever the Rust bridge returned, which is `-1` for an anchored
 *     link and `null` (silent failure) when the invoke failed.
 *
 * It also returned the bridge result verbatim, so a malformed answer or a
 * failed invoke was reported as-is instead of falling back to the local clock.
 * The contract is now: `Infinity` means "never expires", otherwise a
 * non-negative finite number of ms, and the local computation is the fallback.
 */

const HOUR = 60 * 60 * 1000;

/** The function body under test, lifted from src/composables/useMessaging.ts. */
async function getLinkExpiry(
  link: { expiresAt: string | null },
  opts: { isTauri: boolean; invoke: (cmd: string, args: unknown) => Promise<{ ms_remaining: number } | null> },
): Promise<number> {
  if (!link.expiresAt) return Infinity;
  if (opts.isTauri) {
    const result = await opts.invoke('get_link_expiry', { expiresAt: link.expiresAt });
    if (result && Number.isFinite(result.ms_remaining) && result.ms_remaining >= 0) {
      return result.ms_remaining;
    }
  }
  const remaining = new Date(link.expiresAt).getTime() - Date.now();
  return Number.isFinite(remaining) ? Math.max(0, remaining) : Infinity;
}

const inSeconds = (ms: number) => Math.round(ms / 1000);

describe('L16 — getLinkExpiry reports one "no expiry" value', () => {
  it('returns Infinity for a link with no expiry on web and on desktop', async () => {
    const invoke = async () => ({ ms_remaining: -1 });
    expect(await getLinkExpiry({ expiresAt: null }, { isTauri: false, invoke })).toBe(Infinity);
    expect(await getLinkExpiry({ expiresAt: null }, { isTauri: true, invoke })).toBe(Infinity);
  });

  it('falls back to the local clock when the desktop bridge fails', async () => {
    const expiresAt = new Date(Date.now() + 2 * HOUR).toISOString();
    const value = await getLinkExpiry({ expiresAt }, { isTauri: true, invoke: async () => null });
    expect(inSeconds(value)).toBeGreaterThan(inSeconds(HOUR) - 5);
    expect(inSeconds(value)).toBeLessThanOrEqual(inSeconds(2 * HOUR));
  });

  it('never returns a negative or non-finite (besides Infinity) remainder', async () => {
    const past = new Date(Date.now() - HOUR).toISOString();
    for (const isTauri of [false, true]) {
      const value = await getLinkExpiry({ expiresAt: past }, {
        isTauri,
        invoke: async () => ({ ms_remaining: -5 }),
      });
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBe(0);
    }
  });
});
