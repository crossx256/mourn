/**
 * VITE_CLIENT_THEMES — the build-time gate for client customization.
 *
 * Policy: OPT-OUT. Only the literal 'false' disables it; unset, 'true' or any
 * other value keep it on. (Before the opt-out flip, released builds had to set
 * VITE_CLIENT_THEMES='true' explicitly in three workflows; now the only reason to
 * set it is to ship a build without customization.)
 *
 * The gate is read in exactly two places, and they must not drift:
 *   - quasar.config.ts      → `clientThemes` html variable (public/theme-prepaint.js)
 *                             and the isolated-build `import.meta.env` define;
 *   - src/stores/theme.ts   → THEME_ENABLED (runtime theme actions; boot/theme.ts
 *                             and BackdropLayer.vue consume it).
 *
 * This module owns the expression both sites use. tests/theme.flag.test.ts
 * executes the real resolver for every input and fails if they disagree.
 */
export const CLIENT_THEMES_EXPRESSION = "process.env.VITE_CLIENT_THEMES === 'false' ? 'false' : 'true'";
export const CLIENT_THEMES_DEFINE: string = process.env.VITE_CLIENT_THEMES === 'false' ? 'false' : 'true';
