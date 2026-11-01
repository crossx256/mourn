import { update } from 'idb-keyval';
import sodium from 'libsodium-wrappers';

const pending = new Map<string, Promise<Uint8Array>>();

/** Single flight per account/key slot; IDB update also serializes other webviews.
 * Only an absent slot is initialized. Corruption must never replace a user's key.
 */
export async function getOrCreateStorageKey(slot: string): Promise<Uint8Array> {
  let promise = pending.get(slot);
  if (!promise) {
    promise = (async () => {
      await sodium.ready;
      let result: Uint8Array | undefined;
      await update<unknown>(slot, (existing) => {
        if (existing !== undefined) {
          if (!(existing instanceof Uint8Array) || existing.length !== 32) {
            throw new Error(`Corrupt storage key: ${slot}`);
          }
          result = existing.slice();
          return existing;
        }
        result = sodium.crypto_secretbox_keygen();
        return result;
      });
      if (!result) throw new Error('Storage key transaction did not complete');
      return result;
    })();
    pending.set(slot, promise);
  }
  try {
    return (await promise).slice();
  } finally {
    if (pending.get(slot) === promise) pending.delete(slot);
  }
}
