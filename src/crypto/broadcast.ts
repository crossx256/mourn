// crypto/broadcast.ts
//
// Client-side crypto for the encrypted ANNOUNCEMENT broadcast channel.
// Mirrors the backend's broadcast key-wrap scheme in
// `mourn.bio/controllers/broadcastController.js` using the SAME libsodium
// primitives (which is also what the 1:1 vault ratchet + at-rest encryption use):
//
//   - The server wraps the channel key to this device as a "grant":
//       shared  = DH(devicePriv, grant.senderPub)     // <-- client computes
//       wrapKey = generichash(32, shared, GRANT_DOMAIN)
//       channelKey = secretbox_open_easy(encryptedKey, nonce, wrapKey)
//   - Messages are encrypted/decrypted with that channelKey (XSalsa20 secretbox).
//
// GRANT_DOMAIN must byte-for-byte match the backend's domain-separation key so
// the wrap key derivation is identical on both sides. Never change it here
// without updating the backend.

import sodium from 'libsodium-wrappers';

const GRANT_DOMAIN = sodium.from_string('mourn-broadcast-grant-v1');

function b64ToBytes(b64: string): Uint8Array {
  return sodium.from_base64(b64, sodium.base64_variants.ORIGINAL);
}

function bytesToB64(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

/**
 * Unwrap the channel key from a key-grant returned by POST /broadcast/:id/join.
 *
 * @param grant   { encryptedKey, nonce, senderPub } from the server.
 * @param devicePrivHex  this device's X25519 private key (hex), from the vault.
 * @returns the 32-byte channel key (Uint8Array) or null if the device's private
 *          key doesn't match the pub the grant was wrapped to.
 */
export async function unwrapChannelKeyGrant(
  grant: { encryptedKey: string; nonce: string; senderPub: string },
  devicePrivHex: Promise<Uint8Array | null> | Uint8Array | null,
): Promise<Uint8Array | null> {
  await sodium.ready;
  const priv = await devicePrivHex;
  if (!priv) return null;

  const dh = sodium.crypto_scalarmult(priv, sodium.from_hex(grant.senderPub));
  const wrapKey = sodium.crypto_generichash(32, dh, GRANT_DOMAIN);
  try {
    const opened = sodium.crypto_secretbox_open_easy(
      b64ToBytes(grant.encryptedKey),
      b64ToBytes(grant.nonce),
      wrapKey,
    );
    return opened;
  } catch {
    return null; // wrong device key for this grant
  }
}

/**
 * sign_ed25519 → X25519? No: the app stores the device keypair as X25519
 * (crypto_kx_keypair), which is exactly what scalarmult expects. Keep it as is.
 */

/** Encrypt a broadcast message body with the channel key. */
export async function broadcastEncrypt(
  channelKey: Uint8Array,
  plaintext: string,
): Promise<{ ciphertext: string; nonce: string }> {
  await sodium.ready;
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, channelKey);
  return { ciphertext: bytesToB64(ct), nonce: bytesToB64(nonce) };
}

/** Decrypt a broadcast message body with the channel key. */
export async function broadcastDecrypt(
  channelKey: Uint8Array,
  ciphertext: string,
  nonce: string,
): Promise<string | null> {
  await sodium.ready;
  try {
    const plain = sodium.crypto_secretbox_open_easy(
      b64ToBytes(ciphertext),
      b64ToBytes(nonce),
      channelKey,
    );
    return sodium.to_string(plain);
  } catch {
    return null; // wrong key / tampered
  }
}

/**
 * Derive a stable 32-byte channel key from grant material. Used to cache an
 * opaque local handle (we never persist the raw channel key in plaintext local
 * storage — it's re-derived from the grant each unlock).
 */
export async function deriveLocalChannelKeyHandle(channelKey: Uint8Array): Promise<string> {
  await sodium.ready;
  return bytesToB64(sodium.crypto_generichash(32, channelKey, null));
}
