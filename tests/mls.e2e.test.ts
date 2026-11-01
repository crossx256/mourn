// tests/mls.e2e.test.ts
//
// End-to-end MLS test (no server, no network). Proves the real crypto path:
//   A creates a group -> A adds B (commit + welcome) -> B joins -> A adds C
//   while B is still at epoch 1 -> B applies the 2nd commit (applyCommit) ->
//   C joins -> all three encrypt/decrypt each other. The "server" would only
//   ever relay opaque blobs (commit/welcome/ciphertext) it cannot read.
//
// Run with:  bunx vitest run tests/mls.e2e.test.ts

import { describe, it, expect } from 'vitest';
import { MlsGroupClient, mlsGroupIdBytes, mlsCiphersuite } from '../src/crypto/mlsGroup';

const GROUP_ID = '11111111-2222-3333-4444-555555555555';

describe('MLS groups (ts-mls, PQC ciphersuite)', () => {
  it("creator can create a group and a member can decrypt the creator's message", async () => {
    const creator = (await MlsGroupClient.create(mlsGroupIdBytes(GROUP_ID))).client;
    const bPair = await MlsGroupClient.generateKeyPackagePair('device-B');
    const { welcomeB64 } = await creator.addMember(bPair.publicPackageB64); // creator -> epoch 1
    const b = await MlsGroupClient.join(
      welcomeB64,
      await MlsGroupClient.decodeKeyPackage(bPair.publicPackageB64),
      bPair.privatePackage,
    ); // B -> epoch 1
    // Realistic path: creator sends, member decrypts (server only ever relays ct).
    const ct = await creator.encrypt('hello member B');
    expect(ct).not.toContain('hello member B');
    expect(await b.decrypt(ct)).toBe('hello member B');
  });

  it('owner adds two members; all three share secrets and can chat (zero-trust)', async () => {
    const creator = (await MlsGroupClient.create(mlsGroupIdBytes(GROUP_ID))).client;

    // Member B joins.
    const bPair = await MlsGroupClient.generateKeyPackagePair('device-B');
    const addB = await creator.addMember(bPair.publicPackageB64); // creator -> epoch 1
    expect(addB.commitB64).not.toContain('topsecret');
    expect(addB.welcomeB64).not.toContain('topsecret');
    const b = await MlsGroupClient.join(
      addB.welcomeB64,
      await MlsGroupClient.decodeKeyPackage(bPair.publicPackageB64),
      bPair.privatePackage,
    ); // B -> epoch 1

    // Owner adds C WHILE B is still at epoch 1 -> produces a 2nd commit.
    const cPair = await MlsGroupClient.generateKeyPackagePair('device-C');
    const addC = await creator.addMember(cPair.publicPackageB64); // creator -> epoch 2
    // B (epoch 1) applies the 2nd commit via the real inbound-commit path.
    await b.applyCommit(addC.commitB64); // B -> epoch 2
    const c = await MlsGroupClient.join(
      addC.welcomeB64,
      await MlsGroupClient.decodeKeyPackage(cPair.publicPackageB64),
      cPair.privatePackage,
    ); // C -> epoch 2

    expect(creator.epoch).toBe(2);
    expect(b.epoch).toBe(2);
    expect(c.epoch).toBe(2);

    // Creator -> B
    const c1 = await creator.encrypt('from creator to B');
    expect(await b.decrypt(c1)).toBe('from creator to B');

    // B -> C
    const c2 = await b.encrypt('from B to C');
    expect(await c.decrypt(c2)).toBe('from B to C');

    // C -> creator
    const c3 = await c.encrypt('from C to creator');
    expect(await creator.decrypt(c3)).toBe('from C to creator');

    // Serialization round-trips (local at-rest persistence), and the restored
    // client can still read live traffic.
    const cs = await mlsCiphersuite();
    const restored = MlsGroupClient.deserialize(creator.serialize(), cs);
    const c4 = await restored.encrypt('persisted roundtrip');
    expect(await b.decrypt(c4)).toBe('persisted roundtrip');
  });

  it('a member that joined can decrypt post-add traffic (epoch boundary)', async () => {
    const creator = (await MlsGroupClient.create(mlsGroupIdBytes(GROUP_ID))).client;
    const bPair = await MlsGroupClient.generateKeyPackagePair('device-B');
    const { commitB64, welcomeB64 } = await creator.addMember(bPair.publicPackageB64);
    const b = await MlsGroupClient.join(
      welcomeB64,
      await MlsGroupClient.decodeKeyPackage(bPair.publicPackageB64),
      bPair.privatePackage,
    );
    const ct = await creator.encrypt('post-add message');
    expect(await b.decrypt(ct)).toBe('post-add message');
  });
});
