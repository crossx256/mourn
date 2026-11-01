import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// These integrations execute Linux ELF tools and AppImage shell helpers.
// Run them on Linux; Windows still runs the portable release-policy tests.
describe('Linux AppImage and GStreamer integration', { skip: process.platform !== 'linux' }, () => {
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const script = path.join(root, 'scripts/pin_linuxdeploy_for_bundling.sh');
const bash = '/bin/bash';
const mediaScript = path.join(root, 'scripts/bundler-tools/mourn-gstreamer-bundle.sh');
const run = (args, options = {}) => spawnSync(bash, [mediaScript, ...args], {
  encoding: 'utf8', timeout: 20000, ...options,
});

test('original GStreamer helper implements API discovery and rejects ambiguous arguments', () => {
  assert.equal(run(['--plugin-api-version']).stdout, '0\n');
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /GSTREAMER_PLUGINS_DIR/);
  for (const args of [[], ['--appdir'], ['--wat'], ['--appdir', '/missing'],
    ['--plugin-api-version', '--wat'], ['--appdir', '.', '--appdir', '.']]) {
    assert.notEqual(run(args).status, 0, JSON.stringify(args));
  }
});

test('legacy plugin filename is only an original compatibility launcher', () => {
  const wrapper = path.join(root, 'scripts/bundler-tools/linuxdeploy-plugin-gstreamer.sh');
  assert.ok(fs.readFileSync(wrapper, 'utf8').includes('mourn-gstreamer-bundle.sh'), 'legacy entry point must delegate to original implementation');
  const r = spawnSync(bash, [wrapper, '--plugin-api-version'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '0\n');
});

test('GStreamer preflight fails closed before mutation or arbitrary tool overrides', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mourn-media preflight-'));
  try {
    const app = path.join(dir, 'App Dir');
    fs.mkdirSync(app);
    const sentinel = path.join(app, 'sentinel');
    fs.writeFileSync(sentinel, 'unchanged');
    const base = { ...process.env, GSTREAMER_PLUGINS_DIR: path.join(dir, 'absent'),
      GSTREAMER_HELPERS_DIR: path.join(dir, 'absent'), LINUXDEPLOY: '/must/not/execute',
      LINUXDEPLOY_BIN: '/must/not/execute', XDG_CACHE_HOME: dir };
    let r = run(['--appdir', app], { env: base });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /plugin directory/);
    fs.mkdirSync(path.join(dir, 'plugins'));
    r = run(['--appdir', app], { env: { ...base, GSTREAMER_PLUGINS_DIR: path.join(dir, 'plugins') } });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /helper directory/);
    assert.deepEqual(fs.readdirSync(app), ['sentinel']);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'unchanged');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function command(command, args, options = {}) {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: 20000, ...options });
  assert.equal(r.status, 0, `${command}: ${r.stderr}`);
  return r.stdout;
}

function mediaFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mourn-media fixture-'));
  const app = path.join(dir, 'App Dir');
  const plugins = path.join(dir, 'source plugins');
  const helpers = path.join(dir, 'source helpers');
  const cache = path.join(dir, 'cache');
  const stable = path.join(cache, 'tauri/linuxdeploy-stable');
  const tree = path.join(stable, 'squashfs-root');
  for (const d of [app, plugins, helpers, tree]) fs.mkdirSync(d, { recursive: true });
  const arch = { x64: 'x86_64', arm64: 'aarch64', arm: 'armhf', ia32: 'i386' }[process.arch];
  const image = path.join(stable, `linuxdeploy-${arch}.AppImage`);
  fs.copyFileSync('/bin/true', image);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(image)).digest('hex');
  fs.writeFileSync(path.join(stable, 'source.sha256'), `${digest}\n`);
  // This explicit synthetic resolver is not a real linuxdeploy execution.
  const apprun = path.join(tree, 'AppRun');
  fs.writeFileSync(apprun, `#!/bin/bash\nset -eu\nprintf '%s\\0' "$@" > "$MEDIA_LOG"\n[ "\${MEDIA_RESOLVER_FAIL:-0}" = 0 ] || exit 41\n[ "$1" = --appdir ]\ncp -- "$MEDIA_DEPENDENCY" "$2/usr/lib/libmournfixture.so"\n`, { mode: 0o755 });
  const refreshManifest = () => {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(apprun)).digest('hex');
    fs.writeFileSync(path.join(stable, 'extracted.sha256'), `${hash}  ./AppRun\n`);
  };
  refreshManifest();
  const dep = path.join(dir, 'libmournfixture.so');
  const c = path.join(dir, 'dependency.c');
  fs.writeFileSync(c, 'int fixture_dependency(void) { return 42; }\n');
  command('cc', ['-shared', '-fPIC', '-Wl,-soname,libmournfixture.so', c, '-o', dep]);
  fs.writeFileSync(c, 'extern int fixture_dependency(void); int fixture_value(void) { return fixture_dependency(); }\n');
  command('cc', ['-shared', '-fPIC', c, `-L${dir}`, '-lmournfixture', `-Wl,-rpath,${dir}`, '-o', path.join(plugins, 'libgstfixture.so')]);
  fs.symlinkSync('libgstfixture.so', path.join(plugins, 'libgstalias.so'));
  fs.writeFileSync(c, 'extern int fixture_dependency(void); int main(void) { return fixture_dependency() == 42 ? 0 : 1; }\n');
  command('cc', [c, `-L${dir}`, '-lmournfixture', `-Wl,-rpath,${dir}`, '-o', path.join(helpers, 'gst-plugin-scanner')]);
  fs.copyFileSync(path.join(helpers, 'gst-plugin-scanner'), path.join(helpers, 'gst-ptp-helper'));
  fs.writeFileSync(path.join(plugins, 'not-ELF.txt'), 'not a plugin');
  const env = { ...process.env, XDG_CACHE_HOME: cache, LINUXDEPLOY_SHA256: digest,
    GSTREAMER_PLUGINS_DIR: plugins, GSTREAMER_HELPERS_DIR: helpers, GSTREAMER_INCLUDE_BAD_PLUGINS: '1',
    MEDIA_LOG: path.join(dir, 'resolver args'), MEDIA_DEPENDENCY: dep,
    LINUXDEPLOY: '/must/not/execute', LINUXDEPLOY_BIN: '/must/not/execute' };
  return { dir, app, plugins, helpers, stable, tree, apprun, dep, env, refreshManifest,
    clean: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const elfTools = process.platform === 'linux' && ['cc', 'patchelf', 'python3'].every(tool => spawnSync('which', [tool]).status === 0);
if (process.platform === 'linux') assert.ok(elfTools, 'Linux ELF regressions require cc, patchelf and python3');

const graphicsRemoved = [
  'libva.so', 'libva.so.2', 'libva-drm.so', 'libva-drm.so.2',
  'libva-x11.so', 'libva-x11.so.2', 'libva-glx.so', 'libva-glx.so.2',
  'libvulkan.so', 'libvulkan.so.1',
  'libvulkan_asahi.so', 'libvulkan_intel_hasvk.so', 'libvulkan_lvp.so',
  'libvulkan_nouveau.so', 'libvulkan_virtio.so', 'libvulkan_radeon.so',
  'libvulkan_intel.so', 'libvulkan_gfxstream.so',
];
const graphicsRetained = ['libvamp-mournfixture.so.3', 'libvault-mournfixture.so.1',
  'libvulkan-mournfixture.so.1', 'libva-extra-mournfixture.so.1',
  'libwayland-client.so.0', 'libxcb-render.so.0'];

for (const helper of ['GStreamer', 'GTK']) {
  test(`${helper} precise graphics pruning preserves loadable non-driver ELF dependencies`, { skip: !elfTools }, () => {
    const f = mediaFixture();
    try {
      const stage = path.join(f.dir, 'graphics stage');
      for (const sub of ['usr/lib', 'usr/lib64', 'lib', 'lib64']) {
        const nested = path.join(stage, sub, 'nested');
        fs.mkdirSync(nested, { recursive: true });
        for (const name of [...graphicsRemoved, ...graphicsRetained]) fs.copyFileSync(f.dep, path.join(nested, name));
        // Test real links as well as regular files, including dangling driver links.
        fs.symlinkSync('missing', path.join(nested, 'libva.so.99'));
      }
      let plugin;
      if (helper === 'GStreamer') {
        plugin = path.join(f.plugins, 'libgstfixture.so');
        fs.appendFileSync(f.apprun, '\ncp -a -- "$MEDIA_GRAPHICS/." "$2/"\ncp -- "$MEDIA_DEPENDENCY" "$2/usr/lib/libvamp-mournfixture.so.3"\ncp -- "$MEDIA_DEPENDENCY" "$2/usr/lib/libvault-mournfixture.so.1"\n');
        f.env.MEDIA_GRAPHICS = stage;
        f.refreshManifest();
      } else {
        const r = run(['--appdir', f.app], { env: f.env });
        assert.equal(r.status, 0, r.stderr);
        fs.cpSync(stage, f.app, { recursive: true, verbatimSymlinks: true });
        for (const name of graphicsRetained.slice(0, 2)) fs.copyFileSync(f.dep, path.join(f.app, 'usr/lib', name));
        plugin = path.join(f.app, 'usr/lib/gstreamer-1.0/libgstfixture.so');
      }
      command('patchelf', ['--replace-needed', 'libmournfixture.so', graphicsRetained[0], plugin]);
      command('patchelf', ['--add-needed', graphicsRetained[1], plugin]);
      if (helper === 'GStreamer') {
        const r = run(['--appdir', f.app], { env: f.env });
        assert.equal(r.status, 0, r.stderr);
        plugin = path.join(f.app, 'usr/lib/gstreamer-1.0/libgstfixture.so');
      } else {
        // Execute the actual local prune block, not a reimplementation or a
        // regex-only assertion. Do not source upstream GTK provisioning/AppRun.
        const gtk = fs.readFileSync(path.join(root, 'scripts/bundler-tools/linuxdeploy-plugin-gtk.sh'), 'utf8');
        const start = gtk.indexOf('MOURN_PRUNE_PATTERNS=(');
        assert.ok(start >= 0, 'GTK local prune block must exist');
        command(bash, ['-eu', '-c', gtk.slice(start)], { env: { ...process.env, APPDIR: f.app } });
      }
      command('python3', ['-c', 'import ctypes,sys; assert ctypes.CDLL(sys.argv[1]).fixture_value() == 42', plugin],
        { env: { ...process.env, LD_LIBRARY_PATH: '' } });
      for (const sub of ['usr/lib', 'usr/lib64', 'lib', 'lib64']) {
        assert.deepEqual(fs.readdirSync(path.join(f.app, sub, 'nested')).sort(), [...graphicsRetained].sort(), sub);
      }
    } finally { f.clean(); }
  });
}

test('GStreamer changed-input reruns reconcile only owned media directories and converge', { skip: !elfTools }, () => {
  const f = mediaFixture();
  try {
    const lib = path.join(f.app, 'usr/lib');
    fs.mkdirSync(path.join(lib, 'unrelated'), { recursive: true });
    const unrelated = path.join(lib, 'unrelated/libkeep.so');
    fs.writeFileSync(unrelated, 'must survive byte-for-byte');
    const pluginDest = path.join(lib, 'gstreamer-1.0');
    const helperDest = path.join(lib, 'gstreamer1.0/gstreamer-1.0');
    const sibling = path.join(lib, 'gstreamer1.0/unrelated');
    fs.mkdirSync(path.dirname(sibling));
    fs.writeFileSync(sibling, 'not owned');
    fs.mkdirSync(path.join(f.plugins, 'obsolete'));
    fs.copyFileSync(f.dep, path.join(f.plugins, 'obsolete/libgstremoved.so'));
    let r = run(['--appdir', f.app], { env: f.env });
    assert.equal(r.status, 0, r.stderr);
    // Rename a real plugin, remove its alias and optional helper, and remove a
    // nested plugin subtree. The resolver must never see any obsolete inputs.
    fs.rmSync(path.join(f.plugins, 'libgstalias.so'));
    fs.renameSync(path.join(f.plugins, 'libgstfixture.so'), path.join(f.plugins, 'libgstrenamed.so'));
    fs.rmSync(path.join(f.helpers, 'gst-ptp-helper'));
    fs.rmSync(path.join(f.plugins, 'obsolete'), { recursive: true });
    r = run(['--appdir', f.app], { env: f.env });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(fs.readdirSync(pluginDest), ['libgstrenamed.so']);
    assert.deepEqual(fs.readdirSync(helperDest), ['gst-plugin-scanner']);
    const args = fs.readFileSync(f.env.MEDIA_LOG, 'utf8').split('\0').filter(Boolean);
    assert.deepEqual(args.slice(2), ['--deploy-deps-only', path.join(pluginDest, 'libgstrenamed.so'),
      '--deploy-deps-only', path.join(helperDest, 'gst-plugin-scanner')]);
    assert.equal(fs.readFileSync(unrelated, 'utf8'), 'must survive byte-for-byte');
    assert.equal(fs.readFileSync(sibling, 'utf8'), 'not owned');
    command('python3', ['-c', 'import ctypes,sys; assert ctypes.CDLL(sys.argv[1]).fixture_value() == 42', path.join(pluginDest, 'libgstrenamed.so')]);
    const snapshot = () => [path.join(pluginDest, 'libgstrenamed.so'), path.join(helperDest, 'gst-plugin-scanner'),
      path.join(f.app, 'apprun-hooks/linuxdeploy-plugin-gstreamer.sh'), unrelated, sibling].map(p => fs.readFileSync(p));
    const before = snapshot();
    r = run(['--appdir', f.app], { env: f.env });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(snapshot(), before, 'same-input rerun must be byte-idempotent');
    // A removed mandatory scanner fails preflight, before reconciliation or
    // resolver execution. A prior AppDir is not a successful new build.
    fs.rmSync(path.join(f.helpers, 'gst-plugin-scanner'));
    fs.rmSync(f.env.MEDIA_LOG);
    r = run(['--appdir', f.app], { env: f.env });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no ELF files|gst-plugin-scanner/);
    assert.ok(!fs.existsSync(f.env.MEDIA_LOG));
    assert.deepEqual(snapshot(), before, 'failed preflight must leave prior AppDir untouched');
  } finally { f.clean(); }
});

for (const unsafe of ['media root alias', 'ancestor alias', 'nested escaping link']) {
  test(`GStreamer reconciliation rejects ${unsafe} before mutation`, { skip: !elfTools }, () => {
    const f = mediaFixture();
    try {
      const lib = path.join(f.app, 'usr/lib');
      const owned = path.join(lib, 'gstreamer-1.0');
      const safe = path.join(f.app, 'unrelated');
      fs.mkdirSync(safe);
      const sentinel = path.join(safe, 'sentinel');
      fs.writeFileSync(sentinel, 'untouched');
      fs.mkdirSync(lib, { recursive: true });
      if (unsafe === 'media root alias') fs.symlinkSync(safe, owned);
      else if (unsafe === 'ancestor alias') {
        fs.mkdirSync(path.join(safe, 'gstreamer-1.0'));
        fs.symlinkSync(safe, path.join(lib, 'gstreamer1.0'));
      } else {
        fs.mkdirSync(owned);
        fs.symlinkSync(f.plugins, path.join(owned, 'external'));
      }
      const r = run(['--appdir', f.app], { env: f.env });
      assert.notEqual(r.status, 0, unsafe);
      assert.match(r.stderr, /destination.*symlink|symlink.*destination/, unsafe);
      assert.equal(fs.readFileSync(sentinel, 'utf8'), 'untouched');
      assert.ok(fs.existsSync(path.join(f.plugins, 'libgstfixture.so')));
      assert.ok(!fs.existsSync(f.env.MEDIA_LOG));
      assert.ok(!fs.existsSync(path.join(f.app, 'apprun-hooks/linuxdeploy-plugin-gstreamer.sh')));
    } finally { f.clean(); }
  });
}

test('GStreamer bundles real plugin and helper ELF files that load after relocation', { skip: !elfTools }, () => {
  const f = mediaFixture();
  try {
    const result = run(['--appdir', f.app], { env: f.env });
    assert.equal(result.status, 0, result.stderr);
    const args = fs.readFileSync(f.env.MEDIA_LOG, 'utf8').split('\0').filter(Boolean);
    assert.deepEqual(args.slice(0, 2), ['--appdir', f.app]);
    assert.ok(args.includes('--deploy-deps-only'));
    assert.ok(args.includes(path.join(f.app, 'usr/lib/gstreamer-1.0/libgstfixture.so')));
    assert.ok(args.includes(path.join(f.app, 'usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner')));
    assert.ok(args.includes(path.join(f.app, 'usr/lib/gstreamer1.0/gstreamer-1.0/gst-ptp-helper')));
    fs.rmSync(f.plugins, { recursive: true });
    fs.rmSync(f.helpers, { recursive: true });
    fs.rmSync(f.dep);
    const moved = path.join(f.dir, 'moved App Dir');
    fs.renameSync(f.app, moved);
    const plugin = path.join(moved, 'usr/lib/gstreamer-1.0/libgstfixture.so');
    const scanner = path.join(moved, 'usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner');
    assert.equal(command('patchelf', ['--print-rpath', plugin]).trim(), '$ORIGIN:$ORIGIN/..');
    assert.equal(command('patchelf', ['--print-rpath', scanner]).trim(), '$ORIGIN:$ORIGIN/../..');
    command(scanner, [], { env: { ...process.env, LD_LIBRARY_PATH: '' } });
    command('python3', ['-c', 'import ctypes,sys; assert ctypes.CDLL(sys.argv[1]).fixture_value() == 42', plugin],
      { env: { ...process.env, LD_LIBRARY_PATH: '' } });
    assert.ok(fs.existsSync(path.join(moved, 'usr/lib/gstreamer-1.0/libgstalias.so')));
    assert.ok(!fs.existsSync(path.join(moved, 'usr/lib/gstreamer-1.0/not-ELF.txt')));
    const hook = path.join(moved, 'apprun-hooks/linuxdeploy-plugin-gstreamer.sh');
    const output = command(bash, ['-c', 'source "$1"; printf "%s\\n" "$GST_PLUGIN_PATH_1_0" "$GST_PLUGIN_SYSTEM_PATH_1_0" "$GST_PLUGIN_SCANNER_1_0" "$GST_PTP_HELPER_1_0" "$GST_REGISTRY_1_0"', '_', hook],
      { env: { ...process.env, APPDIR: moved, XDG_CACHE_HOME: path.join(f.dir, 'runtime cache'),
        GST_PLUGIN_PATH_1_0: '/wrong', GST_PLUGIN_SCANNER_1_0: '/wrong', GST_REGISTRY_1_0: '/wrong' } }).trim().split('\n');
    assert.deepEqual(output.slice(0, 4), [path.dirname(plugin), path.dirname(plugin), scanner, path.join(path.dirname(scanner), 'gst-ptp-helper')]);
    assert.ok(output[4].startsWith(path.join(f.dir, 'runtime cache/mourn/')));
    assert.ok(!fs.readFileSync(hook, 'utf8').includes(f.app));
  } finally { f.clean(); }
});

test('installed audio and video codecs run with relocated plugins and scanner (host shared libraries)', { skip: !elfTools }, t => {
  const f = mediaFixture();
  try {
    const systemPlugins = spawnSync('pkg-config', ['--variable=pluginsdir', 'gstreamer-1.0'], { encoding: 'utf8' });
    const systemHelpers = spawnSync('pkg-config', ['--variable=pluginscannerdir', 'gstreamer-1.0'], { encoding: 'utf8' });
    const names = ['coreelements', 'audiotestsrc', 'audioconvert', 'vorbis', 'videotestsrc', 'vpx'];
    if (systemPlugins.status !== 0 || systemHelpers.status !== 0 || spawnSync('which', ['gst-launch-1.0']).status !== 0 ||
      !names.every(name => fs.existsSync(path.join(systemPlugins.stdout.trim(), `libgst${name}.so`))) ||
      !fs.existsSync(path.join(systemHelpers.stdout.trim(), 'gst-plugin-scanner'))) {
      t.skip('installed GStreamer scanner, Vorbis/VP8 or tools unavailable');
      return;
    }
    fs.rmSync(f.plugins, { recursive: true }); fs.mkdirSync(f.plugins);
    fs.rmSync(f.helpers, { recursive: true }); fs.mkdirSync(f.helpers);
    for (const name of names) fs.copyFileSync(path.join(systemPlugins.stdout.trim(), `libgst${name}.so`), path.join(f.plugins, `libgst${name}.so`));
    fs.copyFileSync(path.join(systemHelpers.stdout.trim(), 'gst-plugin-scanner'), path.join(f.helpers, 'gst-plugin-scanner'));
    const r = run(['--appdir', f.app], { env: f.env });
    assert.equal(r.status, 0, r.stderr);
    fs.rmSync(f.plugins, { recursive: true });
    fs.rmSync(f.helpers, { recursive: true });
    const moved = path.join(f.dir, 'real media moved AppDir');
    fs.renameSync(f.app, moved);
    const hook = path.join(moved, 'apprun-hooks/linuxdeploy-plugin-gstreamer.sh');
    const pipelines = [
      ['audiotestsrc', 'num-buffers=8', '!', 'audioconvert', '!', 'vorbisenc', '!', 'vorbisdec', '!', 'fakesink'],
      ['videotestsrc', 'num-buffers=4', '!', 'video/x-raw,width=64,height=48', '!', 'vp8enc', 'deadline=1', '!', 'vp8dec', '!', 'fakesink'],
    ];
    for (const pipeline of pipelines) {
      const p = spawnSync(bash, ['-c', 'source "$1"; shift; exec gst-launch-1.0 -q "$@"', '_', hook, ...pipeline], {
        encoding: 'utf8', timeout: 20000, env: { ...process.env, APPDIR: moved,
          XDG_CACHE_HOME: path.join(f.dir, `real registry ${pipeline[0]}`),
          GST_DEBUG: 'GST_PLUGIN_LOADING:6', GST_REGISTRY_FORK: 'yes', LD_LIBRARY_PATH: '' },
      });
      assert.equal(p.status, 0, p.stderr);
      assert.ok(p.stderr.includes(path.join(moved, 'usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner')), 'relocated scanner must be used');
      assert.doesNotMatch(p.stderr, /External plugin loader failed/);
    }
  } finally { f.clean(); }
});

test('GStreamer rejects unverified cache and unsafe media paths without running tools', { skip: !elfTools }, () => {
  const cases = [
    ['missing digest', f => { delete f.env.LINUXDEPLOY_SHA256; }, /LINUXDEPLOY_SHA256/],
    ['unbound marker', f => fs.writeFileSync(path.join(f.stable, 'source.sha256'), '0'.repeat(64)), /unbound/],
    ['modified image', f => fs.appendFileSync(path.join(f.stable, `linuxdeploy-${{ x64: 'x86_64', arm64: 'aarch64', arm: 'armhf', ia32: 'i386' }[process.arch]}.AppImage`), 'tampered'), /digest mismatch/],
    ['modified AppRun', f => fs.appendFileSync(f.apprun, '\nexit 98\n'), /integrity mismatch/],
    ['missing manifest', f => fs.rmSync(path.join(f.stable, 'extracted.sha256')), /manifest/],
    ['symlink extraction root', f => { fs.renameSync(f.tree, `${f.tree}.elsewhere`); fs.symlinkSync(`${f.tree}.elsewhere`, f.tree); }, /symlink extraction root/],
    ['escaping extraction', f => fs.symlinkSync('/bin/true', path.join(f.tree, 'outside')), /symlink escapes/],
    ['escaping plugin', f => fs.symlinkSync('/bin/true', path.join(f.plugins, 'libgstoutside.so')), /symlink escapes/],
    ['broken plugin', f => fs.symlinkSync('absent', path.join(f.plugins, 'libgstbroken.so')), /broken media symlink/],
    ['empty plugins', f => { fs.rmSync(f.plugins, { recursive: true }); fs.mkdirSync(f.plugins); }, /no ELF files/],
    ['missing scanner', f => fs.rmSync(path.join(f.helpers, 'gst-plugin-scanner')), /gst-plugin-scanner/],
    ['escaping destination', f => {
      fs.mkdirSync(path.join(f.app, 'usr'));
      fs.symlinkSync(f.plugins, path.join(f.app, 'usr/lib'));
    }, /destination escapes/],
  ];
  for (const [name, prepare, error] of cases) {
    const f = mediaFixture();
    try {
      prepare(f);
      const r = run(['--appdir', f.app], { env: f.env });
      assert.notEqual(r.status, 0, name);
      assert.match(r.stderr, error, name);
      assert.ok(!fs.existsSync(f.env.MEDIA_LOG), `resolver executed: ${name}`);
      assert.ok(!fs.existsSync(path.join(f.app, 'apprun-hooks/linuxdeploy-plugin-gstreamer.sh')), name);
    } finally { f.clean(); }
  }
});

test('GStreamer discovers actual system directories through pkg-config before the trust gate', t => {
  const plugins = spawnSync('pkg-config', ['--variable=pluginsdir', 'gstreamer-1.0'], { encoding: 'utf8' });
  const helpers = spawnSync('pkg-config', ['--variable=pluginscannerdir', 'gstreamer-1.0'], { encoding: 'utf8' });
  if (plugins.status !== 0 || helpers.status !== 0 || !fs.existsSync(plugins.stdout.trim()) || !fs.existsSync(helpers.stdout.trim())) {
    t.skip('installed GStreamer pkg-config metadata unavailable');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mourn-media discovery-'));
  try {
    const env = { ...process.env, XDG_CACHE_HOME: dir };
    for (const key of ['GSTREAMER_PLUGINS_DIR', 'GSTREAMER_HELPERS_DIR', 'GSTREAMER_VERSION', 'LINUXDEPLOY_SHA256']) delete env[key];
    const r = run(['--appdir', dir], { env });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /independently reviewed LINUXDEPLOY_SHA256/);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('GStreamer malformed ELF aborts without a completion hook', { skip: !elfTools }, () => {
  const f = mediaFixture();
  try {
    fs.writeFileSync(path.join(f.plugins, 'libgstmalformed.so'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0]));
    const r = run(['--appdir', f.app], { env: f.env });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /incomplete AppDir/);
    assert.ok(!fs.existsSync(path.join(f.app, 'apprun-hooks/linuxdeploy-plugin-gstreamer.sh')));
    assert.doesNotMatch(r.stdout, /runtime hook bundled/);
  } finally { f.clean(); }
});

test('GStreamer dependency errors abort and remove the completion hook', { skip: !elfTools }, () => {
  const f = mediaFixture();
  try {
    fs.mkdirSync(path.join(f.app, 'apprun-hooks'));
    const hook = path.join(f.app, 'apprun-hooks/linuxdeploy-plugin-gstreamer.sh');
    fs.writeFileSync(hook, 'stale success');
    const r = run(['--appdir', f.app], { env: { ...f.env, MEDIA_RESOLVER_FAIL: '1' } });
    assert.equal(r.status, 41, r.stderr);
    assert.match(r.stderr, /incomplete AppDir/);
    assert.ok(!fs.existsSync(hook));
    assert.doesNotMatch(r.stdout, /runtime hook bundled/);
  } finally { f.clean(); }
});

test('GStreamer prunes driver families after dependency deployment, preserving Wayland and XCB', { skip: !elfTools }, () => {
  const f = mediaFixture();
  try {
    fs.appendFileSync(f.apprun, `\nfor sub in usr/lib usr/lib64 lib lib64; do\n mkdir -p -- "$2/$sub/nested"\n for name in libvulkan.so.1 libva.so.2 libva-drm.so.2 libwayland-client.so.0 libxcb-render.so.0; do\n  cp -- "$MEDIA_DEPENDENCY" "$2/$sub/nested/$name"\n done\n ln -s libva.so.2 "$2/$sub/nested/libva.so"\ndone\n`);
    f.refreshManifest();
    const r = run(['--appdir', f.app], { env: f.env });
    assert.equal(r.status, 0, r.stderr);
    for (const sub of ['usr/lib', 'usr/lib64', 'lib', 'lib64']) {
      const names = fs.readdirSync(path.join(f.app, sub, 'nested'));
      assert.deepEqual(names.sort(), ['libwayland-client.so.0', 'libxcb-render.so.0'], sub);
    }
  } finally { f.clean(); }
});

test('trust prerequisite stages the original media helper and binds fresh extraction bytes', { skip: !elfTools }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mourn-pin fixture-'));
  try {
    const c = path.join(dir, 'extractor.c');
    const image = path.join(dir, 'extractor.AppImage');
    const appRun = '#!/bin/sh\nexit 0\n';
    fs.writeFileSync(c, '#include <sys/stat.h>\n#include <stdio.h>\n#include <string.h>\nint main(int n,char**v){if(n!=2||strcmp(v[1],"--appimage-extract"))return 4;mkdir("squashfs-root",0700);FILE*f=fopen("squashfs-root/AppRun","w");if(!f)return 5;fputs("#!/bin/sh\\nexit 0\\n",f);fclose(f);chmod("squashfs-root/AppRun",0700);return 0;}\n');
    command('cc', [c, '-o', image]);
    const digest = crypto.createHash('sha256').update(fs.readFileSync(image)).digest('hex');
    const cache = path.join(dir, 'cache');
    const r = spawnSync(bash, [script], { cwd: root, encoding: 'utf8', timeout: 20000,
      env: { ...process.env, XDG_CACHE_HOME: cache, LINUXDEPLOY_SHA256: digest, LINUXDEPLOY_APPIMAGE: image } });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.readFileSync(path.join(cache, 'tauri/linuxdeploy-plugin-gstreamer.sh'), 'utf8') === fs.readFileSync(mediaScript, 'utf8'), 'cache must stage original helper, not the former implementation');
    const hash = crypto.createHash('sha256').update(appRun).digest('hex');
    assert.equal(fs.readFileSync(path.join(cache, 'tauri/linuxdeploy-stable/extracted.sha256'), 'utf8'), `${hash}  ./AppRun\n`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('linuxdeploy helper is valid bash', () => {
  const result = spawnSync(bash, ['-n', script], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});

test('linuxdeploy refuses absent/malformed trust input before any download or execution', () => {
  for (const digest of ['', 'abc', 'g'.repeat(64)]) {
    const result = spawnSync(bash, [script], { cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, LINUXDEPLOY_SHA256: digest, LINUXDEPLOY_APPIMAGE: '/must/not/be/read' } });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /independently reviewed LINUXDEPLOY_SHA256 is required/);
  }
});

test('wrong-digest and non-ELF local inputs never execute or reuse an extracted tree', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mourn-linuxdeploy-test-'));
  try {
    const input = path.join(dir, 'input.AppImage');
    const cache = path.join(dir, 'cache');
    const stable = path.join(cache, 'tauri/linuxdeploy-stable');

    fs.mkdirSync(path.join(stable, 'squashfs-root'), { recursive: true });
    fs.writeFileSync(path.join(stable, 'squashfs-root/AppRun'), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
    const bytes = Buffer.from('#!/bin/sh\nexit 98\n');
    fs.writeFileSync(input, bytes, { mode: 0o755 });
    const expected = crypto.createHash('sha256').update(bytes).digest('hex');
    for (const digest of ['0'.repeat(64), expected]) {
      const result = spawnSync(bash, [script], { cwd: root, encoding: 'utf8', timeout: 10000,
        env: { ...process.env, XDG_CACHE_HOME: cache, LINUXDEPLOY_SHA256: digest, LINUXDEPLOY_APPIMAGE: input } });
      assert.equal(result.status, 3, result.stderr);
      assert.match(result.stderr, digest === expected ? /not ELF/ : /SHA-256 mismatch/);

      assert.equal(fs.readFileSync(path.join(stable, 'squashfs-root/AppRun'), 'utf8'), '#!/bin/sh\nexit 99\n');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
});
