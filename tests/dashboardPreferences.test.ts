import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadRandomizeFileNames,
  persistRandomizeFileNames,
} from '../src/stores/dashboardPreferences';

/**
 * L14 (audit): `randomizeFileNames` is read by every upload path, but its only
 * durable write lived in PrivacyTab's `v-model` setter. The store setter used
 * by every other caller changed memory only, so a change made anywhere but that
 * tab looked saved until the next launch.
 *
 * The module is exercised directly (no store/pinia boot): it is a localStorage
 * round-trip with defensive handling.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function stubStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, String(value)),
    removeItem: (key: string) => void data.delete(key),
  });
  return data;
}

afterEach(() => vi.unstubAllGlobals());

describe('L14 — randomizeFileNames survives relaunch', () => {
  it('round-trips both values under the key the UI has always used', () => {
    const data = stubStorage();
    expect(loadRandomizeFileNames()).toBe(false);
    persistRandomizeFileNames(true);
    expect(data.get('randomizeFileNames')).toBe('true');
    expect(loadRandomizeFileNames()).toBe(true);
    persistRandomizeFileNames(false);
    expect(loadRandomizeFileNames()).toBe(false);
  });

  it('never throws when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(() => persistRandomizeFileNames(true)).not.toThrow();
    expect(loadRandomizeFileNames()).toBe(false);
  });

  it('the store setter persists and the boot path hydrates from the same module', () => {
    const store = read('src/stores/dashboard.ts');
    expect(store).toContain('persistRandomizeFileNames(value)');
    expect(store).toContain('hydrateRandomizeFileNames()');
    expect(store).toContain('loadRandomizeFileNames()');
    // No component keeps its own copy of the storage key any more.
    for (const path of ['src/components/dashboard/PrivacyTab.vue', 'src/pages/MessagingPage.vue']) {
      expect(read(path)).not.toContain("localStorage.setItem('randomizeFileNames'");
      expect(read(path)).not.toContain("localStorage.getItem('randomizeFileNames')");
    }
  });

  it('stays a device preference: logout does not reset it', () => {
    const store = read('src/stores/dashboard.ts');
    const reset = store.split('$reset()')[1]?.split('\n    },\n')[0] ?? '';
    expect(reset).not.toContain('randomizeFileNames = false');
  });
});
