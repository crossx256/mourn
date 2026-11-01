/**
 * L14 (audit): the "randomize file names" privacy toggle was persisted only by
 * PrivacyTab's `v-model` setter. The store's `setRandomizeFileNames()` — the
 * path every other caller uses — changed memory and nothing else, so a change
 * made anywhere but that tab looked saved until the next launch.
 *
 * One storage module, used by the store setter and by the boot hydration, is
 * the fix. It stays a device-level preference: it is deliberately not part of
 * `$reset()` (logout must not silently re-enable original filenames).
 */
export const RANDOMIZE_FILE_NAMES_STORAGE_KEY = 'randomizeFileNames';

/** localStorage may throw (Safari private mode, denied storage): never fatal. */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadRandomizeFileNames(key: string = RANDOMIZE_FILE_NAMES_STORAGE_KEY): boolean {
  try {
    return storage()?.getItem(key) === 'true';
  } catch {
    return false;
  }
}

export function persistRandomizeFileNames(
  value: boolean,
  key: string = RANDOMIZE_FILE_NAMES_STORAGE_KEY,
): void {
  try {
    storage()?.setItem(key, value ? 'true' : 'false');
  } catch {
    // Storage unavailable: the in-memory value still governs this session.
  }
}
