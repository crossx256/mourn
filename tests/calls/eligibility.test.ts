import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { canOfferVoiceCall, showCallNavigation } from '../../src/calls/eligibility';
import type { Link } from '../../src/types/links';

const device = { id: '11111111-1111-4111-8111-111111111111', devicePub: 'ab'.repeat(32), identityPub: 'cd'.repeat(32) };
const link = {
  id: '22222222-2222-4222-8222-222222222222', senderId: 'alice', receiverId: 'bob', status: 'ESTABLISHED',
  expiresAt: '2030-01-01T00:00:00.000Z', sender: { devices: [] }, receiver: { devices: [device] },
} as unknown as Link;
const availability = { enabled: true, supported: true, ready: true };
const now = Date.parse('2026-11-11T00:00:00.000Z');

describe('call entry-point eligibility', () => {
  it('hides navigation when logged out, on web, or while the server flag is off', () => {
    expect(showCallNavigation(true, true, true)).toBe(true);
    expect(showCallNavigation(false, true, true)).toBe(false);
    expect(showCallNavigation(true, false, true)).toBe(false);
    expect(showCallNavigation(true, true, false)).toBe(false);
  });
  it('requires a current participant, enrolled peer and supported ready client', () => {
    expect(canOfferVoiceCall(link, 'alice', availability, now)).toBe(true);
    expect(canOfferVoiceCall(link, 'bob', availability, now)).toBe(false);
    expect(canOfferVoiceCall(link, 'stranger', availability, now)).toBe(false);
    expect(canOfferVoiceCall(null, 'alice', availability, now)).toBe(false);
    for (const key of ['enabled', 'supported', 'ready'] as const)
      expect(canOfferVoiceCall(link, 'alice', { ...availability, [key]: false }, now)).toBe(false);
  });
  it('excludes expired/severed links, corrupt keys and quarantined peer devices', () => {
    expect(canOfferVoiceCall({ ...link, status: 'SEVERED' }, 'alice', availability, now)).toBe(false);
    expect(canOfferVoiceCall({ ...link, expiresAt: new Date(now).toISOString() }, 'alice', availability, now)).toBe(false);
    expect(canOfferVoiceCall({ ...link, expiresAt: 'invalid' }, 'alice', availability, now)).toBe(false);
    expect(canOfferVoiceCall({ ...link, status: 'ANCHORED', expiresAt: new Date(now - 1).toISOString() }, 'alice', availability, now)).toBe(true);
    expect(canOfferVoiceCall(link, 'alice', availability, now, { [device.id]: true })).toBe(false);
    const corrupt = { ...link, receiver: { ...link.receiver, devices: [{ ...device, identityPub: 'bad' }] } };
    expect(canOfferVoiceCall(corrupt, 'alice', availability, now)).toBe(false);
  });
  it('wires every shell Calls link to flag-aware visibility and keeps the web-only messaging hint independent', () => {
    const main = readFileSync(new URL('../../src/layouts/MainLayout.vue', import.meta.url), 'utf8');
    const { descriptor } = parse(main);
    expect(descriptor.template?.content.match(/to="\/calls"/g)).toHaveLength(2);
    expect(descriptor.template?.content.match(/v-if="callsVisible"/g)).toHaveLength(2);
    expect(main).toContain('v-if="!isNativeShell"');
    const messaging = readFileSync(new URL('../../src/pages/MessagingPage.vue', import.meta.url), 'utf8');
    expect(messaging).toContain('v-if="callsStore.enabled"');
    expect(messaging).toContain('v-if="showCallButton"');
  });
});
