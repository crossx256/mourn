/**
 * Mourn platform detection — the ONE source of truth for "where am I running?".
 *
 * Three ships, three native realities:
 *   web      public site (Quasar SPA/SSR). No native shell, no Vault, no messaging.
 *   desktop  Tauri 2 app (Windows + Linux). Native reach = Rust commands
 *            (keychain, credentials, window/tray, updater, Discord RPC, badges).
 *   mobile   Capacitor app (Android first, iOS later). No Rust; native reach =
 *            Capacitor plugins.
 *
 * The `__MOURN_*` flags are compile-time constants injected by
 * `quasar.config.ts` -> build.define, so every branch below is statically
 * resolved and the unused platforms get tree-shaken out of the bundle.
 *
 * CONTRACT (do not blur these three lines):
 *   1. `isNativeBuild`       — desktop OR mobile. Gates Vault/messaging/offline
 *                              features that exist in any native shell and are
 *                              deliberately absent from the public website.
 *   2. `isDesktopBuild`      — the Tauri desktop build (compile-time).
 *   3. `isTauriRuntime()` /  — which native shell is ACTUALLY attached right now
 *      `isCapacitorRuntime()`   (runtime detection; a desktop BUILD can still run
 *                              in a plain browser during dev).
 *
 * Never gate a Tauri-only capability on `isNativeBuild`: `@tauri-apps/*` does
 * not exist inside Capacitor, and the reverse is true for `@capacitor/*`.
 */

export type MournPlatform = 'web' | 'desktop' | 'mobile';
export type NativeShell = 'tauri' | 'capacitor' | 'none';

/**
 * Read a compile-time define without exploding when it is absent (unit tests,
 * plain vitest runs and the SSR server do not always get the defines injected).
 */
function readDefine<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/** The platform this bundle was BUILT for. */
export const MOURN_PLATFORM: MournPlatform = readDefine<MournPlatform>(
  () => __MOURN_TARGET__ as MournPlatform,
  'web',
);

export const isWebBuild: boolean = MOURN_PLATFORM === 'web';
export const isDesktopBuild: boolean = MOURN_PLATFORM === 'desktop';
export const isMobileBuild: boolean = MOURN_PLATFORM === 'mobile';

/**
 * True in ANY native shell build (desktop or mobile). This is the flag that
 * decides whether Vault/messaging surfaces are compiled in and reachable.
 */
export const isNativeBuild: boolean = isDesktopBuild || isMobileBuild;

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

/** Running inside the Tauri webview (desktop app). */
export function isTauriRuntime(): boolean {
  if (!hasWindow()) return false;
  const w = window as unknown as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__);
}

/**
 * Running inside a Capacitor webview (Android/iOS app).
 *
 * Detected through the injected bridge global rather than by importing
 * `@capacitor/core`, so this helper stays dependency-free and safe to call from
 * desktop/web code paths that must never pull the Capacitor runtime in.
 */
export function isCapacitorRuntime(): boolean {
  if (!hasWindow()) return false;
  const w = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    capacitor?: unknown;
  };
  if (typeof w.Capacitor?.isNativePlatform === 'function') {
    return w.Capacitor.isNativePlatform();
  }
  // Fallback signal: Capacitor injects `window.Capacitor` and the webview
  // reports a `capacitor://` / `https://localhost` origin (see capacitor.config).
  return Boolean(w.capacitor) && /^(capacitor|ionic):/.test(window.location?.protocol || '');
}

/** Which native shell is attached right now ('none' in a browser/SSR). */
export function nativeShell(): NativeShell {
  if (isTauriRuntime()) return 'tauri';
  if (isCapacitorRuntime()) return 'capacitor';
  return 'none';
}

/**
 * True when this build targets a native shell AND that shell is actually
 * attached. Use this to gate behaviour that must never run on the website
 * (e.g. auto-login from the OS keychain, Vault transport) while still being
 * false in `quasar dev` browser previews.
 */
export function isNativeShellActive(): boolean {
  return isNativeBuild && nativeShell() !== 'none';
}

/** Android/iOS runtime specifics (safe to call anywhere). */
export function mobilePlatform(): 'android' | 'ios' | 'other' {
  if (!isCapacitorRuntime()) return 'other';
  const p = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor
    ?.getPlatform?.();
  if (p === 'android' || p === 'ios') return p;
  return 'other';
}
