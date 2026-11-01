/**
 * Offline archive codec — serialize an Archive to/from bytes so it can be
 * passed through the encrypted offline vault. The blob is encrypted at rest;
 * this only handles the (de)serialization of the plaintext object.
 */
import type { Archive } from 'src/types/archives';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

/** Serialize an Archive into UTF-8 bytes for the offline vault. */
export function encodeArchivePayload(archive: Archive): Uint8Array {
  return encoder.encode(JSON.stringify(archive));
}

/** Deserialize offline-vault bytes back into an Archive. Throws on malformed JSON. */
export function decodeArchivePayload(bytes: Uint8Array): Archive {
  const text = decoder.decode(bytes);
  return JSON.parse(text) as Archive;
}
