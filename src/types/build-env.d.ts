// Compile-time flags injected by quasar.config.ts -> build.define.
// Never read these directly outside src/utils/platform.ts — that module is the
// single source of truth for platform decisions.

/** Which ship this bundle is for. */
declare const __MOURN_TARGET__: 'web' | 'desktop' | 'mobile';

/** Tauri desktop build (Windows/Linux). */
declare const __MOURN_DESKTOP_BUILD__: boolean;

/** Capacitor mobile build (Android/iOS). */
declare const __MOURN_MOBILE_BUILD__: boolean;

/** Any native shell build (desktop OR mobile). */
declare const __MOURN_NATIVE_BUILD__: boolean;
