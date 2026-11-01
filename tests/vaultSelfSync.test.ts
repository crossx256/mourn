// tests/vaultSelfSync.test.ts
// Guards the ONE pure helper that the cross-device (self-session) vault sync
// added to src/stores/vault.ts: the mapping from the runtime's mobilePlatform()
// value onto the server DevicePlatform enum. That string flows into
// resolveSelfSessionInitiator() on BOTH devices, so a wrong mapping would make
// the two ends elect the SAME ratchet role (or disagree) and desync every
// self-session.
//
// Run: bunx vitest run tests/vaultSelfSync.test.ts

import { describe, it, expect } from 'vitest';
import { serverPlatformFromMobile } from '../src/stores/vault';
import { isMobileDevicePlatform, resolveSelfSessionInitiator } from '../src/crypto/selfSession';

describe('serverPlatformFromMobile', () => {
  it('passes Android and iOS through as the server enum values', () => {
    expect(serverPlatformFromMobile('android')).toBe('ANDROID');
    expect(serverPlatformFromMobile('ios')).toBe('IOS');
  });

  it('maps desktop/browser ("other") to UNKNOWN — the schema has no DESKTOP value', () => {
    expect(serverPlatformFromMobile('other')).toBe('UNKNOWN');
  });

  it('keeps mobile-vs-desktop distinguishable for the role election', () => {
    expect(isMobileDevicePlatform(serverPlatformFromMobile('android'))).toBe(true);
    expect(isMobileDevicePlatform(serverPlatformFromMobile('ios'))).toBe(true);
    expect(isMobileDevicePlatform(serverPlatformFromMobile('other'))).toBe(false);
  });

  it('elects the desktop as initiator on BOTH ends given the same device list', () => {
    // Desktop (UNKNOWN) computing for a paired Android phone.
    const desktopInit = resolveSelfSessionInitiator({
      myDevicePubHex: 'aa'.repeat(32),
      theirDevicePubHex: 'bb'.repeat(32),
      myPlatform: serverPlatformFromMobile('other'),
      theirPlatform: serverPlatformFromMobile('android'),
    });
    // The same phone computing for that desktop (mirrored inputs).
    const mobileInit = resolveSelfSessionInitiator({
      myDevicePubHex: 'bb'.repeat(32),
      theirDevicePubHex: 'aa'.repeat(32),
      myPlatform: serverPlatformFromMobile('android'),
      theirPlatform: serverPlatformFromMobile('other'),
    });

    expect(desktopInit).toBe(true);
    expect(mobileInit).toBe(false);
    // Exactly one side initiates — otherwise the ratchet has no working chain.
    expect(desktopInit).not.toBe(mobileInit);
  });
});
