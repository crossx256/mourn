/**
 * Offline graveyard codec — serialize the approved Letter[] list to/from bytes
 * for the encrypted offline vault. Only approved/published letters are cached
 * (the 3D galaxy is public); this mirrors what the page already renders so the
 * scene can bootstrap offline.
 */
import type { Letter } from 'src/types/graveyard';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

/** Serialize an approved letter list into UTF-8 bytes for the offline vault. */
export function encodeGraveyardPayload(letters: Letter[]): Uint8Array {
  return encoder.encode(JSON.stringify(letters));
}

/** Deserialize offline-vault bytes back into a letter list. Throws on malformed JSON. */
export function decodeGraveyardPayload(bytes: Uint8Array): Letter[] {
  return JSON.parse(decoder.decode(bytes)) as Letter[];
}
