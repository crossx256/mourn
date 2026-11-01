import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
vi.mock('quasar', () => ({ setCssVar: vi.fn() }));
import {
  applyTheme,
  clearTheme,
  deriveAccent,
  deriveSlots,
  hexToTriplet,
  resolveTheme,
} from '../src/theme/apply';
import { defaults, normalizePrefs, validatePrefs, type ThemePrefs } from '../src/theme/preferences';
import { PRESETS, type Preset } from '../src/theme/presets';
import { ACCENTS } from '../src/theme/ramp';
import { DEFAULT_THEME } from '../src/theme/tokens';

const script = readFileSync(new URL('../public/theme-prepaint.js', import.meta.url), 'utf8');
const cache = (prefs: unknown) => JSON.stringify({ v: 1, userId: 'user', prefs });
function run(
  raw: string | null,
  options: {
    enabled?: boolean;
    pathname?: string;
    hash?: string;
    trayEnabled?: boolean;
    storageThrows?: boolean;
  } = {},
) {
  const vars: Record<string, string> = {};
  const dataset: Record<string, string> = {};
  const classes = new Set<string>();
  const body = {
    classList: {
      toggle: (key: string, enabled: boolean) => (enabled ? classes.add(key) : classes.delete(key)),
      remove: (key: string) => classes.delete(key),
    },
  };
  let storageListener: (event: { key: string | null }) => void = () => {};
  const storage: Record<string, string | null> = {
    mourn_theme_last: raw,
    mourn_theme_enabled: String(options.trayEnabled ?? false),
  };
  runInNewContext(
    script,
    {
      TextEncoder,
      document: {
        currentScript: { dataset: { enabled: String(options.enabled ?? true) } },
        body,
        documentElement: {
          dataset,
          style: {
            setProperty: (key: string, value: string) => {
              vars[key] = value;
            },
            removeProperty: (key: string) => {
              delete vars[key];
            },
          },
        },
      },
      location: { pathname: options.pathname ?? '/dashboard', hash: options.hash ?? '' },
      localStorage: {
        getItem: (key: string) => {
          if (options.storageThrows) throw new Error('Storage unavailable');
          return storage[key] ?? null;
        },
      },
      window: {
        addEventListener: (name: string, listener: typeof storageListener) => {
          expect(name).toBe('storage');
          storageListener = listener;
        },
      },
    },
    { timeout: 1000 },
  );
  return {
    vars,
    dataset,
    classes,
    storage,
    dispatch: (key: string | null) => storageListener({ key }),
  };
}
function expectedVars(prefs: ThemePrefs) {
  const colors = resolveTheme(prefs);
  const derived = deriveAccent(colors.accent);
  return {
    ...Object.fromEntries(
      Object.entries(colors).map(([key, value]) => [`--m-${key}-rgb`, hexToTriplet(value)]),
    ),
    '--m-accent-hover': derived.hover,
    '--m-accent-active': derived.active,
    '--m-focus-ring': derived.focusRing,
    ...Object.fromEntries(
      Object.entries(deriveSlots(prefs)).map(([key, value]) => [
        `--m-${key}-rgb`,
        hexToTriplet(value),
      ]),
    ),
    ...Object.fromEntries(
      ['space-unit', 'row-h', 'font-step'].map((key, i) => [
        `--m-${key}`,
        `${{ compact: [4, 32, 12], comfortable: [8, 40, 13], spacious: [12, 48, 14] }[prefs.density][i]}px`,
      ]),
    ),
  };
}

describe('prepaint runtime parity', () => {
  for (const preset of Object.keys(PRESETS) as Preset[]) {
    for (const accent of [
      null,
      ...ACCENTS,
      '#33ccaa',
      '#010101',
      '#123456',
      '#595959',
      '#5a5a5a',
    ]) {
      it(`${preset} / ${accent ?? 'preset accent'} matches every resolved token and interaction`, () => {
        const prefs = { ...defaults(), preset, accent };
        const result = run(cache(prefs));
        if (!validatePrefs(prefs)) {
          expect(result.vars).toEqual({});
          expect(result.dataset).toEqual({});
          return;
        }
        expect(result.vars).toEqual(expectedVars(prefs));
        expect(result.vars['--m-onAccent-rgb']).toBe(hexToTriplet(resolveTheme(prefs).onAccent));
        expect(result.dataset).toEqual({
          clientTheme: 'on',
          theme: preset,
          density: prefs.density,
          chatSize: prefs.extras.chatTextSize,
          chatDensity: prefs.extras.chatDensity,
          font: 'mono',
          ...(accent ? { themeAccent: accent } : {}),
        });
      });
    }
  }

  it('matches actual runtime styles and datasets across density, font and frosted options', () => {
    for (const preset of Object.keys(PRESETS) as Preset[]) {
      for (const color of ['#33ccaa', '#010101', '#123456']) {
        for (const density of ['compact', 'comfortable', 'spacious'] as const) {
          for (const font of ['mono', 'opendyslexic'] as const) {
            const prefs = {
              ...defaults(),
              preset,
              accent: '#33ccaa',
              fx: { ...defaults().fx, pattern: 'rain' as const, color },
              saved: [
                {
                  id: 'custom',
                  name: 'Custom',
                  preset,
                  accent: '#33ccaa',
                  fx: { ...defaults().fx, color },
                },
              ],
              density,
              font,
              frosted: true,
              extras: {
                chatTextSize: 'lg' as const,
                chatDensity: 'compact' as const,
                reduceMotion: false,
              },
            };
            expect(validatePrefs(prefs)).toBe(true);
            const prepaint = run(cache(prefs));
            const vars = new Map<string, string>();
            const dataset: Record<string, string> = {};
            const classes = new Set<string>();
            vi.stubGlobal('document', {
              body: {
                classList: {
                  toggle: (key: string, on: boolean) =>
                    on ? classes.add(key) : classes.delete(key),
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
              applyTheme(prefs);
              expect(prepaint.vars).toEqual(Object.fromEntries(vars));
              expect(prepaint.dataset).toEqual(dataset);
              expect(prepaint.classes).toEqual(classes);
            } finally {
              clearTheme();
              vi.unstubAllGlobals();
            }
          }
        }
      }
    }
  });

  it('makes the leaderboard brand token follow the accent in prepaint and runtime alike', () => {
    // VAL-01 intent: the leaderboard's --lb-red must track the active accent, so
    // --m-lbRed-rgb is an accent follower. Prepaint paints before the app boots,
    // so it has to carry the same rule or the page flashes the old crimson
    // until the store hydrates. The un-themed default stays in theme-tokens.scss.
    const cases: ThemePrefs[] = [
      { ...defaults(), preset: 'crimson' as const },
      { ...defaults(), preset: 'ice' as const },
      { ...defaults(), preset: 'violet' as const, accent: '#33ccaa' },
    ];
    for (const prefs of cases) {
      expect(validatePrefs(prefs)).toBe(true);
      const accent = resolveTheme(prefs).accent;
      expect(resolveTheme(prefs).lbRed).toBe(accent);
      expect(resolveTheme(prefs).lbMuted).toBe(DEFAULT_THEME.lbMuted);
      const prepaint = run(cache(prefs));
      expect(prepaint.vars['--m-lbRed-rgb']).toBe(hexToTriplet(accent));
      expect(prepaint.vars['--m-lbMuted-rgb']).toBe(hexToTriplet(DEFAULT_THEME.lbMuted));
      expect(prepaint.vars['--m-lbRed-rgb']).toBe(expectedVars(prefs)['--m-lbRed-rgb']);
    }
  });

  it('accepts custom colors in legacy preferences and saved snapshots', () => {
    const { fx: _fx, frosted: _frosted, font: _font, ...legacy } = defaults();
    const prefs = {
      ...legacy,
      accent: '#33ccaa',
      saved: [{ id: 'custom', name: 'Custom', preset: 'violet' as const, accent: '#33ccaa' }],
    };
    const normalized = normalizePrefs(prefs);
    expect(normalized).not.toBeNull();
    expect(run(cache(prefs)).vars).toEqual(expectedVars(normalized!));
  });

  it('rejects malformed or injectable colors in current and saved preferences like runtime', () => {
    const malformed: unknown[] = [
      '#12345g',
      '#33CCAA',
      '#abc',
      '#33ccaa00',
      ' #33ccaa',
      '#33ccaa\n',
      '#33ccaa;--evil:url(https://example.invalid)',
      'var(--evil)',
      'url(javascript:alert(1))',
      { toString: '#33ccaa' },
      ['#33ccaa'],
      123456,
    ];
    for (const color of malformed) {
      for (const patch of [{ accent: color }, { fx: { ...defaults().fx, color } }]) {
        const saved = { id: 'custom', name: 'Custom', preset: 'ice', accent: null, ...patch };
        for (const prefs of [
          { ...defaults(), ...patch },
          { ...defaults(), saved: [saved] },
        ]) {
          expect(validatePrefs(prefs)).toBe(false);
          const result = run(cache(prefs));
          expect(result.vars).toEqual({});
          expect(result.dataset).toEqual({});
        }
      }
    }
  });

  it('validates saved accent contrast against the saved preset rather than the active preset', () => {
    for (const preset of Object.keys(PRESETS) as Preset[]) {
      for (const accent of ['#010101', '#123456', '#595959', '#5a5a5a', '#33ccaa']) {
        const prefs = { ...defaults(), saved: [{ id: 'custom', name: 'Custom', preset, accent }] };
        const result = run(cache(prefs));
        expect(result.vars).toEqual(validatePrefs(prefs) ? expectedVars(prefs) : {});
        expect(result.dataset.clientTheme).toBe(validatePrefs(prefs) ? 'on' : undefined);
      }
    }
  });

  it('accepts valid extended saved snapshots just like runtime validation', () => {
    const prefs = {
      ...defaults(),
      saved: [
        {
          id: 'rain',
          name: 'rain',
          preset: 'ice' as const,
          accent: null,
          density: 'compact' as const,
          fx: { ...defaults().fx, pattern: 'rain' as const },
          frosted: true,
          font: 'opendyslexic' as const,
        },
      ],
    };
    expect(run(cache(prefs)).vars).toEqual(expectedVars(prefs));
    for (const patch of [
      { fx: null },
      { fx: { ...defaults().fx, size: 3 } },
      { frosted: 'yes' },
      { font: 'serif' },
    ]) {
      expect(run(cache({ ...prefs, saved: [{ ...prefs.saved[0], ...patch }] })).vars).toEqual({});
    }
  });

  it('normalizes exact legacy v1 preferences but rejects partial extensions', () => {
    const { fx: _fx, frosted: _frosted, font: _font, ...legacy } = defaults();
    const legacyResult = run(cache(legacy));
    expect(legacyResult.vars).toEqual(expectedVars(defaults()));
    expect(legacyResult.dataset.font).toBe('mono');
    const partialResult = run(cache({ ...legacy, frosted: true }));
    expect(partialResult.vars).toEqual({});
    expect(partialResult.dataset).toEqual({});
  });

  it('applies validated non-effect preferences without prepainting effects', () => {
    const result = run(
      cache({
        ...defaults(),
        frosted: true,
        font: 'opendyslexic',
        fx: { pattern: 'dots', color: '#00ffff', intensity: 1, size: 2 },
      }),
    );
    expect(result.dataset.frosted).toBe('on');
    expect(result.classes.has('theme-frosted')).toBe(true);
    expect(result.dataset.font).toBe('opendyslexic');
    expect(result.dataset).not.toHaveProperty('fx');
    expect(result.dataset).not.toHaveProperty('pattern');
  });

  it('never prepaints frosted surfaces on auth routes including nested/hash routes', () => {
    for (const options of [
      { pathname: '/login' },
      { pathname: '/register/invite/abc' },
      { pathname: '/', hash: '#/reset-password?token=x' },
    ]) {
      const result = run(cache({ ...defaults(), frosted: true }), options);
      expect(result.dataset.clientTheme).toBe('on');
      expect(result.dataset.frosted).toBeUndefined();
      expect(result.classes.has('theme-frosted')).toBe(false);
    }
  });

  it('retains feature and public-profile gates including hash routes', () => {
    const raw = cache(defaults());
    for (const options of [
      { enabled: false },
      { pathname: '/someone' },
      { pathname: '/', hash: '#/someone?tab=about' },
    ]) {
      const result = run(raw, options);
      expect(result.vars).toEqual({});
      expect(result.dataset).toEqual({});
    }
    expect(run(raw, { pathname: '/', hash: '#/dashboard?tab=home' }).vars).toEqual(
      expectedVars(defaults()),
    );
  });

  it('fails closed for invalid, oversized, unavailable or injectable cache data', () => {
    for (const raw of [
      null,
      '{',
      'x'.repeat(12001),
      'null',
      '{}',
      JSON.stringify({ v: 2, userId: 'user', prefs: defaults() }),
      JSON.stringify({ v: 1, userId: 1, prefs: defaults() }),
      ...[
        { v: 2 },
        { preset: '__proto__' },
        { preset: 'constructor' },
        { accent: '#123456' },
        { accent: 'red; --evil: url(x)' },
        { density: 'invalid' },
        { scale: 2 },
        { extras: null },
        { extras: { ...defaults().extras, chatTextSize: 'xl' } },
        { extras: { ...defaults().extras, chatDensity: 'spacious' } },
        { extras: { ...defaults().extras, reduceMotion: 'true' } },
        { fx: null },
        { fx: false },
        { fx: 0 },
        { fx: { ...defaults().fx, pattern: 'unknown' } },
        { fx: { ...defaults().fx, color: '#12345g' } },
        { fx: { ...defaults().fx, intensity: -0.01 } },
        { fx: { ...defaults().fx, intensity: 1.01 } },
        { fx: { ...defaults().fx, size: 0.49 } },
        { fx: { ...defaults().fx, size: 2.01 } },
        { fx: { ...defaults().fx, extra: true } },
        { frosted: 'true' },
        { font: 'serif' },
        { saved: {} },
        { saved: [{ id: 'x', name: 'x', preset: 'crimson', accent: null, css: 'url(x)' }] },
        { saved: Array(6).fill({}) },
      ].map((patch) => cache({ ...defaults(), ...patch })),
    ]) {
      const result = run(raw);
      expect(result.vars).toEqual({});
      expect(result.dataset).toEqual({});
    }
    expect(run(cache(defaults()), { storageThrows: true }).vars).toEqual({});
  });

  it('reconstructs colors rather than trusting cached CSS', () => {
    const prefs = { ...defaults(), preset: 'violet' as const };
    const raw = JSON.stringify({
      v: 1,
      userId: 'user',
      prefs,
      vars: { '--evil': 'url(https://example.invalid)' },
    });
    expect(run(raw).vars).toEqual(expectedVars(prefs));
  });

  it('updates tray palettes, removes stale accent state and clears on disable or invalid cache', () => {
    const prefs = { ...defaults(), preset: 'ice' as const, accent: '#0080ff' };
    const result = run(cache(prefs), {
      enabled: false,
      pathname: '/tray-menu.html',
      trayEnabled: true,
    });
    expect(result.vars).toEqual(expectedVars(prefs));
    expect(result.dataset.themeAccent).toBe(prefs.accent);
    result.storage.mourn_theme_last = cache(defaults());
    result.dispatch('unrelated');
    expect(result.dataset.themeAccent).toBe(prefs.accent);
    result.dispatch('mourn_theme_last');
    expect(result.vars).toEqual(expectedVars(defaults()));
    expect(result.dataset.themeAccent).toBeUndefined();
    result.storage.mourn_theme_last = '{';
    result.dispatch('mourn_theme_last');
    expect(result.vars).toEqual({});
    expect(result.dataset).toEqual({});
    result.storage.mourn_theme_last = cache(prefs);
    result.dispatch('mourn_theme_last');
    result.storage.mourn_theme_enabled = 'false';
    result.dispatch('mourn_theme_enabled');
    expect(result.vars).toEqual({});
    expect(result.dataset).toEqual({});
    result.storage.mourn_theme_enabled = 'true';
    result.dispatch('mourn_theme_enabled');
    expect(result.dataset.clientTheme).toBe('on');
    result.storage.mourn_theme_last = null;
    result.storage.mourn_theme_enabled = null;
    result.dispatch(null);
    expect(result.vars).toEqual({});
    expect(result.dataset).toEqual({});
    expect(result.classes.has('theme-frosted')).toBe(false);
  });
});
