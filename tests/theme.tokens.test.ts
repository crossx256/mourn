import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
vi.mock('quasar', () => ({ setCssVar: vi.fn() }));
import { DEFAULT_THEME } from '../src/theme/tokens';
import { defaults, normalizePrefs, validatePrefs } from '../src/theme/preferences';
import { ACCENTS, isAllowedAccent } from '../src/theme/ramp';
import { PRESETS, type Preset } from '../src/theme/presets';
import {
  applyTheme,
  clearTheme,
  resolveTheme,
  hexToTriplet,
  deriveAccent,
  deriveSlots,
  luminance,
} from '../src/theme/apply';
import unoConfig from '../uno.config';
const contrast = (a: string, b: string) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
describe('theme contract and tokens', () => {
  it('keeps active-theme aliases more specific than late-loaded legacy root rules', () => {
    const css = readFileSync(new URL('../src/css/theme-tokens.scss', import.meta.url), 'utf8');
    const active = css.match(/:root\[data-client-theme='on'\] \{([^}]+)\}/)?.[1];
    expect(active).toBeDefined();
    for (const alias of ['primary', 'dash-accent', 'dash-bg', 'dash-text', 'black', 'card'])
      expect(active).toMatch(new RegExp(`--${alias}\\s*:\\s*rgb\\(var\\(--m-`));
    const roots = [...css.matchAll(/(?:^|\n):root \{([^}]+)\}/g)];
    expect(roots.some((rule) => rule[1]?.includes('--m-accent-rgb: 255 0 0;'))).toBe(true);
    expect(roots.every((rule) => !/--primary\s*:/.test(rule[1] ?? ''))).toBe(true);
  });
  it('matches every SCSS default exactly once', () => {
    const css = readFileSync(new URL('../src/css/theme-tokens.scss', import.meta.url), 'utf8');
    const entries = [...css.matchAll(/--m-([A-Za-z0-9]+)-rgb: ([\d ]+);/g)].filter(
      (entry) => !entry[1]?.startsWith('legacy'),
    );
    expect(entries).toHaveLength(Object.keys(DEFAULT_THEME).length);
    for (const [key, value] of Object.entries(DEFAULT_THEME))
      expect(entries.filter((x) => x[1] === key).map((x) => x[2])).toEqual([hexToTriplet(value)]);
  });
  it('keeps crimson identical and resolves all five palettes', () => {
    expect(JSON.stringify(resolveTheme(defaults()))).toBe(JSON.stringify(DEFAULT_THEME));
    for (const preset of Object.keys(PRESETS) as Preset[])
      expect(Object.keys(resolveTheme({ ...defaults(), preset }))).toEqual(
        Object.keys(DEFAULT_THEME),
      );
  });
  it('provides complete distinct nondefault palettes with exact accents', () => {
    const keys = [
      'bg',
      'surface',
      'card',
      'elevated',
      'hover',
      'border',
      'borderStrong',
      'text',
      'textMuted',
      'textDim',
    ] as const;
    const accents = { void: '#cccccc', phosphor: '#00ff00', ice: '#00ffff', violet: '#bb88ff' };
    for (const preset of Object.keys(accents) as (keyof typeof accents)[]) {
      const palette = PRESETS[preset];
      expect(palette.accent).toBe(accents[preset]);
      for (const key of keys) {
        expect(palette[key]).toMatch(/^#[0-9a-f]{6}$/);
        if (preset === 'void' && key === 'bg') expect(palette[key]).toBe('#000000');
        else expect(palette[key]).not.toBe(DEFAULT_THEME[key]);
      }
      const overridden = resolveTheme({ ...defaults(), preset, accent: '#0080ff' });
      for (const key of keys) expect(overridden[key]).toBe(palette[key]);
    }
    for (const key of keys)
      expect(
        new Set(
          Object.values(PRESETS)
            .slice(1)
            .map((p) => p[key as keyof typeof p]),
        ).size,
      ).toBe(4);
  });
  it('preserves non-themed legacy utility colors and border alias', () => {
    const css = readFileSync(new URL('../src/css/theme-tokens.scss', import.meta.url), 'utf8');
    const legacy = {
      legacyBg: '13 17 23',
      legacyBorder: '48 54 61',
      legacyWarning: '210 153 34',
      legacyAccentDark: '65 1 1',
    };
    for (const [key, triplet] of Object.entries(legacy)) {
      expect(css).toContain(`--m-${key}-rgb: ${triplet};`);
      expect(DEFAULT_THEME).not.toHaveProperty(key);
      for (const preset of Object.keys(PRESETS) as Preset[])
        expect(resolveTheme({ ...defaults(), preset })).not.toHaveProperty(key);
    }
    const colors = unoConfig.theme?.colors;
    expect(colors).toMatchObject({
      'bg-primary': 'rgb(var(--m-legacyBg-rgb, 13 17 23))',
      'primary-dark': 'rgb(var(--m-legacyAccentDark-rgb, 65 1 1))',
      warning: 'rgb(var(--m-legacyWarning-rgb, 210 153 34))',
      border: 'rgb(var(--m-legacyBorder-rgb, 48 54 61))',
      'arc-border': 'rgb(255 255 255 / 0.1)',
      'arc-border-hover': 'rgb(255 255 255 / 0.18)',
    });
    expect(css).not.toMatch(/--border\s*:/);
    expect(css).toContain('--warning: rgb(var(--m-legacyWarning-rgb));');
  });
  it('leaves crimson aliases in the existing cascade but themes nondefault palettes', () => {
    const css = readFileSync(new URL('../src/css/theme-tokens.scss', import.meta.url), 'utf8');
    // Token defaults must live at plain :root. Component rules read rgb(var(--m-…-rgb))
    // directly, so a default that only exists under [data-client-theme='on'] invalidates the
    // declaration whenever the theme is OFF (black-on-black text, transparent panels).
    const base = css.match(/\n:root \{([^}]+)\}/)?.[1];
    const nondefault = css.match(
      /:root\[data-client-theme='on'\]:not\(\[data-theme='crimson'\]\) \{([^}]+)\}/,
    )?.[1];
    expect(base).toBeDefined();
    expect(nondefault).toBeDefined();
    const aliases = { muted: 'textMuted', 'hella-muted': 'textDim', 'dash-error': 'danger' };
    for (const [alias, token] of Object.entries(aliases)) {
      expect(base).not.toMatch(new RegExp(`--${alias}\\s*:`));
      expect(nondefault).toContain(`--${alias}: rgb(var(--m-${token}-rgb));`);
      // No other theme rule may override the inherited crimson value.
      expect([...css.matchAll(new RegExp(`--${alias}\\s*:`, 'g'))]).toHaveLength(1);
    }
  });
  it('wires only consumed interaction variables and clears accent selector state', () => {
    const vars = new Map<string, string>();
    const dataset: Record<string, string> = {};
    const classes = new Set<string>();
    vi.stubGlobal('document', {
      body: {
        classList: {
          toggle: (key: string, enabled: boolean) =>
            enabled ? classes.add(key) : classes.delete(key),
          remove: (key: string) => classes.delete(key),
        },
      },
      documentElement: {
        dataset,
        style: {
          setProperty: (key: string, value: string) => vars.set(key, value),
          getPropertyValue: (key: string) => vars.get(key) ?? '',
          removeProperty: (key: string) => vars.delete(key),
          [Symbol.iterator]: () => vars.keys(),
        },
      },
    });
    try {
      applyTheme({
        ...defaults(),
        accent: '#0080ff',
        frosted: true,
        font: 'opendyslexic',
      });
      expect(dataset.themeAccent).toBe('#0080ff');
      expect(dataset.frosted).toBe('on');
      expect(dataset.font).toBe('opendyslexic');
      expect(classes.has('theme-frosted')).toBe(true);
      for (const [key, value] of Object.entries(deriveSlots({ ...defaults(), accent: '#0080ff' })))
        expect(vars.get(`--m-${key}-rgb`)).toBe(hexToTriplet(value));
      const derived = deriveAccent('#0080ff');
      expect(vars.get('--m-accent-hover')).toBe(derived.hover);
      expect(vars.get('--m-accent-active')).toBe(derived.active);
      expect(vars.get('--m-focus-ring')).toBe(derived.focusRing);
      expect(vars.has('--m-accent-dim')).toBe(false);
      expect(vars.has('--m-accent-glow')).toBe(false);
      applyTheme(defaults());
      expect(dataset.themeAccent).toBeUndefined();
      expect(dataset.frosted).toBeUndefined();
      expect(classes.has('theme-frosted')).toBe(false);
      expect(dataset.font).toBe('mono');
      for (const [key, value] of Object.entries(DEFAULT_THEME))
        expect(vars.get(`--m-${key}-rgb`)).toBe(hexToTriplet(value));
      const css = readFileSync(new URL('../src/css/theme-tokens.scss', import.meta.url), 'utf8');
      expect(css).toContain(":is(:not([data-theme='crimson']), [data-theme-accent])");
      for (const key of ['accent-hover', 'accent-active', 'focus-ring'])
        expect(css).toContain(`var(--m-${key})`);
      vi.stubGlobal('location', { pathname: '/login', hash: '' });
      applyTheme({ ...defaults(), frosted: true });
      expect(classes.has('theme-frosted')).toBe(false);
      expect(dataset.frosted).toBeUndefined();
      vi.stubGlobal('location', { pathname: '/', hash: '#/register/invite/abc' });
      applyTheme({ ...defaults(), frosted: true });
      expect(classes.has('theme-frosted')).toBe(false);
      vi.stubGlobal('location', { pathname: '/dashboard', hash: '' });
      applyTheme({ ...defaults(), frosted: true });
      clearTheme();
      expect(classes.has('theme-frosted')).toBe(false);
      expect(dataset).toEqual({});
      expect(vars.size).toBe(0);
    } finally {
      clearTheme();
      vi.unstubAllGlobals();
    }
  });
  it('derives local input/send/bubble slots with 4.5 contrast for every palette and swatch', () => {
    for (const preset of Object.keys(PRESETS) as Preset[]) {
      for (const accent of [null, ...ACCENTS]) {
        const prefs = { ...defaults(), preset, accent };
        const slots = deriveSlots(prefs);
        for (const slot of ['input', 'send', 'bubble'] as const) {
          expect(contrast(slots[`${slot}Text`], slots[`${slot}Bg`])).toBeGreaterThanOrEqual(4.5);
        }
        expect(slots.sendBg).toBe(resolveTheme(prefs).accent);
        expect(deriveSlots({ ...prefs, accent: '#ffff00' }).bubbleBg).not.toBe(
          deriveSlots({ ...prefs, accent: '#00ffff' }).bubbleBg,
        );
      }
    }
  });
  it('accepts the swatches and strict custom hex colors', () => {
    expect(ACCENTS).toEqual([
      '#ff0000',
      '#ff8000',
      '#ffff00',
      '#00ff00',
      '#00ffff',
      '#0080ff',
      '#8000ff',
      '#ff00ff',
    ]);
    for (const color of ACCENTS) expect(isAllowedAccent(color)).toBe(true);
    expect(isAllowedAccent('#123456')).toBe(true);
        expect(isAllowedAccent('#12345g')).toBe(false);
    expect(hexToTriplet('#ff0000')).toBe('255 0 0');
    expect(() => hexToTriplet('red; color: blue')).toThrow();
  });
  it('enforces contrast for text and on-accent across all combinations', () => {
    for (const preset of Object.keys(PRESETS) as Preset[])
      for (const accent of [null, ...ACCENTS]) {
        const c = resolveTheme({ ...defaults(), preset, accent });
        expect(contrast(c.accent, c.bg)).toBeGreaterThanOrEqual(3);
        for (const background of [c.bg, c.surface, c.card, c.elevated, c.hover]) {
          expect(contrast(c.text, background)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(c.textMuted, background)).toBeGreaterThanOrEqual(3);
        }
        expect(contrast(c.textDim, c.bg)).toBeGreaterThanOrEqual(3);
        expect(contrast(deriveAccent(c.accent).onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
      }
  });
  it('normalizes old v1 preferences while keeping the extended schema closed', () => {
    const legacy = {
      v: 1,
      preset: 'ice',
      accent: null,
      density: 'comfortable',
      scale: 1,
      extras: { chatTextSize: 'md', chatDensity: 'comfortable', reduceMotion: false },
      saved: [],
      updatedAt: null,
    };
    expect(normalizePrefs(legacy)).toEqual({
      ...legacy,
      fx: { pattern: 'none', color: null, intensity: 0.5, size: 1 },
      frosted: false,
      font: 'mono',
    });
    expect(normalizePrefs({ ...legacy, frosted: true })).toBeNull();
    expect(
      normalizePrefs({ ...defaults(), fx: { ...defaults().fx, shader: 'url(x)' } }),
    ).toBeNull();
  });
  it('rejects array-coerced presets at the top level and in saved themes', () => {
    for (const prefs of [
      { ...defaults(), preset: ['crimson'] },
      {
        ...defaults(),
        saved: [{ id: 'saved', name: 'look', preset: ['crimson'], accent: null }],
      },
    ]) {
      expect(validatePrefs(prefs)).toBe(false);
      expect(normalizePrefs(prefs)).toBeNull();
    }
  });
  it('rejects malformed, injectable and over-cap preferences', () => {
    expect(validatePrefs(defaults())).toBe(true);
    for (const x of [
      null,
      {},
      { ...defaults(), accent: '#123456' },
      { ...defaults(), css: 'x' },
      { ...defaults(), extras: {} },
      { ...defaults(), updatedAt: 'yesterday' },
    ])
      expect(validatePrefs(x)).toBe(false);
    const saved = Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      name: 'test',
      preset: 'crimson' as const,
      accent: null,
    }));
    expect(validatePrefs({ ...defaults(), saved })).toBe(false);
    expect(validatePrefs({ ...defaults(), saved: saved.slice(0, 5) })).toBe(true);
  });
});
describe('CSP-safe prepaint', () => {
  const script = readFileSync(new URL('../public/theme-prepaint.js', import.meta.url), 'utf8');
  function run(enabled: boolean, path: string, cache: unknown) {
    const vars: Record<string, string> = {},
      dataset: Record<string, string> = {};
    runInNewContext(script, {
      TextEncoder,
      document: {
        currentScript: { dataset: { enabled: String(enabled) } },
        documentElement: {
          dataset,
          style: {
            setProperty: (k: string, v: string) => {
              vars[k] = v;
            },
          },
        },
      },
      location: { pathname: path, hash: '' },
      localStorage: { getItem: () => JSON.stringify(cache) },
      window: { addEventListener: () => {} },
    });
    return { vars, dataset };
  }
  it('is a no-op with flag off, corrupt cache, or public profile', () => {
    const cache = { v: 1, userId: '1', prefs: { ...defaults(), preset: 'ice' } };
    expect(run(false, '/dashboard', cache).vars).toEqual({});
    expect(run(true, '/someone', cache).vars).toEqual({});
    expect(
      run(true, '/dashboard', { v: 1, userId: '1', prefs: { ...defaults(), accent: 'red;' } }).vars,
    ).toEqual({});
  });
  it('regenerates safe values instead of trusting cached CSS', () => {
    const result = run(true, '/dashboard', {
      v: 1,
      userId: '1',
      prefs: { ...defaults(), preset: 'ice' },
      vars: { '--evil': 'url(x)' },
    });
    expect(result.vars['--m-accent-rgb']).toBe('0 255 255');
    expect(result.vars['--evil']).toBeUndefined();
  });
});

describe('theme token defaults when the client theme is OFF', () => {
  it('defines every referenced --m-*-rgb token at plain :root', () => {
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const css = readFileSync(new URL('../src/css/theme-tokens.scss', import.meta.url), 'utf8');
    // Everything before the first gated selector is the unconditional cascade.
    const global = css.split('data-client-theme')[0];
    const defined = new Set([...global.matchAll(/(--m-[\w-]+-rgb)\s*:/g)].map((m) => m[1]));
    const referenced = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(scss|css|vue)$/.test(entry))
          for (const m of readFileSync(full, 'utf8').matchAll(/var\((--m-[\w-]+-rgb)/g))
            referenced.add(m[1]);
      }
    };
    walk(fileURLToPath(new URL('../src', import.meta.url)));
    // Derived accent slots are only referenced inside [data-client-theme='on'] rules and are
    // always written by applyTheme(); their contrast matrix is covered by dedicated tests.
    const derived = new Set([
      '--m-inputBg-rgb',
      '--m-inputText-rgb',
      '--m-bubbleBg-rgb',
      '--m-bubbleText-rgb',
      '--m-sendBg-rgb',
      '--m-sendText-rgb',
    ]);
    const missing = [...referenced]
      .filter((token) => !defined.has(token) && !derived.has(token))
      .sort();
    expect(missing).toEqual([]);
  });
});
