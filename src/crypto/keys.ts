import sodium from 'libsodium-wrappers';
import type { KeyPair } from './types';
import { del, get } from 'idb-keyval';
import { getSecureStorage } from 'src/services/nativeSecureStorage';

export class KeyManager {
  private inited = false;

  async init() {
    if (!this.inited) {
      await sodium.ready;
      this.inited = true;
    }
  }

  /**
   * Generates a long-term Ed25519 Identity Key Pair
   * Used for establishing consistent user identity (signing)
   */
  generateIdentityKeyPair(): KeyPair {
    const keyPair = sodium.crypto_sign_keypair();
    return {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
    };
  }

  /**
   * Generates an X25519 Device Key Pair
   * Used for ECDH (Elliptic-Curve Diffie-Hellman) key exchange
   */
  generateDeviceKeyPair(): KeyPair {
    const keyPair = sodium.crypto_kx_keypair();
    return {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
    };
  }

  /**
   * Convert an Ed25519 EdDSA public key to X25519 ECDH public key
   * for encryption purposes if required.
   */
  convertIdentityPubToDevicePub(identityPub: Uint8Array): Uint8Array {
    return sodium.crypto_sign_ed25519_pk_to_curve25519(identityPub);
  }

  /**
   * Convert an Ed25519 EdDSA private key to X25519 ECDH private key
   */
  convertIdentityPrivToDevicePriv(identityPriv: Uint8Array): Uint8Array {
    return sodium.crypto_sign_ed25519_sk_to_curve25519(identityPriv);
  }

  private encodeKey(keyData: Uint8Array): string {
    let binary = '';
    for (const byte of keyData) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  private decodeKey(encoded: string): Uint8Array {
    const binary = atob(encoded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async storeKey(keyName: string, keyData: Uint8Array): Promise<void> {
    // No plaintext fallback, including a native build with an unavailable bridge.
    const storage = getSecureStorage();
    if (!storage) throw new Error('Secure key storage unavailable');
    if (storage) {
      await storage.set(keyName, this.encodeKey(keyData));
      await del(keyName);
      return;
    }
    throw new Error('Secure key storage unavailable');
  }

  async getStoredKey(keyName: string): Promise<Uint8Array | undefined> {
    const storage = getSecureStorage();
    if (!storage) throw new Error('Secure key storage unavailable');
    if (storage) {
      const stored = await storage.get(keyName);
      if (stored) return this.decodeKey(stored);

      // Pre-secure-storage install: migrate a legacy plaintext IndexedDB key
      // into the OS store, then remove it. Without this an existing desktop
      // install would look like a brand-new device and lose its identity.
      const legacyKey = await get<Uint8Array>(keyName);
      if (legacyKey) {
        await this.storeKey(keyName, legacyKey);
        return legacyKey;
      }
      return undefined;
    }
    throw new Error('Secure key storage unavailable');
  }

  async deleteStoredKey(keyName: string): Promise<void> {
    const storage = getSecureStorage();
    if (!storage) throw new Error('Secure key storage unavailable');
    await storage.remove(keyName);
    await del(keyName);
  }

  /**
   * Generate a safety number for out-of-band key verification.
   *
   * Computes five rounds of unkeyed BLAKE2b-512 over sorted public keys, encoding the first
   * 30 bytes as a 60-digit decimal string grouped into 12 blocks of 5.
   * Identical output for both parties regardless of call order.
   *
   * Usage: both users compare the displayed number in person or over
   * a trusted side-channel. A mismatch indicates different key material, not necessarily MITM.
   */
  static generateSafetyNumber(myIdentityPub: Uint8Array, theirIdentityPub: Uint8Array): string {
    // Deterministic ordering: lower pub first so both parties get the same hash.
    const cmp = sodium.compare(myIdentityPub, theirIdentityPub);
    const first = cmp <= 0 ? myIdentityPub : theirIdentityPub;
    const second = cmp <= 0 ? theirIdentityPub : myIdentityPub;

    const combined = new Uint8Array(first.length + second.length);
    combined.set(first, 0);
    combined.set(second, first.length);

    // Existing compatibility format; not Signal's safety-number algorithm.
    // Byte modulo 100 is biased: 60 displayed digits do not imply 60 digits of entropy.
    let hash = sodium.crypto_generichash(64, combined, null);
    for (let i = 0; i < 4; i++) {
      hash = sodium.crypto_generichash(64, hash, null);
    }

    // Take first 30 bytes → 60 decimal digits → 12 groups of 5
    const digits: string[] = [];
    for (let i = 0; i < 30; i++) {
      // Map each byte (0–255) to two decimal digits (00–99)
      // Use modular reduction: byte % 100 → 2 digits
      digits.push(String((hash[i] as number) % 100).padStart(2, '0'));
    }
    const raw = digits.join('');
    // Group into 12 blocks of 5 digits
    const blocks: string[] = [];
    for (let i = 0; i < 60; i += 5) {
      blocks.push(raw.slice(i, i + 5));
    }
    return blocks.join(' ');
  }
}
