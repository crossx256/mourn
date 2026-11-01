import sodium from 'libsodium-wrappers';
import type { EncryptedMessage, LinkSecurityState, RatchetState } from './types';
import { PaddingLayer } from './padding';
import { assertRatchetCounter, DoubleRatchet } from './ratchet';

/**
 * CipherEngine — Mourn's custom Double-Ratchet-style E2EE layer, not Signal-compatible.
 *
 * Wraps DoubleRatchet with:
 *   - XChaCha20-Poly1305 AEAD.
 *   - AD = senderDHRPub (32 B) || messageIndex (4 B LE) || PN (4 B LE).
 *     Header tampering causes AEAD authentication failure before decryption.
 *   - Identity key TOFU + mismatch detection.
 *   - Responder state initially contains a COPY of the long-term device private key.
*     Treat every exported state as secret; encrypt it at rest, even before the first transition.
 */
export class CipherEngine {
  private inited = false;
  private ratchet: DoubleRatchet | null = null;
  private storedIdentityKey?: Uint8Array;
  private isCompromised = false;

  public onIdentityMismatch?: (details: {
    storedIdentityKey: Uint8Array;
    receivedIdentityKey: Uint8Array;
  }) => void;

  async init(
    myDevicePriv: Uint8Array,
    theirDevicePub: Uint8Array,
    myUserId?: string,
    theirUserId?: string,
    /**
     * Cross-device (self-session) role override. When two devices belong to the
     * SAME user id the HMAC(userIds) rule below collapses to a single value for
     * BOTH parties (the sorted pair is identical on each side), so both would
     * pick the same role and the ratchet would have no working chain. Callers
     * detect a self-session and pass an explicit, symmetric role computed by
     * `resolveSelfSessionInitiator()` (src/crypto/selfSession.ts).
     */
    selfSession?: { iAmInitiator: boolean },
  ) {
    if (!this.inited) {
      await sodium.ready;
      this.inited = true;
    }

    const myDevicePub = sodium.crypto_scalarmult_base(myDevicePriv);
    const SK = sodium.crypto_scalarmult(myDevicePriv, theirDevicePub);

    const ratchet = new DoubleRatchet();
    await ratchet.init();

    // SECURITY: Determine initiator role using cryptographically-bound user ID comparison
    // Role is derived from HMAC(SK, sorted(userId1, userId2)) to ensure:
    //   - Roles are consistent between parties
    //   - Role cannot be forged without knowing SK (requires DH private keys)
    //   - Stable across device pub/account changes
    let iAmInitiator: boolean;

    if (selfSession) {
      // Cross-device self-session: the explicit, symmetric role wins over the
      // HMAC rule (which is degenerate when myUserId === theirUserId).
      iAmInitiator = selfSession.iAmInitiator === true;
      if (import.meta.env.DEV) {
        console.debug('[Engine] Role: explicit self-session role', { iAmInitiator });
      }
    } else if (myUserId && theirUserId) {
      // Cryptographically-bound role: HMAC ties role to shared secret
      // Both parties independently compute same role from same shared secret
      const userIdString = [myUserId, theirUserId].sort().join('||');
      const hmacHash = await crypto.subtle.sign(
        'HMAC',
        await crypto.subtle.importKey(
          'raw',
          new Uint8Array(SK), // Ensure proper Uint8Array type for crypto.subtle
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        ),
        new TextEncoder().encode(userIdString),
      );
      const hmacArray = new Uint8Array(hmacHash);
      const roleValue = hmacArray[0] ?? 0; // Ensure roleValue is never undefined

      // Determine role based on HMAC output and order of user IDs
      const myUserIdFirst = myUserId < theirUserId;
      const thisPartyIsInitiator = roleValue < 128;
      iAmInitiator = myUserIdFirst ? thisPartyIsInitiator : !thisPartyIsInitiator;

      if (import.meta.env.DEV) {
        console.debug('[Engine] Role: HMAC-bound to shared secret', {
          iAmInitiator,
        });
      }
    } else {
      // Fallback: Device pub comparison (less stable but cryptographically secure)
      iAmInitiator = sodium.compare(myDevicePub, theirDevicePub) < 0;
      if (import.meta.env.DEV) {
        console.debug('[Engine] Role: Device pub comparison (user IDs unavailable)', {
          iAmInitiator,
        });
      }
    }

    if (iAmInitiator) {
      ratchet.initSender(SK, theirDevicePub);
    } else {
      ratchet.initReceiver(SK, { publicKey: myDevicePub, privateKey: myDevicePriv });
    }

    this.ratchet = ratchet;
  }

  exportRatchetState(): RatchetState {
    if (!this.ratchet) throw new Error('Engine not initialized');
    return this.ratchet.exportState();
  }

  async importRatchetState(state: RatchetState) {
    if (!this.ratchet) {
      const ratchet = new DoubleRatchet();
      await ratchet.init();
      this.ratchet = ratchet;
    }
    await sodium.ready;
    this.ratchet.importState(state);
    // DHs.priv is part of the encrypted persisted state, including the initial device key.
  }

  bindIdentityKey(identityKey: Uint8Array) {
    if (!(identityKey instanceof Uint8Array) || identityKey.length !== 32) {
      throw new Error('Identity key must contain exactly 32 bytes');
    }
    this.storedIdentityKey = identityKey.slice();
    this.isCompromised = false;
  }

  getLinkSecurityState(): LinkSecurityState {
    return {
      storedIdentityKey: this.storedIdentityKey ? sodium.to_hex(this.storedIdentityKey) : undefined,
      isCompromised: this.isCompromised,
    };
  }

  /**
   * Encrypt a plaintext message.
   *
   * Key derivation (custom ratchet send):
   *   - Advance CKs via KDF_CK → message key.
   *   - No DH per message — chain advancement alone provides forward secrecy.
   *   - DHR step happens only on receive (when sender's DHs pub changes).
   *
   * AEAD additional data = senderDHRPub (32 B) || msgIndex (4 B LE) || PN (4 B LE)
   *   Authenticates the complete header; any tampering causes decryption failure.
   */
  async encryptFrame(plaintext: string): Promise<EncryptedMessage> {
    if (!this.ratchet) throw new Error('Engine not initialized');

    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const paddedMsg = PaddingLayer.applyPadding(plaintext);

    const { messageKey, senderDHRPub, messageIndex, PN } = this.ratchet.ratchetForSend();
    const ad = buildAD(senderDHRPub, messageIndex, PN);

    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      paddedMsg,
      ad,
      null,
      nonce,
      messageKey,
    );

    messageKey.fill(0);

    return { ciphertext, nonce, messageIndex, senderDHRPub, PN };
  }

  /**
   * Decrypt a received message transactionally.
   *
   * Performs a DHR step automatically when senderDHRPub differs from the last
   * observed value, advancing RK/CKr/CKs and providing break-in recovery.
   * Then derives the message key from KDF_CK(CKr) at the correct chain position.
   */
  async decryptFrame(
    cipherPkg: EncryptedMessage,
    opts?: { senderIdentityKey?: Uint8Array },
  ): Promise<string> {
    if (!this.ratchet) throw new Error('Engine not initialized');
    if (!cipherPkg.senderDHRPub) throw new Error('Missing senderDHRPub in packet');

    if (!(cipherPkg.senderDHRPub instanceof Uint8Array) || cipherPkg.senderDHRPub.length !== 32) {
      throw new Error('Invalid senderDHRPub');
    }
    const identity = opts?.senderIdentityKey?.slice();
    if (identity && identity.length !== 32) throw new Error('Invalid sender identity key');

    const msgIndex = assertFrameCounter(cipherPkg.messageIndex, 'messageIndex');
    const pn = assertFrameCounter(cipherPkg.PN, 'PN');

    const previousState = this.ratchet.exportState();
    const previousIdentity = this.storedIdentityKey?.slice();
    const previousCompromised = this.isCompromised;
    let messageKey: Uint8Array | null = null;
    const ad = buildAD(cipherPkg.senderDHRPub, msgIndex, pn);

    try {
      ({ messageKey } = this.ratchet.processRatchetStep(cipherPkg.senderDHRPub, msgIndex, pn));
      const paddedMsg = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        cipherPkg.ciphertext,
        ad,
        cipherPkg.nonce,
        messageKey,
      );

      const plaintext = PaddingLayer.stripPadding(paddedMsg);
      // TOFU/mismatch observations are made only after authenticating the frame.
      this.assertIdentityKey(identity);
      return plaintext;
    } catch (decryptErr) {
      messageKey?.fill(0);
      this.ratchet.importState(previousState);
      this.storedIdentityKey = previousIdentity;
      this.isCompromised = previousCompromised;

      // Log detailed diagnostics without exposing or retaining failed state.
      let ratchetState: RatchetState | null = null;
      try {
        ratchetState = this.exportRatchetState();
      } catch (stateErr) {
        console.warn('[Engine] Could not export ratchet state for diagnostics:', stateErr);
      }

      console.error('[Engine] Decryption failed - AEAD authentication mismatch', {
        reason: (decryptErr as Error).message,
        ad_values: {
          messageIndex: msgIndex,
          PN: pn,
          senderDHRPub_head: sodium.to_hex(cipherPkg.senderDHRPub).slice(0, 16),
        },
        packet_fields: {
          messageIndex: cipherPkg.messageIndex,
          PN: cipherPkg.PN,
          has_nonce: !!cipherPkg.nonce,
          has_ciphertext: !!cipherPkg.ciphertext,
        },
        ratchetState: {
          Ns: ratchetState?.Ns,
          Nr: ratchetState?.Nr,
          PN: ratchetState?.PN,
          CKr_exists: !!ratchetState?.CKr_hex,
        },
      });
      throw decryptErr;
    } finally {
      messageKey?.fill(0);
    }
  }

  /** Local deletion only: index is zero-based within the remote receiving chain.
   * Supply senderDHRPub for an older chain. This never advances the sending chain.
   */
  async advanceRatchetAndDropKey(msgIndex: number, senderDHRPub?: Uint8Array): Promise<void> {
    if (!this.ratchet) throw new Error('Engine not initialized');
    this.ratchet.dropReceivingKey(msgIndex, senderDHRPub);
  }

  private assertIdentityKey(senderIdentityKey?: Uint8Array) {
    if (!senderIdentityKey) return;
    if (!this.storedIdentityKey) {
      this.storedIdentityKey = senderIdentityKey.slice();
      return;
    }
    if (!sodium.memcmp(this.storedIdentityKey, senderIdentityKey)) {
      this.isCompromised = true;
      if (this.onIdentityMismatch) {
        this.onIdentityMismatch({
          storedIdentityKey: this.storedIdentityKey.slice(),
          receivedIdentityKey: senderIdentityKey.slice(),
        });
      }
      throw new Error('Identity key mismatch detected for this link.');
    }
  }
}

/**
 * Build the AEAD additional data block.
 * AD = senderDHRPub (32 B) || messageIndex (4 B LE) || PN (4 B LE) = 40 bytes total.
 * Authenticates the complete message header — any field tampering fails AEAD.
 */
function assertFrameCounter(value: unknown, field: 'messageIndex' | 'PN'): number {
  try {
    assertRatchetCounter(value);
    return value;
  } catch {
    throw new Error(`Invalid encrypted frame header: ${field} must be a uint32.`);
  }
}

function buildAD(senderDHRPub: Uint8Array, messageIndex: number, PN: number): Uint8Array {
  const ad = new Uint8Array(32 + 4 + 4);
  ad.set(senderDHRPub, 0);
  new DataView(ad.buffer).setUint32(32, messageIndex, true); // little-endian
  new DataView(ad.buffer).setUint32(36, PN, true);
  return ad;
}
