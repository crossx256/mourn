/**
 * Haptics.
 *
 * Native-only by construction: every call no-ops on web/desktop, so call sites
 * never need to guard (and SSR can't touch Capacitor).
 *
 * The vocabulary is deliberately small — three verbs, used consistently:
 *   tap()      primary navigation and row/button activation  → light impact
 *   select()   moving between tabs or toggle groups          → selection tick
 *   success()  a message actually left the device            → success notification
 *
 * Haptics are a nicety: a device without a vibrator, or a permission/plugin
 * failure, must never surface an error to the user or break the action.
 *
 * They can also be switched OFF entirely (dashboard setting). The toggle lives
 * here so every call site is gated in one place, and the preference persists in
 * localStorage (native shells sync the secure vault, but this is a plain UI
 * nicety that does not need encryption).
 */

import { isCapacitorRuntime } from 'src/utils/platform';

const STORAGE_KEY = 'mourn_haptics_enabled';

function readEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw !== '0';
  } catch {
    return true;
  }
}

let hapticsEnabled = readEnabled();

export function isHapticsEnabled(): boolean {
  return hapticsEnabled;
}

export function setHapticsEnabled(enabled: boolean): void {
  hapticsEnabled = enabled;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

async function load() {
  if (!hapticsEnabled) return null;
  if (!isCapacitorRuntime()) return null;
  try {
    return await import('@capacitor/haptics');
  } catch {
    return null;
  }
}

export async function hapticTap(): Promise<void> {
  const mod = await load();
  if (!mod) return;
  try {
    await mod.Haptics.impact({ style: mod.ImpactStyle.Light });
  } catch {
    /* ignore */
  }
}

export async function hapticSelect(): Promise<void> {
  const mod = await load();
  if (!mod) return;
  try {
    await mod.Haptics.selectionChanged();
  } catch {
    /* ignore */
  }
}

export async function hapticSuccess(): Promise<void> {
  const mod = await load();
  if (!mod) return;
  try {
    await mod.Haptics.notification({ type: mod.NotificationType.Success });
  } catch {
    /* ignore */
  }
}
