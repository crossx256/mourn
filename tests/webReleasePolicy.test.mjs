import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const workflow = name => readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
const active = text => text.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');

test('all build workflows retain secrets-first public Cap and Klipy variable fallback', () => {
  for (const name of ['web-release', 'release', 'android']) {
    const source = active(workflow(name));
    for (const key of ['VITE_CAP_API_ENDPOINT', 'VITE_KLIPY_API_KEY']) {
      const definitions = source.split('\n').filter(line => line.trimStart().startsWith(`${key}:`));
      assert.ok(definitions.length > 0, `${name}: ${key} must reach the build`);
      for (const definition of definitions) {
        assert.ok(definition.includes(`\u0024{{ secrets.${key} || vars.${key} }}`), `${name}: ${key} fallback lost`);
      }
    }
  }
});

test('customization stays enabled in every isolated release target', () => {
  for (const name of ['release', 'web-release', 'android']) {
    const source = active(workflow(name));
    assert.match(source, /VITE_CLIENT_THEMES: 'true'/, `${name}: customization flag missing`);
    assert.match(source, /MOURN_ISOLATED_BUILD: '1'/, `${name}: isolated environment missing`);
  }
  const config = readFileSync(new URL('../quasar.config.ts', import.meta.url), 'utf8');
  assert.match(config, /'VITE_CLIENT_THEMES'/);
  assert.match(config, /from '\.\/build\/clientThemes'/);
  // Customization is on by default; the flag exists only as an opt-out. The
  // expression itself and its execution are covered by tests/theme.flag.test.ts
  // (config html variable, isolated define and THEME_ENABLED in one run); this
  // check only fails if the config stops using the single source of truth.
  assert.doesNotMatch(config, /VITE_CLIENT_THEMES === 'true'/);
  const store = readFileSync(new URL('../src/stores/theme.ts', import.meta.url), 'utf8');
  assert.match(store, /THEME_ENABLED = import\.meta\.env\.VITE_CLIENT_THEMES !== 'false'/);
});

test('SSR review packaging retains configuration gates, checkout provenance and locked runtime dependencies', () => {
  const source = active(workflow('web-release'));
  assert.match(source, /for name in VITE_API_BASE VITE_WS_BASE VITE_CAP_API_ENDPOINT; do/);
  assert.match(source, /exit "\$missing"/);
  assert.match(source, /::warning::VITE_KLIPY_API_KEY is empty/);
  assert.match(source, /bun-version: 1\.4\.2/);
    assert.match(source, /bun install --frozen-lockfile --ignore-scripts/);
    assert.match(source, /run: node node_modules\/@quasar\/app-vite\/bin\/quasar\.js prepare/);
  assert.match(source, /working-directory: dist\/ssr\n\s+run: npm install --package-lock-only --omit=dev --legacy-peer-deps --no-audit --no-fund/);
  assert.match(source, /COMMIT="\$\(git rev-parse HEAD\)" node -e/);
  assert.match(source, /dist\/ssr\/BUILD_INFO.json/);
  assert.match(source, /tag: process.env.RELEASE_TAG/);
  assert.match(source, /commit: process.env.COMMIT/);
  assert.doesNotMatch(source, /commit: process.env.GITHUB_SHA/);
  assert.match(source, /tar .*--exclude=['"]?node_modules['"]?.*-C dist\/ssr \./);
  assert.match(source, /sha256sum "\$\{name\}" > "\$\{name\}\.sha256"/);
});

function shellStep(name) {
  const source = workflow('web-release');
  const step = source.split(`      - name: ${name}\n`)[1]?.split('\n      - name:')[0];
  const script = step?.split('        run: |\n')[1];
  assert.ok(script, `missing shell step: ${name}`);
  return script.split('\n').filter(line => !line || line.startsWith('          ')).map(line => line.slice(10)).join('\n');
}

test('web configuration gate rejects missing Cap but permits optional Klipy without exposing values', { skip: process.platform !== 'linux' }, () => {
  const run = overrides => spawnSync('bash', ['-c', shellStep('Verify build-time configuration')], {
    encoding: 'utf8', timeout: 5000,
    env: { ...process.env, VITE_API_BASE: 'https://api.example', VITE_WS_BASE: 'https://ws.example',
      VITE_CAP_API_ENDPOINT: 'https://cap.example/public-fixture', VITE_KLIPY_API_KEY: '', ...overrides },
  });
  const valid = run({});
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /::warning::VITE_KLIPY_API_KEY is empty/);
  assert.doesNotMatch(valid.stdout, /cap\.example/);
  for (const key of ['VITE_API_BASE', 'VITE_WS_BASE', 'VITE_CAP_API_ENDPOINT']) {
    const invalid = run({ [key]: '' });
    assert.equal(invalid.status, 1);
    assert.ok(invalid.stdout.includes(`::error::${key} is empty`));
  }
});

// These shell steps ship only in the Ubuntu SSR workflow; keep their policy
// assertions above cross-platform and execute the actual Unix tools on Linux.
test('SSR packaging produces a checksum-verifiable tarball with lockfile and provenance, without node_modules', { skip: process.platform !== 'linux' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'mourn-web-policy-'));
  try {
    const ssr = join(root, 'dist/ssr');
    mkdirSync(join(ssr, 'node_modules'), { recursive: true });
    for (const name of ['index.js', 'package.json', 'package-lock.json', 'BUILD_INFO.json']) {
      writeFileSync(join(ssr, name), '{}\n');
    }
    writeFileSync(join(ssr, 'node_modules/fixture'), 'must not ship');
    const result = spawnSync('bash', ['-c', shellStep('Package bundle')], {
      cwd: root, encoding: 'utf8', timeout: 5000, env: { ...process.env, RELEASE_TAG: 'v1.4.8' },
    });
    assert.equal(result.status, 0, result.stderr);
    const artifacts = join(root, 'artifacts');
    const checksum = spawnSync('sha256sum', ['-c', 'mourn-web-ssr-1.4.8.tar.gz.sha256'], {
      cwd: artifacts, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(checksum.status, 0, checksum.stderr);
    const listing = spawnSync('tar', ['-tzf', join(artifacts, 'mourn-web-ssr-1.4.8.tar.gz')], {
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(listing.status, 0, listing.stderr);
    for (const name of ['index.js', 'package.json', 'package-lock.json', 'BUILD_INFO.json']) {
      assert.ok(listing.stdout.split('\n').includes(`./${name}`), `${name} missing from payload`);
    }
    assert.doesNotMatch(listing.stdout, /node_modules/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('desktop and Android stay manual, tag-gated and read-only except the publish job', () => {
  for (const name of ['release', 'android']) {
    const source = active(workflow(name));
    assert.match(source, /^  workflow_dispatch:/m);
    assert.doesNotMatch(source, /^\s+(?:push|pull_request|workflow_run|release|schedule):/m);
    assert.match(source, /^permissions:\n  contents: read/m);
    assert.match(source, /environment: release-signing/);
    assert.match(source, /uses: actions\/upload-artifact@[a-f0-9]{40}/);
    if (name === 'android') {
      assert.doesNotMatch(source, /contents: write|gh release|GH_TOKEN/);
    } else {
      // The desktop workflow may publish, but only from a job the operator
      // explicitly opts into; everything before it stays read-only.
      const writeIdx = source.indexOf('contents: write');
      assert.ok(writeIdx > 0, 'desktop publishing lost its write scope');
      assert.ok(
        writeIdx > source.indexOf('name: reviewed-release-draft'),
        'the write scope must come only after the reviewed draft exists',
      );
      assert.match(source, /if: github\.event_name == 'workflow_dispatch' && inputs\.publish == 'true'/);
    }
  }
});

test('web releases are manual protected read-only review artifacts, independent of desktop publication', () => {
  const web = active(workflow('web-release'));
  assert.match(web, /^  workflow_dispatch:/m);
  assert.doesNotMatch(web, /^\s+(?:push|pull_request|workflow_run|release|schedule):/m);
  assert.match(web, /^permissions:\n  contents: read/m);
  assert.doesNotMatch(web, /contents: write|GH_TOKEN|gh release|sleep 20|needs:.*(?:publish|build)/);
  assert.match(web, /^    environment: release-signing$/m);
  assert.match(web, /uses: actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(web, /name: mourn-web-ssr-review/);
  assert.match(web, /path: artifacts\//);
  assert.match(web, /if-no-files-found: error/);
  assert.match(web, /RELEASE_TAG: \$\{\{ inputs.tag \}\}/);
  assert.match(web, /ref: refs\/tags\/\$\{\{ inputs.tag \}\}/);
  assert.match(web, /fetch-depth: 0/);
  assert.match(web, /persist-credentials: false/);
  const validation = web.indexOf('run: node scripts/verify_release_version.js');
  assert.ok(validation > 0 && validation < web.indexOf('run: bun install'), 'validate exact tag and versions before dependencies');
});
