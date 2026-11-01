import sodium from 'libsodium-wrappers';
import type { RatchetState } from './types';

type SodiumKeyPair = { publicKey: Uint8Array; privateKey: Uint8Array };

// ---------------------------------------------------------------------------
// KDF helpers — BLAKE2b-MAC via libsodium crypto_generichash.
// Custom KDF_RK / KDF_CK: these are NOT Signal's HKDF construction.
// ---------------------------------------------------------------------------
export class KDF {
  /**
   * KDF_RK(rk, dh_out) → (new_rk, new_ck)
   * BLAKE2b-MAC(key=rk, msg=dh_out), output 64 bytes split 32|32.
   */
  static deriveRoot(
    rk: Uint8Array,
    dhOut: Uint8Array,
  ): { rootKey: Uint8Array; chainKey: Uint8Array } {
    const out = sodium.crypto_generichash(64, dhOut, rk);
    return { rootKey: out.slice(0, 32), chainKey: out.slice(32, 64) };
  }

  /**
   * KDF_CK(ck) → (new_ck, mk)
   * Domain-separated: BLAKE2b-MAC(key=ck, msg=0x01) → new chain key
   *                   BLAKE2b-MAC(key=ck, msg=0x02) → message key
   */
  static deriveChain(ck: Uint8Array): { chainKey: Uint8Array; messageKey: Uint8Array } {
    const chainKey = sodium.crypto_generichash(32, new Uint8Array([0x01]), ck);
    const messageKey = sodium.crypto_generichash(32, new Uint8Array([0x02]), ck);
    return { chainKey, messageKey };
  }
}

// ---------------------------------------------------------------------------
// Mourn's Double-Ratchet-style protocol (not Signal-compatible).
// Uses keyed BLAKE2b and a symmetric pre-init chain in addition to DH ratcheting.
//
// State:
//   DHs  — my current sending ratchet keypair (pub = header field in every msg).
//   DHr  — remote party's latest ratchet pub (null until first message received).
//   RK   — 32-byte root key; advances twice per DHR step.
//   CKs  — sending chain key; KDF_CK advances it per send.
//   CKr  — receiving chain key; KDF_CK advances it per receive.
//   Ns / Nr — per-chain message counters.
//   PN   — messages in previous sending chain (for receiver's skip cache).
//   MKSKIPPED — cached message keys for out-of-order delivery.
//
// Initialization (role determined by comparing device public keys):
//
//   Alice (lower pub, "initiator"):
//     DHs  = fresh generate_dh()
//     DHr  = Bob's device pub   <- his initial ratchet pub
//     (RK, CKs) = KDF_RK(SK, DH(DHs.priv, DHr))
//     CKr  = null
//
//   Bob (higher pub, "responder"):
//     DHs  = {bobDevicePub, bobDevicePriv}   <- device KP IS initial ratchet KP
//     DHr  = null
//     RK   = SK
//     CKs  = null,  CKr = null
//
// First message from Alice carries header.dh = Alice.DHs.pub (new to Bob).
// Bob's DHRatchetStep derives (via DH symmetry) the same CKr as Alice's CKs.
// Key agreement holds at initialization.
// ---------------------------------------------------------------------------

const MAX_SKIP = 1000;
export const MAX_COUNTER = 0xffffffff;

export function assertRatchetCounter(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_COUNTER) {
    throw new Error('Ratchet counter must be a uint32');
  }
}

function assertKey(value: unknown): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new Error('Ratchet key must contain exactly 32 bytes');
  }
}

function decodeKey(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('Invalid canonical ratchet key');
  }
  return sodium.from_hex(value);
}

export class DoubleRatchet {
  private RK: Uint8Array | null = null;
  private DHs: SodiumKeyPair | null = null;
  private DHr: Uint8Array | null = null;
  private CKs: Uint8Array | null = null;
  private CKr: Uint8Array | null = null;
  private Ns = 0;
  private Nr = 0;
  private PN = 0;
  private MKSKIPPED = new Map<string, Uint8Array>();

  public isInitialized = false;

  async init() {
    await sodium.ready;
  }

  /** No-op — kept for interface compat with engine.importRatchetState(). */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setDevicePrivKey(_priv: Uint8Array) {}

  /**
   * Derive the symmetric epoch-0 chain key from SK.
   *
   * Both parties compute identical SK via DH symmetry, so both get the same output.
   * Used to seed:
   *   - Bob's initial CKs: allows Bob to send before receiving anything from Alice.
   *   - Alice's initial CKr: allows Alice to decrypt Bob's pre-receive sends.
   *
   * Domain-separated from all KDF_RK outputs (0x01 input vs 32-byte DH point).
   */
  static preInitChain(SK: Uint8Array): Uint8Array {
    return KDF.deriveChain(SK).chainKey;
  }

  // ── Initialization ────────────────────────────────────────────────────────

  /**
   * Alice ("initiator", lower device pub).
   * SK = DH(aliceDevicePriv, bobDevicePub).
   * theirRatchetPub = Bob's device pub (his initial DHs pub).
   *
   * CKr is pre-seeded with preInitChain(SK) so Alice can decrypt Bob's
   * pre-receive sends (sent using Bob's symmetric CKs).
   * DHr = bobDevPub → no DHR step fires when Bob sends with his device pub.
   */
  initSender(SK: Uint8Array, theirRatchetPub: Uint8Array): void {
    assertKey(SK);
    assertKey(theirRatchetPub);
    this.DHs = sodium.crypto_kx_keypair();
    this.DHr = theirRatchetPub.slice();
    const dh = sodium.crypto_scalarmult(this.DHs.privateKey, this.DHr);
    const { rootKey, chainKey } = KDF.deriveRoot(SK, dh);
    this.RK = rootKey;
    this.CKs = chainKey;
    this.CKr = DoubleRatchet.preInitChain(SK); // pre-seed so Alice can recv Bob's epoch-0 sends
    this.Ns = 0;
    this.Nr = 0;
    this.PN = 0;
    this.MKSKIPPED.clear();
    this.isInitialized = true;
  }

  /**
   * Bob ("responder", higher device pub).
   * SK = DH(bobDevicePriv, aliceDevicePub).
   * myInitialKeyPair = Bob's device keypair (becomes his initial DHs).
   *
   * CKs is pre-seeded with preInitChain(SK) so Bob can send before receiving.
   * DHr stays null → DHR step fires naturally on Alice's first message.
   */
  initReceiver(SK: Uint8Array, myInitialKeyPair: SodiumKeyPair): void {
    assertKey(SK);
    assertKey(myInitialKeyPair.publicKey);
    assertKey(myInitialKeyPair.privateKey);
    this.RK = SK.slice();
    this.DHs = {
      publicKey: myInitialKeyPair.publicKey.slice(),
      privateKey: myInitialKeyPair.privateKey.slice(),
    };
    this.DHr = null;
    this.CKs = DoubleRatchet.preInitChain(SK); // pre-seed so Bob can send before receiving
    this.CKr = DoubleRatchet.preInitChain(SK); // pre-seed so Bob can recv Alice's first message
    this.Ns = 0;
    this.Nr = 0;
    this.PN = 0;
    this.MKSKIPPED.clear();
    this.isInitialized = true;
  }

  // ── Send ──────────────────────────────────────────────────────────────────

  /**
   * Signal RatchetEncrypt (send side).
   * Advances CKs via KDF_CK — no DH per send.
   * Chain key advancement alone provides per-message forward secrecy.
   */
  ratchetForSend(): {
    messageKey: Uint8Array;
    senderDHRPub: Uint8Array;
    messageIndex: number;
    PN: number;
  } {
    if (!this.RK || !this.DHs || !this.CKs) {
      throw new Error(
        'Ratchet not ready for sending — CKs is null. ' +
          'The responder (Bob) must receive at least one message before sending.',
      );
    }
    if (this.Ns >= MAX_COUNTER) throw new Error('Sending chain counter exhausted');
    const { chainKey, messageKey } = KDF.deriveChain(this.CKs);
    this.CKs = chainKey;
    const messageIndex = this.Ns;
    this.Ns += 1;
    return { messageKey, senderDHRPub: this.DHs.publicKey.slice(), messageIndex, PN: this.PN };
  }

  // ── Receive ───────────────────────────────────────────────────────────────

  /**
   * Signal RatchetDecrypt (receive side).
   *
   * senderDHRPub = header.dh   — sender's current DHs pub
   * messageIndex = header.Ns   — position in sender's current chain
   * PN           = header.PN   — length of sender's previous chain
   */
  processRatchetStep(
    senderDHRPub: Uint8Array,
    messageIndex: number,
    PN: number,
  ): { messageKey: Uint8Array; messageIndex: number } {
    if (!this.RK || !this.DHs) throw new Error('Ratchet not initialized');
    assertKey(senderDHRPub);
    assertRatchetCounter(messageIndex);
    assertRatchetCounter(PN);
    if (messageIndex === MAX_COUNTER) throw new Error('Receiving chain counter exhausted');

    // 1. Check skipped-key cache (out-of-order delivery)
    const cacheId = `${sodium.to_hex(senderDHRPub)}:${messageIndex}`;
    const cached = this.MKSKIPPED.get(cacheId);
    if (cached) {
      this.MKSKIPPED.delete(cacheId);
      return { messageKey: cached, messageIndex };
    }

    const theirHex = sodium.to_hex(senderDHRPub);
    const ourDHrHex = this.DHr ? sodium.to_hex(this.DHr) : null;

    // Perform a DH Ratchet step whenever the sender's ratchet pub changes.
    // This applies BOTH when DHr was previously set (sender rotated their key)
    // AND when DHr is null (responder receiving the very first message from
    // the initiator).  The full DHR step is required in both cases:
    //
    //   (RK, CKr) = KDF_RK(RK, DH(myDHs.priv, senderDHRPub))
    //
    // For the first-receive case (DHr=null), this makes CKr match the
    // initiator's CKs by DH symmetry:
    //   initiator: CKs from KDF_RK(SK, DH(aliceDHs.priv, bobDevPub))
    //   responder: CKr from KDF_RK(SK, DH(bobDevPriv, aliceDHs.pub))
    //              = same value, because DH is commutative ✓
    //
    // Skipping the DHR step here (the old "SECURITY FIX") broke all
    // initiator→responder first messages: CKr stayed as preInitChain(SK)
    // which never equals the initiator's KDF_RK-derived CKs.
    if (theirHex !== ourDHrHex && ourDHrHex !== null && PN < this.Nr) {
      throw new Error(`Stale previous-chain message key not available (PN ${PN} < Nr ${this.Nr})`);
    }

    if (theirHex !== ourDHrHex) {
      this.skipMessageKeys(PN);
      this.dhRatchetStep(senderDHRPub);
    }

    if (messageIndex < this.Nr) {
      throw new Error(
        `Stale message key not available (messageIndex ${messageIndex} < Nr ${this.Nr})`,
      );
    }

    // 2b. Cache any messages skipped within the current receiving chain.
    this.skipMessageKeys(messageIndex);

    if (!this.CKr) throw new Error('CKr is null — no receiving chain established yet');
    const { chainKey, messageKey } = KDF.deriveChain(this.CKr);
    this.CKr = chainKey;
    this.Nr += 1;

    return { messageKey, messageIndex };
  }

  // ── DHR step (Signal paper §2.5 step 4) ──────────────────────────────────

  private dhRatchetStep(theirNewDHRPub: Uint8Array): void {
    if (!this.RK || !this.DHs) throw new Error('Ratchet not initialized');

    this.PN = this.Ns;
    this.Ns = 0;
    this.Nr = 0;
    this.DHr = theirNewDHRPub.slice();

    // Step A: (RK, CKr) = KDF_RK(RK, DH(myDHs.priv, theirNewDHRPub))
    const dh1 = sodium.crypto_scalarmult(this.DHs.privateKey, this.DHr);
    const s1 = KDF.deriveRoot(this.RK, dh1);
    this.RK = s1.rootKey;
    this.CKr = s1.chainKey;

    // Zero old DHs priv immediately (forward secrecy)
    this.DHs.privateKey.fill(0);

    // Step B: generate new DHs, then (RK, CKs) = KDF_RK(RK, DH(newDHs.priv, theirNewDHRPub))
    this.DHs = sodium.crypto_kx_keypair();
    const dh2 = sodium.crypto_scalarmult(this.DHs.privateKey, this.DHr);
    const s2 = KDF.deriveRoot(this.RK, dh2);
    this.RK = s2.rootKey;
    this.CKs = s2.chainKey;
  }

  // ── Skip helpers ──────────────────────────────────────────────────────────

  private skipMessageKeys(until: number): void {
    if (this.Nr >= until) return;
    if (!this.CKr || !this.DHr) return; // no receiving chain yet
    if (this.Nr + MAX_SKIP < until) {
      throw new Error(`Too many skipped messages (${until - this.Nr} > ${MAX_SKIP})`);
    }
    while (this.Nr < until) {
      const { chainKey, messageKey } = KDF.deriveChain(this.CKr);
      this.CKr = chainKey;
      const id = `${sodium.to_hex(this.DHr)}:${this.Nr}`;
      this.MKSKIPPED.set(id, messageKey);
      if (this.MKSKIPPED.size > MAX_SKIP) {
        const first = this.MKSKIPPED.keys().next().value;
        if (first) {
          this.MKSKIPPED.get(first)?.fill(0);
          this.MKSKIPPED.delete(first);
        }
      }
      this.Nr += 1;
    }
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  exportState(): RatchetState {
    if (!this.RK || !this.DHs) throw new Error('Ratchet not initialized');
    return {
      version: 4,
      RK_hex: sodium.to_hex(this.RK),
      DHs_pubHex: sodium.to_hex(this.DHs.publicKey),
      DHs_privHex: sodium.to_hex(this.DHs.privateKey),
      DHr_pubHex: this.DHr ? sodium.to_hex(this.DHr) : null,
      CKs_hex: this.CKs ? sodium.to_hex(this.CKs) : null,
      CKr_hex: this.CKr ? sodium.to_hex(this.CKr) : null,
      Ns: this.Ns,
      Nr: this.Nr,
      PN: this.PN,
      MKSKIPPED: Array.from(this.MKSKIPPED.entries()).map(([id, key]) => ({
        id,
        keyHex: sodium.to_hex(key),
      })),
    };
  }

  /** Drop only a receiving key. An index alone refers to the CURRENT remote chain.
   * Older chains require their exact public key; never rotate DH on a deletion hint.
   */
  dropReceivingKey(messageIndex: number, senderDHRPub?: Uint8Array): void {
    assertRatchetCounter(messageIndex);
    const remote = senderDHRPub ?? this.DHr;
    if (!remote) throw new Error('Receiving chain is not established');
    assertKey(remote);
    const id = `${sodium.to_hex(remote)}:${messageIndex}`;
    const cached = this.MKSKIPPED.get(id);
    if (cached) {
      cached.fill(0);
      this.MKSKIPPED.delete(id);
      return;
    }
    if (!this.DHr || !sodium.memcmp(remote, this.DHr)) {
      throw new Error('Cannot advance an unknown or previous receiving chain');
    }
    if (messageIndex < this.Nr) return; // Already consumed/dropped; idempotent.
    const before = this.exportState();
    try {
      this.processRatchetStep(remote, messageIndex, this.PN).messageKey.fill(0);
    } catch (error) {
      this.importState(before);
      throw error;
    }
  }

  importState(state: RatchetState): void {
    // Parse into temporary state. A rejected import must not partially replace keys.
    if (!state || state.version !== 4) throw new Error('Ratchet state requires exact version 4');
    assertRatchetCounter(state.Ns);
    assertRatchetCounter(state.Nr);
    assertRatchetCounter(state.PN);
    const RK = decodeKey(state.RK_hex);
    const DHs = { publicKey: decodeKey(state.DHs_pubHex), privateKey: decodeKey(state.DHs_privHex) };
    if (!sodium.memcmp(sodium.crypto_scalarmult_base(DHs.privateKey), DHs.publicKey)) {
      throw new Error('Ratchet keypair does not match');
    }
    const DHr = state.DHr_pubHex === null ? null : decodeKey(state.DHr_pubHex);
    const CKs = state.CKs_hex === null ? null : decodeKey(state.CKs_hex);
    const CKr = state.CKr_hex === null ? null : decodeKey(state.CKr_hex);
    if ((!CKs && state.Ns !== 0) || (!CKr && state.Nr !== 0) || (!DHr && state.Nr !== 0)) {
      throw new Error('Inconsistent ratchet counters and chains');
    }
    if (!Array.isArray(state.MKSKIPPED) || state.MKSKIPPED.length > MAX_SKIP) {
      throw new Error('Invalid skipped-key cache');
    }
    const skipped = new Map<string, Uint8Array>();
    for (const entry of state.MKSKIPPED) {
      if (!entry || typeof entry.id !== 'string' || !/^[0-9a-f]{64}:(0|[1-9][0-9]*)$/.test(entry.id)) {
        throw new Error('Invalid skipped-key identity');
      }
      const index = Number(entry.id.slice(65));
      assertRatchetCounter(index);
      if (index === MAX_COUNTER || skipped.has(entry.id) ||
          (DHr && entry.id.slice(0, 64) === state.DHr_pubHex && index >= state.Nr)) {
        throw new Error('Invalid skipped-key position');
      }
      skipped.set(entry.id, decodeKey(entry.keyHex));
    }
    if (state.devicePubBinding !== undefined) {
      decodeKey(state.devicePubBinding.myDevicePubHex);
      decodeKey(state.devicePubBinding.theirDevicePubHex);
      if (!Number.isSafeInteger(state.devicePubBinding.bindingTime) || state.devicePubBinding.bindingTime < 0) {
        throw new Error('Invalid device binding time');
      }
    }
    this.RK?.fill(0);
    this.DHs?.privateKey.fill(0);
    this.CKs?.fill(0);
    this.CKr?.fill(0);
    for (const key of this.MKSKIPPED.values()) key.fill(0);
    this.RK = RK;
    this.DHs = DHs;
    this.DHr = DHr;
    this.CKs = CKs;
    this.CKr = CKr;
    this.Ns = state.Ns;
    this.Nr = state.Nr;
    this.PN = state.PN;
    this.MKSKIPPED = skipped;
    this.isInitialized = true;
  }
}
