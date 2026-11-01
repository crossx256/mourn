import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileString } from 'sass';
import { describe, expect, it } from 'vitest';

/**
 * L17: a `var(--token)` whose custom property is declared nowhere in the app
 * paint means the declaration is invalid at computed-value time, so the
 * *consumer's* value applies — the exact opposite of the styling everyone
 * believes they wrote. Keep the whole app honest about the vars it reads.
 *
 * A var is considered declared when it is set in a stylesheet (`--x:`), in an
 * inline `style` / `:style` / `setProperty` binding, or by the theme runtime
 * (`--m-*`, `--vault-*`, `--suite-*` and the vendor `--quasar-*`, `--q-*`).
 *
 * A declaration whose *whole* value is a missing var (including inside a
 * fallback, where CSS re-parses the substituted value and discards the
 * fallback) is a real defect, not cosmetic: the property reverts to
 * `unset`/inherit in every state that reads it.
 */
const RUNTIME_PREFIXES = ['--m-', '--vault-', '--dash-', '--suite-', '--quasar-', '--q-'];

// fileURLToPath, not URL.pathname: on Windows the latter yields '/D:/...'
// which readdir then fails to open.
const root = fileURLToPath(new URL('..', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/**
 * SCSS is tested after compilation (the vendored sass), not as source: source
 * legitimately reads `var(--m-x)` where the declaration is `--m-x: #{$x}`, and
 * only the compiled text says whether a token really resolves.
 */
function compile(file: string): string {
  return compileString(readFileSync(file, 'utf8'), {
    loadPaths: [join(root, 'src/css'), root],
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
  }).css;
}

function stylesheets(): Array<{ rel: string; source: string }> {
  const cssFiles = [...walk(join(root, 'src/css')), ...walk(join(root, 'public'))].filter(
    (path) => path.endsWith('.scss') || path.endsWith('.css'),
  );
  const sheets = cssFiles.map((path) => ({
    rel: relative(root, path).split(sep).join('/'),
    source: path.endsWith('.scss') ? compile(path) : readFileSync(path, 'utf8'),
  }));
  for (const path of walk(join(root, 'src'))) {
    if (!path.endsWith('.vue')) continue;
    const source = readFileSync(path, 'utf8');
    const all = [...source.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/g)];
    const compiled = all
      .map(([, attrs, body]) =>
        /lang=["']scss/.test(attrs ?? '')
          ? compileString(body ?? '', {
              loadPaths: [join(root, 'src/css'), root],
              silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api'],
            }).css
          : body ?? '',
      )
      .join('\n');
    if (all.length) sheets.push({ rel: relative(root, path).split(sep).join('/'), source: compiled });
  }
  return sheets;
}

/** Custom properties the app element itself paints at runtime. */
function scriptDeclared(): Set<string> {
  const names = new Set<string>();
  for (const path of walk(join(root, 'src'))) {
    if (!path.endsWith('.ts') && !path.endsWith('.vue')) continue;
    const source = readFileSync(path, 'utf8');
    // setProperty('--x', …) and object-literal style bindings { '--x': … }
    for (const match of source.matchAll(/setProperty\(\s*['"](--[A-Za-z0-9_-]+)['"]/g)) names.add(match[1]!);
    for (const match of source.matchAll(/['"](--[A-Za-z0-9_-]+)['"]\s*:/g)) names.add(match[1]!);
    // `--x: ${value}` template-literal style strings.
    for (const match of source.matchAll(/(?:^|[;{\s"'`])(--[A-Za-z0-9_-]+)\s*:/g)) names.add(match[1]!);
  }
  return names;
}

const SHEETS = stylesheets();
const KNOWN = new Set<string>([
  ...scriptDeclared(),
  ...[...SHEETS].flatMap(({ source }) =>
    [...source.matchAll(/(^|[\s;{])(--[A-Za-z0-9_-]+)\s*:/g)].map((match) => match[2]!),
  ),
]);

const isRuntime = (name: string) =>
  RUNTIME_PREFIXES.some((prefix) => name === prefix.slice(0, -1) || name.startsWith(prefix));

/** Vars read through `var(--x)` with or without a fallback. */
function referenced(sheets: Array<{ rel: string; source: string }>): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  for (const { rel, source } of sheets) {
    for (const match of source.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
      const name = match[1]!;
      const owners = refs.get(name) ?? [];
      if (!owners.includes(rel)) owners.push(rel);
      refs.set(name, owners);
    }
  }
  return refs;
}

describe('CSS custom properties', () => {
  it('never reads a var() that nothing declares', () => {
    const missing = [...referenced(SHEETS)]
      .filter(([name]) => !KNOWN.has(name) && !isRuntime(name))
      .map(([name, owners]) => `${name} ← ${owners.join(', ')}`);
    expect(missing).toEqual([]);
  });

  it('compiles the audited stylesheets (the checks above see compiled CSS)', () => {
    // Anti-vacuity: if compilation silently stopped covering the app, the two
    // assertions above would pass by finding nothing.
    const rels = SHEETS.map((sheet) => sheet.rel);
    for (const expected of ['src/css/theme-tokens.scss', 'src/pages/MessagingPage.vue']) {
      expect(rels).toContain(expected);
    }
    const messaging = SHEETS.find((sheet) => sheet.rel === 'src/pages/MessagingPage.vue')!;
    expect(messaging.source).toContain('--vault-picker-border');
  });

  it('declares every token a stylesheet reads', () => {
    // The audit found --crimson, --crimson-dark, --gray-400 and --primary-rgb
    // read but never set. Lock those out so a copy-paste of the old markup
    // cannot reintroduce a var() that silently resolves to nothing.
    for (const name of ['--crimson', '--crimson-dark', '--gray-400', '--primary-rgb']) {
      expect(KNOWN.has(name), `${name} must not be read again`).toBe(false);
      expect([...referenced(SHEETS).keys()], `${name} must not be referenced again`).not.toContain(name);
    }
  });
});
