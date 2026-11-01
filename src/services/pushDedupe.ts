/**
 * Pure helpers for coalescing push arrivals on the device.
 *
 * The backend attaches coalescing metadata to every conversation push (see
 * `mourn.bio/services/pushQueue.js`): `conversationKey` (`link:<id>` /
 * `group:<id>` / `anonymous`), `conversationCount`, `senderLabel`, `anonymous`.
 * This module turns that metadata into:
 *
 *   - a STABLE per-conversation key — the identity any local notification must
 *     carry so Android/iOS REPLACE the conversation's tray entry instead of
 *     stacking a new one per message; and
 *   - a per-arrival key plus a short-lived TTL guard so a push delivered twice
 *     (provider retry, or the same arrival hitting two listeners) does not
 *     double-process or double-post the foreground banner.
 *
 * Everything here is pure/state-free except `createTtlDedupe`, which owns a
 * single Map — so it is unit-tested without a device (tests/pushDedupe.test.ts).
 */

/** How long a delivered arrival is remembered for dedupe purposes (5 minutes). */
export const ARRIVAL_TTL_MS = 5 * 60 * 1000;

/** Identifier fields the backend whitelists into a push payload. */
const ID_FALLBACK_FIELDS = [
  'notificationId',
  'requestId',
  'ticketId',
  'channelId',
  'letterId',
  'blobId',
  'deviceId',
] as const;

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

/** Read a scalar payload value as a non-empty string. FCM data values arrive as strings. */
function readScalar(data: unknown, key: string): string | null {
  const value = asRecord(data)[key];
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Stable per-conversation key for a push payload.
 *
 * Prefers the server's `conversationKey` and falls back to the raw
 * linkId/groupId on payloads that predate coalescing metadata. Returns null for
 * events with no conversation (watcher alerts, link requests, …).
 */
export function notificationKeyFor(data: unknown): string | null {
  const conversationKey = readScalar(data, 'conversationKey');
  if (conversationKey) return conversationKey;
  const linkId = readScalar(data, 'linkId');
  if (linkId) return `link:${linkId}`;
  const groupId = readScalar(data, 'groupId');
  if (groupId) return `group:${groupId}`;
  return null;
}

/**
 * Identity of ONE logical arrival.
 *
 * `messageId` is authoritative when present, so a duplicate delivery of the
 * same message collapses even if the coalesced count changed. Otherwise a
 * conversation's coalesced count stands in (`conversationKey:count`), so two
 * genuinely distinct messages still process while a re-delivery of the same
 * count does not. Non-conversation events fall back to their own event name.
 */
export function arrivalKeyFor(data: unknown): string {
  const event = readScalar(data, 'event') ?? 'UNKNOWN';
  const messageId = readScalar(data, 'messageId');
  if (messageId) return `${event}:${messageId}`;

  const conversationKey = notificationKeyFor(data);
  if (conversationKey) {
    const count = readScalar(data, 'conversationCount') ?? '1';
    return `${event}:${conversationKey}:${count}`;
  }

  for (const field of ID_FALLBACK_FIELDS) {
    const id = readScalar(data, field);
    if (id) return `${event}:${field}:${id}`;
  }
  return event;
}

export interface TtlDedupe {
  /** True when `key` was already seen inside the TTL window; records it otherwise. */
  seen(key: string): boolean;
  /** Forget every recorded key (used on logout / tests). */
  clear(): void;
}

/**
 * Tiny in-memory TTL set. `now` is injectable so tests can advance the clock
 * deterministically instead of sleeping.
 */
export function createTtlDedupe(ttlMs: number, now: () => number = Date.now): TtlDedupe {
  const seenAt = new Map<string, number>();
  return {
    seen(key: string): boolean {
      const current = now();
      for (const [existingKey, timestamp] of seenAt) {
        if (current - timestamp > ttlMs) seenAt.delete(existingKey);
      }
      const previous = seenAt.get(key);
      if (previous !== undefined && current - previous <= ttlMs) return true;
      seenAt.set(key, current);
      return false;
    },
    clear(): void {
      seenAt.clear();
    },
  };
}
