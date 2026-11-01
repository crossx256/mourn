import sodium from 'libsodium-wrappers';
import { expect, it, vi } from 'vitest';

import { CipherEngine } from '../engine';

it('does not advance receive state when ciphertext authentication fails', async () => {
  await sodium.ready;
  const alicePrivateKey = sodium.randombytes_buf(sodium.crypto_scalarmult_SCALARBYTES);
  const bobPrivateKey = sodium.randombytes_buf(sodium.crypto_scalarmult_SCALARBYTES);
  const alicePublicKey = sodium.crypto_scalarmult_base(alicePrivateKey);
  const bobPublicKey = sodium.crypto_scalarmult_base(bobPrivateKey);

  const alice = new CipherEngine();
  const bob = new CipherEngine();
  await alice.init(alicePrivateKey, bobPublicKey, 'alice', 'bob');
  await bob.init(bobPrivateKey, alicePublicKey, 'bob', 'alice');

  const validFrame = await alice.encryptFrame('authenticated message');
  const tamperedFrame = {
    ...validFrame,
    ciphertext: validFrame.ciphertext.slice(),
  };
  tamperedFrame.ciphertext[0] = (tamperedFrame.ciphertext[0] ?? 0) ^ 1;

  const stateBeforeFailure = bob.exportRatchetState();
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  await expect(bob.decryptFrame(tamperedFrame)).rejects.toThrow();
  consoleError.mockRestore();

  expect(bob.exportRatchetState()).toEqual(stateBeforeFailure);
  await expect(bob.decryptFrame(validFrame)).resolves.toBe('authenticated message');
});
