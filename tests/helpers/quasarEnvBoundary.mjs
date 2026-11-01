// Run in a clean Node process: Quasar snapshots process.env on first import.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(join(root, 'package.json'));
const isolated = process.argv[2] === 'isolated';
const theme = process.argv[3];
const folder = mkdtempSync(join(tmpdir(), 'mourn-env-boundary-'));
try {
  Object.assign(process.env, {
    MOURN_ISOLATED_BUILD: isolated ? '1' : '0',
    VITE_DISCORD_RPC_CLIENT_ID: '123456789012345678',
    VITE_CLIENT_THEMES: theme,
    VITE_API_BASE: 'https://synthetic-api.invalid/quoted-"value"',
    VITE_VAULT_WS_BASE: 'wss://synthetic-vault.invalid',
    VITE_CAP_API_ENDPOINT: 'https://synthetic-cap.invalid',
    VITE_KLIPY_API_KEY: 'synthetic-public-klipy',
    VITE_UNREVIEWED_SECRET: 'synthetic-prefixed-process-sentinel',
    DATABASE_URL: 'synthetic-unprefixed-process-sentinel',
  });
  writeFileSync(join(folder, '.env'), [
    'VITE_WS_BASE=wss://synthetic-file.invalid',
    'VITE_UNREVIEWED_FILE=synthetic-prefixed-file-sentinel',
    'UNREVIEWED_FILE=synthetic-unprefixed-file-sentinel',
  ].join('\n'));

  // Execute the actual factory, resolving #q-app to Quasar's real wrapper.
  const ts = require('typescript');
  const wrappers = await import(pathToFileURL(join(root, 'node_modules/@quasar/app-vite/exports/wrappers.js')).href);
  const tres = await import(pathToFileURL(require.resolve('@tresjs/core')).href);
  const configPath = join(root, 'quasar.config.ts');
  const source = readFileSync(configPath, 'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(configPath).href));
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const exports = {};
  // build/*.ts modules are imported relatively by the config; compile them the
  // same way so the harness executes the real flag resolver, not a copy.
  const buildModules = {};
  const loadBuildModule = (id) => {
    if (buildModules[id]) return buildModules[id];
    const file = join(root, `${id}.ts`);
    const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const mod = { exports: {} };
    vm.runInThisContext(`(function(module, exports, process) { ${compiled}\n})`, { filename: file })(mod, mod.exports, process);
    return (buildModules[id] = mod.exports);
  };
  const evaluate = vm.runInThisContext(`(function(exports, require, process) { ${outputText}\n})`, { filename: configPath });
  evaluate(exports, (id) => id === '#q-app' ? wrappers : id === '@tresjs/core' ? tres : id.startsWith('./build/') ? loadBuildModule(id) : require(id), process);
  const cfg = exports.default({ prod: true, dev: false, mode: { ssr: true } });
  const { getAppEnv } = await import(pathToFileURL(join(root, 'node_modules/@quasar/app-vite/lib/utils/env.js')).href);
  // Substitute only the env directory with this synthetic fixture, never root .env.
  const env = getAppEnv({
    ctx: { appPaths: { appDir: folder }, mode: { ssr: true } },
    envCfg: { ...cfg.build.env, folder },
    useSnapshot: false,
  });
  const entry = join(folder, 'consumer.mjs');
  writeFileSync(entry, `export default {
    id: import.meta.env.VITE_DISCORD_RPC_CLIENT_ID,
    theme: import.meta.env.VITE_CLIENT_THEMES,
    themeEnabled: import.meta.env.VITE_CLIENT_THEMES === 'true',
    api: import.meta.env.VITE_API_BASE,
    ws: import.meta.env.VITE_WS_BASE,
    vaultWs: import.meta.env.VITE_VAULT_WS_BASE,
    cap: import.meta.env.VITE_CAP_API_ENDPOINT,
    klipy: import.meta.env.VITE_KLIPY_API_KEY,
    prefixed: import.meta.env.VITE_UNREVIEWED_SECRET,
    unprefixed: import.meta.env.DATABASE_URL,
    filePrefixed: import.meta.env.VITE_UNREVIEWED_FILE,
    fileUnprefixed: import.meta.env.UNREVIEWED_FILE,
    all: import.meta.env
  };`);
  const { build } = await import(pathToFileURL(require.resolve('vite')).href);
  const results = {};
  for (const [type, definitions] of [['client', env.clientEnvDefineList], ['ssr', env.backendEnvDefineList]]) {
    // Same envDir and definition precedence as Quasar's createViteConfig.
    const viteConf = { envDir: false, define: { ...definitions, ...cfg.build.define } };
    cfg.build.extendViteConf(viteConf);
    let resolvedEnv;
    const output = await build({
      ...viteConf,
      root: folder, configFile: false, publicDir: false, logLevel: 'silent',
      cacheDir: join(folder, 'cache'),
      plugins: [{ name: 'capture-resolved-env', configResolved(config) { resolvedEnv = config.env; } }],
      build: {
        ...viteConf.build, write: false, minify: false,
        ...(type === 'ssr' ? { ssr: entry } : { lib: { entry, formats: ['es'] } }),
      },
    });
    const chunk = (Array.isArray(output) ? output : [output]).flatMap((item) => item.output)
      .find((item) => item.type === 'chunk' && item.isEntry);
    if (!chunk) throw new Error(`Missing ${type} entry chunk`);
    const consumer = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`);
    results[type] = { definitions, resolvedEnv, consumer: consumer.default, code: chunk.code };
  }
  console.log(JSON.stringify(results));
} finally {
  rmSync(folder, { recursive: true, force: true });
}
