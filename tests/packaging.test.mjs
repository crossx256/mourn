import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planNodeBins, setupNode } from '../flatpak/setup-node.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const layout = JSON.parse(fs.readFileSync(path.join(root, 'flatpak/node-layout.json'), 'utf8'));

for (const arch of ['x86_64', 'aarch64']) {
  test('locked bin layout has one explicitly reviewed sass owner on ' + arch, () => {
    const bins = planNodeBins(layout, arch);
    assert.equal(new Set(bins.map(bin => bin.link)).size, bins.length);
    const sass = bins.filter(bin => bin.link === 'node_modules/.bin/sass');
    assert.equal(sass.length, 1);
    assert.equal(sass[0].pkg.path, 'node_modules/sass-embedded');
    assert.equal(sass[0].target, 'node_modules/sass-embedded/dist/bin/sass.js');
    assert.ok(layout.packages.some(pkg => pkg.path === 'node_modules/sass'));
  });
}

test('new contenders, missing owners, and stale ownership policies fail before linking', () => {
  const extra = structuredClone(layout);
  extra.packages.push({ path: 'node_modules/new-sass', bin: { sass: 'bin.js' }, arches: ['x86_64'] });
  assert.throws(() => planNodeBins(extra, 'x86_64'), /Unreviewed executable collision/);
  const missing = structuredClone(layout);
  delete missing.binOwners['node_modules/.bin/sass'];
  assert.throws(() => planNodeBins(missing, 'x86_64'), /Unreviewed executable collision/);
  const stale = structuredClone(layout);
  stale.packages = stale.packages.filter(pkg => pkg.path !== 'node_modules/sass-embedded');
  assert.throws(() => planNodeBins(stale, 'x86_64'), /Stale/);
  const wrong = structuredClone(layout);
  wrong.binOwners['node_modules/.bin/sass'].owner = 'node_modules/missing';
  assert.throws(() => planNodeBins(wrong, 'x86_64'), /owner is missing/);
});

test('unsafe executable paths and unreviewed nested collisions are rejected', () => {
  const pkg = { path: 'node_modules/a', name: 'a', version: '1', bin: { tool: '../outside' }, arches: ['x86_64'] };
  const fixture = { schema: 2, packages: [pkg], binOwners: {} };
  assert.throws(() => planNodeBins(fixture, 'x86_64'), /escapes/);
  pkg.bin = { '..': 'inside.js' };
  assert.throws(() => planNodeBins(fixture, 'x86_64'), /Unsafe/);
  fixture.packages = ['a', 'b'].map(name => ({ path: 'node_modules/parent/node_modules/' + name, bin: { sass: 'bin.js' }, arches: ['x86_64'] }));
  assert.throws(() => planNodeBins(fixture, 'x86_64'), /Unreviewed/);
});

test('materialization validates identities and never executes dependency lifecycle code', { skip: process.platform === 'win32' ? 'POSIX executable symlinks require Linux; planner is tested on Windows' : false }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mourn-layout-test-'));
  try {
    const fixture = structuredClone(layout);
    fixture.packages = fixture.packages.filter(pkg => ['node_modules/sass', 'node_modules/sass-embedded'].includes(pkg.path));
    const marker = path.join(dir, 'lifecycle-was-run');
    for (const pkg of fixture.packages) {
      const target = path.join(dir, pkg.path, Object.values(pkg.bin)[0]);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(path.join(dir, pkg.path, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, scripts: { postinstall: 'exit 99' } }));
      fs.writeFileSync(target, `throw new Error('Must not execute dependency code'); // ${marker}`);
    }
    setupNode(dir, fixture, 'x86_64');
    assert.equal(fs.realpathSync(path.join(dir, 'node_modules/.bin/sass')), fs.realpathSync(path.join(dir, 'node_modules/sass-embedded/dist/bin/sass.js')));
    assert.equal(fs.existsSync(marker), false);
    setupNode(dir, fixture, 'x86_64');
    fs.writeFileSync(path.join(dir, 'node_modules/sass/package.json'), JSON.stringify({ name: 'sass', version: 'wrong' }));
    assert.throws(() => setupNode(dir, fixture, 'x86_64'), /identity mismatch/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const { submissionManifest } = await import('../flatpak/submission-manifest.mjs');
const { createHash } = await import('node:crypto');
const template = fs.readFileSync(path.join(root, 'flatpak/bio.mourn.desktop.yml'), 'utf8');
const archive = Buffer.from('offline archive fixture');
const config = {
  publicArchiveVerified: true, archiveUrl: 'https://downloads.example.org/source.tar.gz',
  archiveSha256: createHash('sha256').update(archive).digest('hex'),
  runtimeCommit: 'a'.repeat(64), sdkCommit: 'b'.repeat(64),
  runtimeVersion: '50', nodeVersion: '25.08', rustVersion: '25.08',
  capEndpoint: 'https://cap.example.org/public-site-key/',
};

test('submission generator replaces local source and pins explicit inputs without changing permissions', () => {
  const output = submissionManifest(template, config, archive);
  assert.doesNotMatch(output, /type: dir|path: \.\./);
  assert.match(output, /type: archive/);
  assert.match(output, /strip-components: 0/, 'audited archives contain files directly at the root');
  assert.ok(output.includes(config.archiveSha256));
  assert.ok(output.includes('runtime-commit: ' + config.runtimeCommit));
  assert.ok(output.includes('Extension.node22/25.08'));
  assert.match(output, /VITE_CLIENT_THEMES: 'true'/);
  assert.ok(output.includes(JSON.stringify(config.capEndpoint)));
  assert.equal(output.split('finish-args:')[1].split('modules:')[0], template.split('finish-args:')[1].split('modules:')[0]);
  assert.equal(submissionManifest(template, config, archive), output);
});

test('submission generation fails closed on missing, unsafe, unverified or mismatched inputs', () => {
  for (const key of Object.keys(config)) {
    const missing = { ...config }; delete missing[key];
    assert.throws(() => submissionManifest(template, missing, archive), undefined, key);
  }
  for (const archiveUrl of ['http://example.org/a', 'https://user:password@example.org/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://example.org/a?token=secret']) {
    assert.throws(() => submissionManifest(template, { ...config, archiveUrl }, archive));
  }
  assert.throws(() => submissionManifest(template, config, Buffer.from('different')), /checksum mismatch/);
  assert.throws(() => submissionManifest(template, { ...config, runtimeVersion: '50\nfinish-args: []' }, archive));
  assert.throws(() => submissionManifest(template.replace('type: dir', 'type: git'), config, archive), /local source/);
  assert.match(template, /test -n "\$\{VITE_CAP_API_ENDPOINT:-\}"/);
});
