import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * XD-01: VITE_CLIENT_THEMES is resolved twice — once in quasar.config.ts (the
 * `clientThemes` html variable feeding theme-prepaint.js, plus the isolated-build
 * Vite define) and once in src/stores/theme.ts (THEME_ENABLED). The policy is
 * OPT-OUT: only the literal 'false' disables customization. These tests execute
 * the real resolver in a clean process for every documented input and assert all
 * three consumers agree, so drifting one site cannot pass unnoticed.
 */
const root = new URL('../', import.meta.url);
const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript') as typeof import('typescript');

type Resolved = {
  htmlVariable: string;
  isolatedDefine: string | undefined;
  storeEnabled: boolean;
  isolationAwareEnabled: boolean;
  configResolver: string;
};

function resolve(flag: string | undefined, isolated: boolean): Resolved {
  const dir = mkdtempSync(join(tmpdir(), 'mourn-theme-flag-'));
  try {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./helpers/themeFlagResolve.cjs', import.meta.url)), flag ?? '__unset__', isolated ? '1' : '0'],
      {
        encoding: 'utf8',
        cwd: fileURLToPath(root),
        env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: dir },
        timeout: 60_000,
      },
    );
    if (result.status !== 0) throw new Error(`resolver failed: ${result.stderr || result.stdout}`);
    return JSON.parse(result.stdout.trim().split('\n').pop()!) as Resolved;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('VITE_CLIENT_THEMES is an opt-out resolved identically at every consumer', () => {
  it.each<[string, string | undefined, boolean]>([
    ['unset', undefined, true],
    ['the explicit opt-in value', 'true', true],
    ['an arbitrary value', 'maybe', true],
    ['the literal opt-out', 'false', false],
  ])('%s resolves to enabled=%s', (_label, flag, enabled) => {
    const resolved = resolve(flag, false);
    expect(resolved.storeEnabled).toBe(enabled);
    expect(resolved.isolationAwareEnabled).toBe(enabled);
    expect(resolved.htmlVariable).toBe(String(enabled));
    expect(resolved.configResolver).toBe(String(enabled));
  });

  it('keeps the isolated-build define in agreement for every input', () => {
    for (const flag of [undefined, 'true', 'false', '0', 'TRUE']) {
      const resolved = resolve(flag, true);
      expect(resolved.isolatedDefine, `flag=${String(flag)}`).toBe(resolved.htmlVariable);
      expect(resolved.storeEnabled, `flag=${String(flag)}`).toBe(resolved.htmlVariable === 'true');
    }
  });

  it('renders the prepaint flag gate with the resolved html variable', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('data-enabled="<%= clientThemes %>"');
  });

  it('is not re-derived from a stale source regex: the store reads the value it was given', () => {
    // The expression itself (not a copy of it) must be what the store executes.
    const store = readFileSync(new URL('../src/stores/theme.ts', import.meta.url), 'utf8');
    expect(store).toMatch(/export const THEME_ENABLED = import\.meta\.env\.VITE_CLIENT_THEMES !== 'false'/);
  });
});
