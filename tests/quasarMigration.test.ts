import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import renderMiddleware from '../src-ssr/middlewares/render';

it('keeps locked Tauri JS packages on the Rust major/minor release lines', () => {
  const cargo = readFileSync(new URL('../src-tauri/Cargo.lock', import.meta.url), 'utf8');
  const packages = cargo.split('[[package]]').map((entry) => ({
    name: entry.match(/^name = "([^"]+)"/m)?.[1],
    version: entry.match(/^version = "([^"]+)"/m)?.[1],
  }));
  for (const [js, rust] of [
    ['api', 'tauri'], ['plugin-process', 'tauri-plugin-process'],
    ['plugin-updater', 'tauri-plugin-updater'], ['plugin-opener', 'tauri-plugin-opener'],
    ['plugin-fs', 'tauri-plugin-fs'], ['plugin-dialog', 'tauri-plugin-dialog'],
  ]) {
    const installed = JSON.parse(readFileSync(new URL(`../node_modules/@tauri-apps/${js}/package.json`, import.meta.url), 'utf8'));
    const native = packages.find((entry) => entry.name === rust);
    expect(installed.version.split('.').slice(0, 2).join('.'), `@tauri-apps/${js} vs ${rust}`).toBe(native?.version?.split('.').slice(0, 2).join('.'));
  }
});

it('does not retain a newer nested API inside native plugins', () => {
  const rootApi = JSON.parse(readFileSync(new URL('../node_modules/@tauri-apps/api/package.json', import.meta.url), 'utf8'));
  for (const plugin of ['dialog', 'fs', 'opener', 'process', 'updater']) {
    const require = createRequire(new URL(`../node_modules/@tauri-apps/plugin-${plugin}/package.json`, import.meta.url));
    const api = JSON.parse(readFileSync(join(dirname(require.resolve('@tauri-apps/api/core')), 'package.json'), 'utf8'));
    expect(api.version, `API resolved by plugin-${plugin}`).toBe(rootApi.version);
  }
});

afterEach(() => vi.unstubAllEnvs());

async function config(target = 'web', capacitor = false) {
  vi.stubEnv('MOURN_TARGET', target);
  vi.stubEnv('MOURN_ISOLATED_BUILD', '1');
  // Target selection is evaluated when the config module is loaded.
  vi.resetModules();
  const { default: factory } = await import('../quasar.config');
  return factory({ prod: true, dev: false, mode: { capacitor } } as never);
}

describe('raw environment through Quasar and Vite consumers', () => {
  it.each(['isolated', 'normal'])('preserves literal public identifiers in %s client and SSR builds', (mode) => {
    const result = JSON.parse(execFileSync(process.execPath, [
      fileURLToPath(new URL('./helpers/quasarEnvBoundary.mjs', import.meta.url)), mode, 'true',
    ], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
    }));
    for (const type of ['client', 'ssr']) {
      expect(result[type].consumer.id, type).toBe('123456789012345678');
      expect(result[type].consumer.all.VITE_DISCORD_RPC_CLIENT_ID, type).toBe('123456789012345678');
      expect(result[type].consumer.theme, type).toBe('true');
      expect(result[type].consumer.themeEnabled, type).toBe(true);
      expect(result[type].consumer.api, type).toBe('https://synthetic-api.invalid/quoted-"value"');
      expect(result[type].consumer.ws, type).toBe('wss://synthetic-file.invalid');
    }
  });
  it.each([
    ['isolated', 'true'], ['isolated', 'false'], ['normal', 'true'], ['normal', 'false'],
  ])('enforces the exact public boundary in %s builds with theme=%s', (mode, theme) => {
    const result = JSON.parse(execFileSync(process.execPath, [
      fileURLToPath(new URL('./helpers/quasarEnvBoundary.mjs', import.meta.url)), mode, theme,
    ], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR },
    }));
    for (const type of ['client', 'ssr']) {
      const { consumer, definitions, resolvedEnv, code } = result[type];
      expect.soft(consumer.theme, type).toBe(theme);
      expect.soft(consumer.themeEnabled, type).toBe(theme === 'true');
      expect.soft(consumer.all.VITE_CLIENT_THEMES, type).toBe(theme);
      expect.soft(consumer.id, type).toBe('123456789012345678');
      expect.soft(consumer.all.SSR, type).toBe(type === 'ssr');
      for (const [field, key, value] of [
        ['api', 'VITE_API_BASE', 'https://synthetic-api.invalid/quoted-"value"'],
        ['ws', 'VITE_WS_BASE', 'wss://synthetic-file.invalid'],
        ['vaultWs', 'VITE_VAULT_WS_BASE', 'wss://synthetic-vault.invalid'],
        ['cap', 'VITE_CAP_API_ENDPOINT', 'https://synthetic-cap.invalid'],
        ['klipy', 'VITE_KLIPY_API_KEY', 'synthetic-public-klipy'],
      ]) {
        expect.soft(consumer[field], `${type}: direct ${key}`).toBe(value);
        expect.soft(consumer.all[key], `${type}: whole env ${key}`).toBe(value);
      }
      expect.soft(Object.keys(consumer.all).filter((key) => key.startsWith('VITE_')).sort(), type).toEqual([
        'VITE_API_BASE', 'VITE_CAP_API_ENDPOINT', 'VITE_CLIENT_THEMES', 'VITE_DISCORD_RPC_CLIENT_ID',
        'VITE_KLIPY_API_KEY', 'VITE_VAULT_WS_BASE', 'VITE_WS_BASE',
      ]);
      for (const [field, key] of [
        ['prefixed', 'VITE_UNREVIEWED_SECRET'], ['unprefixed', 'DATABASE_URL'],
        ['filePrefixed', 'VITE_UNREVIEWED_FILE'], ['fileUnprefixed', 'UNREVIEWED_FILE'],
      ]) {
        expect.soft(consumer[field], `${type}: direct ${key}`).toBeUndefined();
        expect.soft(consumer.all, `${type}: whole env ${key}`).not.toHaveProperty(key);
        expect.soft(Object.hasOwn(definitions, `import.meta.env.${key}`), `${type}: Quasar ${key}`).toBe(false);
        expect.soft(resolvedEnv, `${type}: resolved ${key}`).not.toHaveProperty(key);
      }
      expect.soft(code, `${type}: emitted code`).not.toContain('sentinel');
    }
  });
});

describe('Quasar v3 configuration', () => {
  it('filters encoded Quasar env keys for both client and backend, retaining string flags', async () => {
    const cfg = await config();
    const env = {
      'import.meta.env.VITE_API_BASE': JSON.stringify('https://api.example'),
      'import.meta.env.VITE_CLIENT_THEMES': 'true',
      'import.meta.env.VITE_UNREVIEWED_SECRET': JSON.stringify('must-not-ship'),
      'import.meta.env.DATABASE_URL': JSON.stringify('must-not-ship'),
    };
    for (const type of ['client', 'backend'] as const) {
      expect(cfg.build!.env!.filter!(env, type)).toEqual({
        'import.meta.env.VITE_API_BASE': JSON.stringify('https://api.example'),
        'import.meta.env.VITE_CLIENT_THEMES': JSON.stringify('true'),
      });
    }
    expect(cfg.build!.env!.folder).toBe(fileURLToPath(new URL('../scripts/isolated-env', import.meta.url)));
    expect(cfg.build!.vueOptionsAPI).toBe(true);
  });

  it.each([['web', false, 'history'], ['desktop', false, 'hash'], ['web', true, 'hash']])(
    'retains routing and native graph boundaries for %s capacitor=%s', async (target, capacitor, mode) => {
      const cfg = await config(target as string, capacitor as boolean);
      expect(cfg.build!.vueRouterMode).toBe(mode);
      const vite: any = {};
      cfg.build!.extendViteConf!(vite, {} as never);
      expect(vite.envDir).toBe(false);
      expect(vite.resolve.alias.some((a: any) => String(a.find).includes('stores\\/vault'))).toBe(mode === 'history');
      expect(vite.resolve.alias.some((a: any) => a.find === 'assets')).toBe(true);
      expect(vite.optimizeDeps.exclude).toContain('@hpke/core');
      expect(vite.optimizeDeps.include).toContain('ts-mls');
    },
  );
});

async function renderError(error: unknown) {
  let handler: any;
  renderMiddleware({ app: { use: (fn: any) => { handler = fn; } }, render: () => Promise.reject(error) } as never);
  const response: any = { headersSent: false, setHeader: vi.fn(), redirect: vi.fn(), status: vi.fn(), type: vi.fn(), send: vi.fn() };
  response.status.mockReturnValue(response);
  response.type.mockReturnValue(response);
  handler({ method: 'GET', path: '/public-profile' }, response, vi.fn());
  await new Promise((resolve) => setImmediate(resolve));
  return response;
}

describe('Quasar v3 SSR render errors', () => {
  it('honors the new redirect URL and HTTP status contract', async () => {
    const response = await renderError({ redirectUrl: '/login', redirectHttpStatusCode: 307 });
    expect(response.redirect).toHaveBeenCalledWith(307, '/login');
    expect(response.status).not.toHaveBeenCalled();
  });
  it('recognizes routeNotFound without leaking error details', async () => {
    const response = await renderError({ routeNotFound: true });
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.send).toHaveBeenCalledWith('Page not found');
  });
  it('still returns a generic no-store response for unexpected errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await renderError(new Error('private stack'));
      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(response.send).toHaveBeenCalledWith('Unable to load this page. Please try again later.');
    } finally { log.mockRestore(); }
  });
});

