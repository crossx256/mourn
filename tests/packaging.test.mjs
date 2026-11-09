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
const template = fs.readFileSync(path.join(root, 'flatpak/bio.mourn.newlife.yml'), 'utf8');
test('Flatpak materializes Quasar mode aliases from the validated root graph', { skip: process.platform === 'win32' ? 'Flatpak build commands run on Linux' : false }, async () => {
  const command = template.match(/^      - (ln -s \.\.\/node_modules src-capacitor\/node_modules)$/m)?.[1];
  assert.ok(command, 'materialize installed-mode aliases before Quasar prepare');
  assert.ok(template.indexOf(command) > template.indexOf('node flatpak/setup-node.mjs'));
  assert.ok(template.indexOf(command) < template.indexOf('quasar.js prepare'));
  const { spawnSync } = await import('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mourn-mode-alias-'));
  try {
    fs.mkdirSync(path.join(dir, 'src-capacitor'));
    const packages = layout.packages.filter(pkg => /^node_modules\/[^/]+\/[^/]+$/.test(pkg.path) &&
      (pkg.name.startsWith('@capacitor/') || pkg.name.includes('capacitor-')));
    assert.ok(packages.length > 1);
    for (const pkg of packages) {
      fs.mkdirSync(path.join(dir, pkg.path), { recursive: true });
      fs.writeFileSync(path.join(dir, pkg.path, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version }));
    }
    const result = spawnSync('sh', ['-eu', '-c', command], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    for (const pkg of packages) {
      const canonical = path.join(dir, pkg.path, 'package.json');
      assert.equal(fs.realpathSync(path.join(dir, 'src-capacitor', pkg.path, 'package.json')), fs.realpathSync(canonical));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Flatpak bundles a pinned tray library and its complete native dependency chain', () => {
  const match = template.match(/^  - ([^\n]*libayatana-appindicator[^\n]*\.json)$/m);
  assert.ok(match, 'bundle the tray library omitted by the GNOME runtime');
  const base = path.join(root, 'flatpak');
  const modules = [];
  function visit(entry, directory) {
    if (typeof entry === 'string') {
      const file = path.resolve(directory, entry);
      assert.ok(file.startsWith(base + path.sep), 'module stays inside packaging sources');
      return visit(JSON.parse(fs.readFileSync(file, 'utf8')), path.dirname(file));
    }
    for (const child of entry.modules ?? []) visit(child, directory);
    modules.push(entry);
    for (const source of entry.sources ?? []) {
      if (source.type === 'git') assert.match(source.commit ?? '', /^[a-f0-9]{40}$/);
      else if (source.type === 'archive') assert.match(source.sha256 ?? '', /^[a-f0-9]{64}$/);
      else if (source.type === 'patch') {
        for (const relative of source.paths ?? [source.path]) {
          const file = path.resolve(directory, relative);
          assert.ok(file.startsWith(base + path.sep));
          assert.ok(fs.readFileSync(file, 'utf8').length > 0);
        }
      } else assert.fail('Unreviewed native source type: ' + source.type);
    }
  }
  visit(match[1], base);
  assert.deepEqual(modules.map(module => module.name), ['intltool', 'libdbusmenu', 'ayatana-ido', 'libayatana-indicator', 'libayatana-appindicator']);
  const cmake = modules.filter(module => module.buildsystem === 'cmake-ninja');
  assert.equal(cmake.length, 3);
  for (const module of cmake) assert.ok(module['config-opts'].includes('-DCMAKE_INSTALL_LIBDIR=lib'), module.name + ' must install to the Flatpak library search path');
});

test('Flatpak preserves license notices for its bundled native libraries and application', () => {
  const native = JSON.parse(fs.readFileSync(path.join(root, 'flatpak/shared-modules/libayatana-appindicator/libayatana-appindicator-gtk3.json'), 'utf8'));
  for (const module of [native, ...native.modules.filter(entry => typeof entry === 'object')]) {
    const commands = (module['post-install'] ?? []).join('\n');
    assert.ok(commands.includes('COPYING*'), module.name + ' must retain upstream notices');
    assert.ok(commands.includes('/app/share/licenses/bio.mourn.newlife/' + module.name));
    assert.ok(!module.cleanup?.includes('/share'), module.name + ' must not delete its installed notices');
  }
  assert.match(template, /install -Dm644 LICENSE \/app\/share\/licenses\/bio\.mourn\.newlife\/mourn\/LICENSE/);
});

test('the advertised storefront screenshot is included in public assets', () => {
  const xml = fs.readFileSync(path.join(root, 'flatpak/bio.mourn.newlife.metainfo.xml'), 'utf8');
  const image = new URL(xml.match(/<image type="source">([^<]+)<\/image>/)[1]);
  assert.equal(image.origin, 'https://mourn.bio');
  const screenshot = path.join(root, 'public', image.pathname);
  assert.ok(fs.existsSync(screenshot), 'ship the real image referenced by store metadata');
  const png = fs.readFileSync(screenshot);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(png.readUInt32BE(16) >= 640 && png.readUInt32BE(20) >= 360, 'full-sized app screenshot');
});

test('Flatpak installs the approved vector logo as its scalable application icon', () => {
  const file = path.join(root, 'src-tauri/icons/icon.svg');
  assert.ok(fs.existsSync(file), 'retain the supplied SVG instead of only generated PNGs');
  const svg = fs.readFileSync(file);
  assert.equal(createHash('sha256').update(svg).digest('hex'), '7437647f9d30cb48e84bf12fb39c5189f9fddfad59be644f982fac0ef83c0eb9');
  assert.match(svg.toString('utf8'), /<svg\b/);
  assert.doesNotMatch(svg.toString('utf8'), /<(?:script|image|foreignObject)\b/i);
  assert.ok(template.includes('install -Dm644 src-tauri/icons/icon.svg /app/share/icons/hicolor/scalable/apps/bio.mourn.newlife.svg'));
  assert.doesNotMatch(template, /install[^\n]*src-tauri\/icons\/[^\n]*\.png[^\n]*\/icons\//);
});

test('the local Flatpak recipe targets runtime 51 and declares the approved Discord directory grant', () => {
  assert.match(template, /^runtime-version: '51'$/m);
  assert.match(template, /^  - --socket=fallback-x11$/m);
  assert.doesNotMatch(template, /^  - --socket=x11$/m);
  assert.match(template, /^  - --filesystem=xdg-run\/app\/com\.discordapp\.Discord:create(?:\s|$)/m);
});

test('Flatpak uses newlife identity without renaming native or Android installs', () => {
  const file = path.join(root, 'flatpak/bio.mourn.newlife.yml');
  assert.ok(fs.existsSync(file), 'use the approved Flatpak identifier');
  const recipe = fs.readFileSync(file, 'utf8');
  assert.match(recipe, /^app-id: bio\.mourn\.newlife$/m);
  assert.match(recipe, /^        MOURN_FLATPAK_APP_ID: bio\.mourn\.newlife$/m);
  const override = recipe.match(/^        TAURI_CONFIG: '([^\n]+)'$/m);
  assert.ok(override, 'compile the matching Tauri identifier only for Flatpak');
  assert.deepEqual(JSON.parse(override[1]), { identifier: 'bio.mourn.newlife' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8')).identifier, 'bio.mourn.desktop');
  const xml = fs.readFileSync(path.join(root, 'flatpak/bio.mourn.newlife.metainfo.xml'), 'utf8');
  assert.match(xml, /<id>bio\.mourn\.newlife<\/id>/);
  assert.match(xml, /<launchable type="desktop-id">bio\.mourn\.newlife\.desktop<\/launchable>/);
  const desktop = fs.readFileSync(path.join(root, 'flatpak/bio.mourn.newlife.desktop'), 'utf8');
  assert.match(desktop, /^Icon=bio\.mourn\.newlife$/m);
});

test('Flatpak runs the optimized GLib regression and ships its upstream notice', () => {
  const regression = 'cargo test --frozen --release --features custom-protocol --manifest-path src-tauri/Cargo.toml --test glib_variant_iter';
  assert.ok(template.includes(regression), 'test the GLib backport in the actual offline build');
  assert.ok(template.indexOf(regression) > template.indexOf('quasar.js build -m spa'));
  assert.ok(template.indexOf(regression) < template.indexOf('cargo build --frozen'));
  assert.ok(template.includes('install -Dm644 src-tauri/vendor/glib/LICENSE /app/share/licenses/bio.mourn.newlife/glib/LICENSE'));
});

test('native Linux releases retain the optimized GLib safety gate', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
  const step = workflow.match(/      - name: Verify optimized Linux GLib regression\n([\s\S]*?)(?=\n      -)/);
  assert.ok(step, 'do not rely on debug-mode tests for this optimizer-triggered defect');
  assert.ok(step[1].includes("if: runner.os == 'Linux'"));
  assert.ok(step[1].includes('cargo test --locked --release --target'));
  assert.ok(step[1].includes('--test glib_variant_iter'));
  assert.ok(workflow.indexOf(step[0]) > workflow.indexOf('run: bun run tauri:build-signed'));
  assert.ok(workflow.indexOf(step[0]) < workflow.indexOf('node scripts/generate_updater_manifest.js'));
});

test('the reviewed GLib tree is byte-pinned and protected from checkout conversion', async () => {
  const metadata = fs.readFileSync(path.join(root, 'src-tauri/vendor/glib.provenance.json'));
  const provenance = JSON.parse(metadata);
  const generator = fs.readFileSync(path.join(root, 'flatpak/prepare-sources.py'), 'utf8');
  const pinned = generator.match(/REVIEWED_GLIB_PROVENANCE_SHA256 = '([a-f0-9]{64})'/)[1];
  assert.equal(createHash('sha256').update(metadata).digest('hex'), pinned);
  const actual = {};
  function walk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false);
      const name = prefix + entry.name;
      if (entry.isDirectory()) walk(path.join(directory, entry.name), name + '/');
      else {
        assert.ok(entry.isFile());
        actual[name] = createHash('sha256').update(fs.readFileSync(path.join(directory, entry.name))).digest('hex');
      }
    }
  }
  walk(path.join(root, 'src-tauri/vendor/glib'));
  assert.deepEqual(actual, provenance.files);
  const { execFileSync } = await import('node:child_process');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mourn-vendor-bytes-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: directory, stdio: 'pipe' });
    fs.copyFileSync(path.join(root, '.gitattributes'), path.join(directory, '.gitattributes'));
    const result = execFileSync('git', ['check-attr', 'text', '--', 'src-tauri/vendor/glib/src/variant_iter.rs'], { cwd: directory, encoding: 'utf8' });
    assert.match(result, /: text: unset\r?\n$/, 'preserve the exact reviewed upstream bytes on Windows too');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

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
