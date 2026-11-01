import { describe, expect, it } from 'vitest';
import { sanitizeStoredMessages } from '../src/utils/storedMessages';

/**
 * Guards the stored-message sanitiser.
 *
 * This is the boundary that keeps ONE bad IndexedDB record from blanking a whole
 * conversation: whatever survives here is what the chat renders from, so it must
 * never let an unrenderable record through and must never itself throw.
 */
describe('sanitizeStoredMessages', () => {
  const good = {
    id: 'm1',
    plaintext: 'hello',
    timestamp: 1_700_000_000_000,
    isSender: true,
  };

  it('passes valid records through', () => {
    const out = sanitizeStoredMessages([good]);
    expect(out).toHaveLength(1);
    expect(out?.[0]?.id).toBe('m1');
    expect(out?.[0]?.status).toBe('SENT');
    expect(out?.[0]?.reactions).toEqual({});
  });

  it('returns null for a missing value and [] for a non-array', () => {
    expect(sanitizeStoredMessages(null)).toBeNull();
    expect(sanitizeStoredMessages(undefined)).toBeNull();
    expect(sanitizeStoredMessages({ not: 'an array' })).toEqual([]);
    expect(sanitizeStoredMessages('garbage')).toEqual([]);
  });

  it('drops only the unusable records, keeping the good ones', () => {
    const out = sanitizeStoredMessages([
      good,
      null,
      'string',
      42,
      {}, // no id / plaintext / timestamp
      { id: 'no-plaintext', timestamp: 1 },
      { id: 'bad-ts', plaintext: 'x', timestamp: 'not-a-number' },
      { id: '', plaintext: 'x', timestamp: 1 },
      { id: 'nan-ts', plaintext: 'x', timestamp: Number.NaN },
      { id: 'm2', plaintext: 'second', timestamp: 2, isSender: false },
    ]);
    expect(out?.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('coerces sloppy-but-usable fields instead of dropping the record', () => {
    const out = sanitizeStoredMessages([
      { id: 'm3', plaintext: 'x', timestamp: 5, isSender: 'yes', status: 7, reactions: 'nope' },
    ]);
    expect(out).toHaveLength(1);
    expect(out?.[0]?.isSender).toBe(false); // only literal true counts
    expect(out?.[0]?.status).toBe('SENT'); // non-string status replaced
    expect(out?.[0]?.reactions).toEqual({}); // non-object reactions replaced
  });

  it('preserves genuine reactions and status', () => {
    const out = sanitizeStoredMessages([
      {
        id: 'm4',
        plaintext: 'x',
        timestamp: 6,
        status: 'FAILED_PROTOCOL',
        reactions: { '❤️': ['ana'] },
      },
    ]);
    expect(out?.[0]?.status).toBe('FAILED_PROTOCOL');
    expect(out?.[0]?.reactions).toEqual({ '❤️': ['ana'] });
  });
});
