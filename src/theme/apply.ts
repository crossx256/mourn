import { setCssVar } from 'quasar';
import { DEFAULT_THEME, type ColorToken } from './tokens';
import { PRESETS } from './presets';
import type { ThemePrefs } from './preferences';
// Tokens that carry a page's own brand ink (leaderboard) must follow the active
// accent, otherwise those surfaces stay crimson under every preset. Mirror any
// change here in public/theme-prepaint.js: the pre-hydration paint must agree.
const ACCENT_FOLLOWERS = ['lbRed'] as const;
export const hexToTriplet = (hex: string) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Invalid color');
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ');
};
export function luminance(hex: string) {
  return hexToTriplet(hex)
    .split(' ')
    .map(Number)
    .map((x) => {
      const s = x / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    })
    .reduce((a, x, i) => a + x * ([0.2126, 0.7152, 0.0722][i] ?? 0), 0);
}
export function deriveAccent(hex: string) {
  const rgb = hexToTriplet(hex).split(' ').map(Number);
  const mix = (n: number) =>
    `rgb(${rgb.map((x) => Math.round(n > 0 ? x + (255 - x) * n : x * (1 + n))).join(' ')})`;
  return {
    onAccent: luminance(hex) > 0.179 ? '#000000' : '#ffffff',
    hover: mix(0.12),
    active: mix(-0.1),
    focusRing: `rgb(${rgb.join(' ')} / .35)`,
  };
}
export function resolveTheme(p: ThemePrefs): Record<ColorToken, string> {
  const colors: Record<ColorToken, string> = { ...DEFAULT_THEME, ...PRESETS[p.preset] };
  if (p.accent) colors.accent = p.accent;
  if (p.preset !== 'crimson' || p.accent) {
    colors.accentStrong =
      '#' +
      hexToTriplet(colors.accent)
        .split(' ')
        .map((x) =>
          Math.round(Number(x) * 0.9)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('');
    colors.accentAlt = colors.accent;
    colors.accentAlt2 = colors.accent;
  }
  colors.onAccent = deriveAccent(colors.accent).onAccent;
  for (const token of ACCENT_FOLLOWERS) colors[token] = colors.accent;
  return colors;
}
export function deriveSlots(p: ThemePrefs) {
  const colors = resolveTheme(p);
  const tint = (amount: number) => {
    const accent = hexToTriplet(colors.accent).split(' ').map(Number);
    return (
      '#' +
      hexToTriplet(colors.surface)
        .split(' ')
        .map((value, i) =>
          Math.round(Number(value) * (1 - amount) + (accent[i] ?? 0) * amount)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    );
  };
  const inputBg = tint(0.06),
    bubbleBg = tint(0.12);
  return {
    inputBg,
    inputText: deriveAccent(inputBg).onAccent,
    bubbleBg,
    bubbleText: deriveAccent(bubbleBg).onAccent,
    sendBg: colors.accent,
    sendText: colors.onAccent,
  };
}
export function applyFrosted(enabled: boolean) {
  const path =
    typeof location === 'undefined'
      ? ''
      : location.hash
        ? location.hash.slice(1).split('?')[0]
        : location.pathname;
  if (/^\/(login|forgot-password|reset-password|verify-email|register)(\/|$)/.test(path ?? ''))
    enabled = false;
  const root = document.documentElement;
  if (enabled) root.dataset.frosted = 'on';
  else delete root.dataset.frosted;
  document.body?.classList.toggle('theme-frosted', enabled);
}
const brandBefore = new Map<string, string>();
export function applyTheme(p: ThemePrefs) {
  const root = document.documentElement,
    colors = resolveTheme(p),
    d = deriveAccent(colors.accent);
  for (const [key, value] of Object.entries(colors))
    root.style.setProperty(`--m-${key}-rgb`, hexToTriplet(value));
  for (const key of ['hover', 'active'] as const)
    root.style.setProperty(`--m-accent-${key}`, d[key]);
  root.style.setProperty('--m-focus-ring', d.focusRing);
  for (const [key, value] of Object.entries(deriveSlots(p)))
    root.style.setProperty(`--m-${key}-rgb`, hexToTriplet(value));
  const density = { compact: [4, 32, 12], comfortable: [8, 40, 13], spacious: [12, 48, 14] }[
    p.density
  ];
  ['space-unit', 'row-h', 'font-step'].forEach((key, i) =>
    root.style.setProperty(`--m-${key}`, `${density[i]}px`),
  );
  root.dataset.clientTheme = 'on';
  root.dataset.theme = p.preset;
  // Switching from a custom accent back to the preset accent must also remove the
  // attribute; otherwise the last custom accent stays painted on the next preset.
  if (p.accent) root.dataset.themeAccent = p.accent;
  else delete root.dataset.themeAccent;
  root.dataset.density = p.density;
  root.dataset.chatSize = p.extras.chatTextSize;
  root.dataset.chatDensity = p.extras.chatDensity;
  root.dataset.font = p.font;
  applyFrosted(p.frosted);
  for (const [brand, token] of Object.entries({
    primary: 'accent',
    accent: 'accentAlt',
    secondary: 'textMuted',
    info: 'info',
    negative: 'danger',
    positive: 'success',
    warning: 'warning',
    dark: 'bg',
  })) {
    const key = `--q-${brand}`;
    if (!brandBefore.has(key)) brandBefore.set(key, root.style.getPropertyValue(key));
    setCssVar(brand, colors[token as ColorToken]);
  }
}
export function clearTheme() {
  const root = document.documentElement;
  applyFrosted(false);
  root.removeAttribute?.('data-backdrop-active');
  for (const key of Array.from(root.style))
    if (key.startsWith('--m-')) root.style.removeProperty(key);
  for (const [key, value] of brandBefore) {
    if (value) root.style.setProperty(key, value);
    else root.style.removeProperty(key);
  }
  brandBefore.clear();
  for (const key of [
    'clientTheme',
    'theme',
    'themeAccent',
    'density',
    'chatSize',
    'chatDensity',
    'font',
    'frosted',
  ])
    delete root.dataset[key];
}
