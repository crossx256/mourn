// tests/mls.adversarial.test.ts
// ADVERSARIAL PROOF that the group E2E is REAL ts-mls crypto, not a fake.
//   - relayed blobs (commit/welcome/ciphertext) must contain ZERO plaintext
//   - bit-flipping the ciphertext must BREAK decryption (proves real AEAD, not passthrough)
//   - a non-member holding no key material must NOT be able to decrypt
// Run: bunx vitest run tests/mls.adversarial.test.ts

import { describe, it, expect } from 'vitest';
import { MlsGroupClient, mlsGroupIdBytes } from '../src/crypto/mlsGroup';

const GROUP_ID = 'adversarial-0000-1111-2222-333333333333';

function flipByte(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // flip a byte in the middle of the payload
  const idx = Math.floor(bytes.length / 2);
  bytes[idx] ^= 0xff;
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return btoa(out);
}

describe('MLS adversarial proof (real crypto, not fake)', () => {
  it('relayed blobs contain NO plaintext + tampering breaks decryption', async () => {
    const creator = (await MlsGroupClient.create(mlsGroupIdBytes(GROUP_ID))).client;
    const bPair = await MlsGroupClient.generateKeyPackagePair('device-B');
    const { commitB64, welcomeB64 } = await creator.addMember(bPair.publicPackageB64);
    const b = await MlsGroupClient.join(
      welcomeB64,
      await MlsGroupClient.decodeKeyPackage(bPair.publicPackageB64),
      bPair.privatePackage,
    );

    const SECRET = 'super-secret-financials-🔥';
    const ct = await creator.encrypt(SECRET);

    // 1. plaintext never transmitted
    expect(ct).not.toContain(SECRET);
    expect(commitB64).not.toContain(SECRET);
    expect(welcomeB64).not.toContain(SECRET);
    // base64 of utf8 'super-secret...' would contain these chars; assert missing
    expect(ct).not.toContain('super');
    expect(ct).not.toContain('secret');

    // Try tampering BEFORE consumption: replay rejection is not evidence of AEAD validation.
    const tampered = flipByte(ct);
    expect(tampered).not.toBe(ct); // actually changed
    let threw = false;
    try {
      await b.decrypt(tampered);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // Failed authentication must leave the valid message consumable.
    expect(await b.decrypt(ct)).toBe(SECRET);
    expect(await b.decrypt(await creator.encrypt('next valid message'))).toBe('next valid message');
  });

  it('a non-member (no key material) CANNOT decrypt the ciphertext', async () => {
    const creator = (await MlsGroupClient.create(mlsGroupIdBytes(GROUP_ID))).client;
    const bPair = await MlsGroupClient.generateKeyPackagePair('device-B');
    const { welcomeB64 } = await creator.addMember(bPair.publicPackageB64);
    const b = await MlsGroupClient.join(
      welcomeB64,
      await MlsGroupClient.decodeKeyPackage(bPair.publicPackageB64),
      bPair.privatePackage,
    );

    const SECRET = 'only-members-see-this';
    const ct = await creator.encrypt(SECRET);
    expect(await b.decrypt(ct)).toBe(SECRET);

    // Build a THIRD party that is NOT in the group (fresh key pair, never added)

    // intruder has no group state, no welcome, no add commit applied.
    // It cannot even construct a valid group client without a welcome.
    // So attempt to decrypt the foreign ciphertext with a brand-new group of its own —
    // it must fail (no shared epoch/key).
    const intruderGroup = (await MlsGroupClient.create(mlsGroupIdBytes('totally-different-group')))
      .client;
    let threw = false;
    try {
      await intruderGroup.decrypt(ct);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true); // real crypto: wrong group/epoch => fail
  });
});
