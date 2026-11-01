import { describe, expect, it } from 'vitest';
import {
  chatMessageStorageKeys,
  linkIdFromMessageKey,
  messagesStorageKey,
} from '../src/utils/storageRecovery';

const UID = 'e7e465f1-1111-2222-3333-444444444444';
const OTHER_UID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const LINK_A = '3d961125-4bf8-4fa8-8f6e-262f082289b2';
const LINK_B = '8521da21-0000-1111-2222-333333333333';

describe('chatMessageStorageKeys', () => {
  it('matches the real key shape', () => {
    const key = messagesStorageKey(LINK_A, UID);
    expect(key).toBe(`vault_messages_${LINK_A}_uid_${UID}`);
    expect(chatMessageStorageKeys([key], UID)).toEqual([key]);
  });

  it('regression: the old "vault_messages_${uid}" prefix matched nothing', () => {
    // The previous filter looked for keys starting with `vault_messages_${uid}`.
    // Assert both that such a key is not what we produce, and that a key of that
    // (never-written) shape is NOT what recovery now selects.
    const realKey = messagesStorageKey(LINK_A, UID);
    expect(realKey.startsWith(`vault_messages_${UID}`)).toBe(false);
    expect(chatMessageStorageKeys([`vault_messages_${UID}`], UID)).toEqual([]);
  });

  it('never selects another account’s chats', () => {
    const mine = messagesStorageKey(LINK_A, UID);
    const theirs = messagesStorageKey(LINK_A, OTHER_UID);
    expect(chatMessageStorageKeys([mine, theirs], UID)).toEqual([mine]);
  });

  it('never selects the open conversation', () => {
    const open = messagesStorageKey(LINK_A, UID);
    const other = messagesStorageKey(LINK_B, UID);
    expect(chatMessageStorageKeys([open, other], UID, LINK_A)).toEqual([other]);
  });

  it('excludes by exact link id, never by substring (CS-10)', () => {
    // A key whose linkId merely CONTAINS the open id must still be evictable;
    // substring matching silently protected the wrong conversations.
    const open = messagesStorageKey(LINK_A, UID);
    const containing = messagesStorageKey(`${LINK_A}-suffix`, UID);
    const other = messagesStorageKey(LINK_B, UID);

    const selected = chatMessageStorageKeys([open, containing, other], UID, LINK_A);
    expect(selected).toContain(containing);
    expect(selected).toContain(other);
    expect(selected).not.toContain(open);
  });

  it('excludes a key that only embeds the open id outside the linkId segment', () => {
    // `vault_messages_<link>_uid_<uid>` where the LINK itself does not match but
    // happens to carry the open id in its own text: still a different chat.
    const open = messagesStorageKey(LINK_A, UID);
    const embedded = messagesStorageKey(`${LINK_B}${LINK_A}`, UID);
    expect(chatMessageStorageKeys([open, embedded], UID, LINK_A)).toEqual([embedded]);
  });

  it('ignores unrelated keys and non-strings', () => {
    const keys = [
      messagesStorageKey(LINK_A, UID),
      'vault_ratchet_index_' + UID,
      'vault_device_id',
      'mourn-chat-draft:' + LINK_A,
      42,
      null,
      undefined,
    ];
    expect(chatMessageStorageKeys(keys, UID)).toEqual([messagesStorageKey(LINK_A, UID)]);
  });

  it('returns nothing without a uid', () => {
    expect(chatMessageStorageKeys([messagesStorageKey(LINK_A, UID)], '')).toEqual([]);
  });
});

describe('linkIdFromMessageKey', () => {
  it('round-trips the link id', () => {
    expect(linkIdFromMessageKey(messagesStorageKey(LINK_A, UID), UID)).toBe(LINK_A);
  });

  it('returns empty for foreign keys', () => {
    expect(linkIdFromMessageKey(`vault_messages_${LINK_A}`, UID)).toBe('');
    expect(linkIdFromMessageKey(messagesStorageKey(LINK_A, OTHER_UID), UID)).toBe('');
  });
});
