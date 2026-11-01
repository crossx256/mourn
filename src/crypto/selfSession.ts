/**
 * Cross-device (self-session) vault sync helpers.
 *
 * These are the PURE, dependency-free pieces shared by both ends of a
 * "self-session" — a Double-Ratchet session between two devices that belong to
 * the SAME user account. They are split out here (rather than living inside
 * `engine.ts` / `vault.ts`) so they can be unit-tested without libsodium, a
 * live socket, or IndexedDB.
 *
 * Two things must be byte-identical on both devices or the ratchet desyncs:
 *   1. WHO is the initiator (one side MUST be `initSender`, the other
 *      `initReceiver`; a self-session where both pick the same role has no
 *      working chain).
 *   2. The history-envelope wire shape, so a replayed past message keeps its
 *      ORIGINAL timestamp and sent/received side instead of being stamped
 *      "now, received".
 */

/** Server `DevicePlatform` values that identify a mobile (Capacitor) device. */
export const MOBILE_DEVICE_PLATFORMS = ['ANDROID', 'IOS'] as const;

export type DevicePlatformLike = string | null | undefined;

/**
 * True when a server-reported platform belongs to a mobile device. A desktop
 * (Tauri) device registers with `UNKNOWN`/`null` — there is no DESKTOP enum
 * value in the schema — so "not mobile" is the desktop signal.
 */
export function isMobileDevicePlatform(platform: DevicePlatformLike): boolean {
  if (!platform) return false;
  const normalized = String(platform).toUpperCase();
  return (MOBILE_DEVICE_PLATFORMS as readonly string[]).includes(normalized);
}

export interface SelfSessionRoleInput {
  /** This device's own long-term device public key, lowercase hex. */
  myDevicePubHex: string;
  /** The other own-device's long-term device public key, lowercase hex. */
  theirDevicePubHex: string;
  /** This device's server platform (ANDROID/IOS/UNKNOWN/null). */
  myPlatform?: DevicePlatformLike;
  /** The other device's server platform. */
  theirPlatform?: DevicePlatformLike;
}

/**
 * Deterministically decide who is the Double-Ratchet INITIATOR for a session
 * between two devices of the same account.
 *
 * Rule (both sides compute the SAME answer from the SAME inputs):
 *   - If exactly one side is a mobile (Android/iOS) device, the DESKTOP side
 *     initiates. This guarantees the desktop can always send the one-time
 *     history backfill to a freshly-paired mobile BEFORE the mobile has any
 *     ratchet state.
 *   - Otherwise (both mobile, or both desktop/unknown) fall back to the
 *     lexicographically-smaller device public key.
 *
 * Both devices must have the SAME device list (the server's own-devices
 * endpoint) so the platform fields agree.
 */
export function resolveSelfSessionInitiator(input: SelfSessionRoleInput): boolean {
  const myHex = String(input.myDevicePubHex || '').toLowerCase();
  const theirHex = String(input.theirDevicePubHex || '').toLowerCase();

  const mineMobile = isMobileDevicePlatform(input.myPlatform);
  const theirsMobile = isMobileDevicePlatform(input.theirPlatform);

  if (mineMobile !== theirsMobile) {
    // Exactly one is mobile → the desktop side is the initiator.
    return !mineMobile;
  }

  // Same device class → deterministic total order on the device pub.
  // Plain code-unit comparison (lowercase hex ⇒ identical to byte order).
  return myHex < theirHex;
}

// ── History envelope ─────────────────────────────────────────────────────────

export interface HistoryEntry {
  /** Original absolute UTC epoch ms of the message being replayed. */
  ts: number;
  /** True when the ORIGINAL message was sent by this account. */
  fromSelf: boolean;
  /** The original plaintext payload (may itself be a v1 message envelope). */
  body: string;
}

export interface HistoryEnvelope extends HistoryEntry {
  v: 1;
  type: 'history';
}

/**
 * Wrap one stored message for relay to another own-device. Carries the original
 * timestamp + sent/received side so the receiver reconstructs the conversation
 * in place rather than stamping "now".
 */
export function buildHistoryEnvelope(entry: HistoryEntry): string {
  const envelope: HistoryEnvelope = {
    v: 1,
    type: 'history',
    ts: Math.round(Number(entry.ts)),
    fromSelf: entry.fromSelf === true,
    body: typeof entry.body === 'string' ? entry.body : '',
  };
  return JSON.stringify(envelope);
}

/**
 * Parse a history envelope. Returns null for anything that is not EXACTLY a
 * well-formed history envelope, so a malformed/legacy payload is never
 * mis-ingested as a replayed message.
 */
export function parseHistoryEnvelope(plaintext: string): HistoryEnvelope | null {
  if (!plaintext || plaintext.charAt(0) !== '{') return null;
  try {
    const parsed = JSON.parse(plaintext) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.v !== 1 || parsed.type !== 'history') return null;
    if (typeof parsed.ts !== 'number' || !Number.isFinite(parsed.ts)) return null;
    if (typeof parsed.body !== 'string') return null;
    return {
      v: 1,
      type: 'history',
      ts: Math.round(parsed.ts),
      fromSelf: parsed.fromSelf === true,
      body: parsed.body,
    };
  } catch {
    return null;
  }
}

/** djb2 string hash — small, stable, collision-tolerant enough for a dedup id. */
function djb2(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Stable dedup id for a replayed history entry. Derived ONLY from the content
 * that identifies the original message — (original ts, side, body) — so a
 * duplicate backfill (e.g. the same history relayed twice, or relayed by two
 * sources) collapses to a single stored message.
 */
export function historyEntryId(ts: number, fromSelf: boolean, body: string): string {
  return `hist_${Math.round(ts)}_${fromSelf ? 's' : 'r'}_${djb2(body)}`;
}
