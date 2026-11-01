// tests/pushDedupe.test.ts
// Guards the device-side push coalescing helpers in src/services/pushDedupe.ts.
// The failure modes this test exists to prevent: a duplicate FCM delivery
// double-posting a foreground banner or double-running store reconciliation,
// and local notifications that are not keyed per conversation.
//
// Run: bunx vitest run tests/pushDedupe.test.ts

import { describe, it, expect } from 'vitest';
import {
  ARRIVAL_TTL_MS,
  arrivalKeyFor,
  createTtlDedupe,
  notificationKeyFor,
} from '../src/services/pushDedupe';

describe('notificationKeyFor (stable per-conversation key)', () => {
  it('prefers the server conversationKey', () => {
    expect(
      notificationKeyFor({ conversationKey: 'link:abc', linkId: 'ignored', groupId: 'ignored' }),
    ).toBe('link:abc');
    expect(notificationKeyFor({ conversationKey: 'group:xyz' })).toBe('group:xyz');
    expect(notificationKeyFor({ conversationKey: 'anonymous' })).toBe('anonymous');
  });

  it('falls back to linkId / groupId on payloads without coalescing metadata', () => {
    expect(notificationKeyFor({ linkId: 'abc' })).toBe('link:abc');
    expect(notificationKeyFor({ groupId: 'xyz' })).toBe('group:xyz');
    // linkId wins when both are somehow present (matches backend conversationKeyFor).
    expect(notificationKeyFor({ linkId: 'abc', groupId: 'xyz' })).toBe('link:abc');
  });

  it('returns null for events with no conversation', () => {
    expect(notificationKeyFor({ event: 'WATCHER_ALERT' })).toBe(null);
    expect(notificationKeyFor({ linkId: '' })).toBe(null);
    expect(notificationKeyFor(null)).toBe(null);
  });
});

describe('arrivalKeyFor (identity of one logical arrival)', () => {
  it('uses messageId as authoritative when present', () => {
    expect(arrivalKeyFor({ event: 'INCOMING_MESSAGE', messageId: 'm1' })).toBe(
      'INCOMING_MESSAGE:m1',
    );
    // Same message, coalesced count advanced => still the same arrival.
    expect(
      arrivalKeyFor({ event: 'INCOMING_MESSAGE', messageId: 'm1', conversationCount: '5' }),
    ).toBe('INCOMING_MESSAGE:m1');
  });

  it('keys conversation pushes by conversationKey + count when there is no messageId', () => {
    expect(
      arrivalKeyFor({ event: 'GROUP_MESSAGE_RECEIVED', conversationKey: 'group:g1', conversationCount: '2' }),
    ).toBe('GROUP_MESSAGE_RECEIVED:group:g1:2');
    // Two distinct messages => distinct counts => distinct arrivals.
    expect(
      arrivalKeyFor({ event: 'GROUP_MESSAGE_RECEIVED', conversationKey: 'group:g1', conversationCount: '3' }),
    ).not.toBe(
      arrivalKeyFor({ event: 'GROUP_MESSAGE_RECEIVED', conversationKey: 'group:g1', conversationCount: '2' }),
    );
  });

  it('defaults the count to 1 and derives a conversation key from raw linkId/groupId', () => {
    expect(arrivalKeyFor({ event: 'INCOMING_MESSAGE', linkId: 'l1' })).toBe(
      'INCOMING_MESSAGE:link:l1:1',
    );
  });

  it('falls back to a whitelisted id then the bare event name', () => {
    expect(arrivalKeyFor({ event: 'LINK_REQUEST', requestId: 'r1' })).toBe(
      'LINK_REQUEST:requestId:r1',
    );
    expect(arrivalKeyFor({ event: 'WATCHER_ALERT' })).toBe('WATCHER_ALERT');
    expect(arrivalKeyFor({})).toBe('UNKNOWN');
  });
});

describe('createTtlDedupe', () => {
  it('reports the first sighting as new and the second as duplicate', () => {
    const dedupe = createTtlDedupe(ARRIVAL_TTL_MS);
    expect(dedupe.seen('k')).toBe(false);
    expect(dedupe.seen('k')).toBe(true);
    expect(dedupe.seen('other')).toBe(false);
  });

  it('expires keys after the TTL window', () => {
    let now = 1_000;
    const dedupe = createTtlDedupe(5 * 60 * 1000, () => now);
    expect(dedupe.seen('k')).toBe(false);
    now += 5 * 60 * 1000; // exactly at the boundary => still a duplicate
    expect(dedupe.seen('k')).toBe(true);
    now += 1; // one ms past => new again
    expect(dedupe.seen('k')).toBe(false);
  });

  it('clears every recorded key', () => {
    const dedupe = createTtlDedupe(ARRIVAL_TTL_MS);
    expect(dedupe.seen('k')).toBe(false);
    dedupe.clear();
    expect(dedupe.seen('k')).toBe(false);
  });

  it('bounds growth by pruning stale keys', () => {
    let now = 0;
    const dedupe = createTtlDedupe(100, () => now);
    for (let i = 0; i < 10; i++) dedupe.seen(`k${i}`);
    now = 1_000; // all stale
    expect(dedupe.seen('fresh')).toBe(false); // triggers the prune pass
    // Nothing stale is reported as a duplicate any more.
    now = 1_001;
    expect(dedupe.seen('k0')).toBe(false);
  });
});
