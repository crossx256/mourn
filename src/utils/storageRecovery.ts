/**
 * Helpers for locating persisted chat history in the key/value store.
 *
 * The key shape is `${PREFIX}${linkId}${SUFFIX}${uid}` — e.g.
 * `vault_messages_3d961125-4bf8-…_uid_e7e465f1-…`.
 *
 * These live here, and are unit-tested, because emergency storage recovery used to
 * look for keys STARTING WITH `vault_messages_${uid}` and take that list from the
 * ratchet index. No key has ever had that shape, so recovery matched nothing,
 * deleted nothing, and still told the user it was "clearing old chats to make room"
 * — a silent no-op that left the device permanently out of space.
 */

export const MESSAGES_KEY_PREFIX = 'vault_messages_';

export function messagesKeySuffix(uid: string): string {
  return `_uid_${uid}`;
}

export function messagesStorageKey(linkId: string, uid: string): string {
  return `${MESSAGES_KEY_PREFIX}${linkId}${messagesKeySuffix(uid)}`;
}

/**
 * The chat-history keys belonging to `uid`, oldest-relevant last.
 *
 * `excludeLinkId` is the conversation that must never be evicted (the open one):
 * its history is unrecoverable, unlike the attachment cache. The exclusion is
 * compared against the DECODED link id, never the assembled string: the old
 * `key.includes(excludeLinkId)` test matched any key that merely CONTAINED the
 * id somewhere else in the key, which is a substring rule, not an identity rule.
 */
export function chatMessageStorageKeys(
  allKeys: readonly unknown[],
  uid: string,
  excludeLinkId?: string,
): string[] {
  if (!uid) return [];
  const suffix = messagesKeySuffix(uid);
  const excluded = excludeLinkId?.trim() || '';
  return allKeys.filter(
    (key): key is string =>
      typeof key === 'string' &&
      key.startsWith(MESSAGES_KEY_PREFIX) &&
      key.endsWith(suffix) &&
      (!excluded || linkIdFromMessageKey(key, uid) !== excluded),
  );
}

/** Recover the linkId from a chat-history key, or '' when the key is not one. */
export function linkIdFromMessageKey(key: string, uid: string): string {
  const suffix = messagesKeySuffix(uid);
  if (!key.startsWith(MESSAGES_KEY_PREFIX) || !key.endsWith(suffix)) return '';
  return key.slice(MESSAGES_KEY_PREFIX.length, key.length - suffix.length);
}
