// Resolves the VITE_CLIENT_THEMES policy for one input in a pristine process.
// Quasar snapshots process.env on first import and src/stores/theme.ts reads
// import.meta.env at module scope, so both must be evaluated from a clean env.
// argv: [flag ('__unset__' for absent), isolated ('1'|'0')]  -> JSON on stdout
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '../../');
const require_ = createRequire(path.join(root, 'package.json'));
const ts = require_('typescript');
const flag = process.argv[2] === '__unset__' ? null : process.argv[2];
const isolated = process.argv[3] === '1';

if (flag === null) delete process.env.VITE_CLIENT_THEMES;
else process.env.VITE_CLIENT_THEMES = flag;
process.env.MOURN_ISOLATED_BUILD = isolated ? '1' : '0';

// Evaluate a flag expression against the fixture value. Vite statically replaces
// `import.meta.env.X` with the filtered literal; an absent variable is
// `undefined`, never the string 'undefined'.
function evaluate(expression) {
  const literal = flag === null ? 'undefined' : JSON.stringify(flag);
  const substituted = expression.replace(/__FLAG__/g, literal);
  return vm.runInNewContext(`(${substituted})`, { process });
}

// src/stores/theme.ts declares the runtime gate. Its right-hand side is the
// expression a bundle actually executes, so execute that rather than a copy.
function storeFlagExpression() {
  const source = readFileSync(path.join(root, 'src/stores/theme.ts'), 'utf8');
  const declaration = source
    .split('\n')
    .find((entry) => entry.startsWith('export const THEME_ENABLED'));
  if (!declaration) throw new Error('THEME_ENABLED declaration not found in src/stores/theme.ts');
  return declaration
    .replace(/^export const THEME_ENABLED\s*=\s*/, '')
    .replace(/;\s*$/, '')
    .replace(/import\.meta\.env\.VITE_CLIENT_THEMES/g, '__FLAG__');
}

(async () => {
  // Compile the real build/ modules (TypeScript, ESM) the way the bundler would.
  function evaluateBuildModule(id) {
    const file = path.join(root, `${id}.ts`);
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    });
    const mod = { exports: {} };
    vm.runInThisContext(`(function(module, exports, process) { ${outputText}\n})`, { filename: file })(
      mod,
      mod.exports,
      process,
    );
    return mod.exports;
  }

  const wrappers = await import(
    pathToFileURL(path.join(root, 'node_modules/@quasar/app-vite/exports/wrappers.js')).href
  );
  const tres = await import(pathToFileURL(require_.resolve('@tresjs/core')).href);
  const configPath = path.join(root, 'quasar.config.ts');
  const source = readFileSync(configPath, 'utf8').replaceAll(
    'import.meta.url',
    JSON.stringify(pathToFileURL(configPath).href),
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const exports_ = {};
  const buildModules = {};
  vm.runInThisContext(`(function(exports, require, process) { ${outputText}\n})`, {
    filename: configPath,
  })(
    exports_,
    (id) => {
      if (id === '#q-app') return wrappers;
      if (id === '@tresjs/core') return tres;
      if (id.startsWith('./build/')) {
        buildModules[id] ??= evaluateBuildModule(id);
        return buildModules[id];
      }
      return require_(id);
    },
    process,
  );
  const cfg = exports_.default({ prod: true, dev: false, mode: { ssr: false } });

  const storeEnabled = evaluate(storeFlagExpression()) === true;
  // Isolated builds skip env files and rely on this define (quasar.config.ts).
  const define = cfg.build.define['import.meta.env.VITE_CLIENT_THEMES'];
  const isolationAwareEnabled =
    typeof define === 'string' ? JSON.parse(define) !== 'false' : storeEnabled;
  console.log(
    JSON.stringify({
      htmlVariable: cfg.htmlVariables.clientThemes,
      isolatedDefine: typeof define === 'string' ? JSON.parse(define) : undefined,
      storeEnabled,
      isolationAwareEnabled,
      // The config's own resolver must agree with the value it published.
      configResolver: evaluate(
        buildModules['./build/clientThemes'].CLIENT_THEMES_EXPRESSION,
      ),
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
