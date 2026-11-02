import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeTauriPublicKey, verifyTauriSignature } from '../scripts/minisign_verify.mjs';
import { verifyCheckout, verifyVersions } from '../scripts/verify_release_version.js';
import { verifyAndroidMetadata } from '../scripts/verify_android_metadata.mjs';
import { artifactInfo, assertUniqueNames, collectArtifacts, walk, releaseIdentity, releaseContext, stageAtomic, verifyShard } from '../scripts/release_safety.mjs';

test('release tags are strict SemVer, not shell/path input', () => {
  assert.equal(releaseIdentity('v1.4.8-rc.1').prerelease, true);
  assert.equal(releaseIdentity('v1.4.8').prerelease, false);
  for (const value of ['1.4.8', 'v01.4.8', 'v1.4', 'v1.4.8/evil', 'v1.4.8-01', 'v1.4.8\n']) assert.throws(() => releaseIdentity(value));
});
test('stale packages, ambiguous architecture and colliding assets fail closed', () => {
  assert.deepEqual(artifactInfo('mourn_1.4.8_amd64.deb', '1.4.8'), { platform: 'linux-x86_64', kind: 'deb' });
  for (const file of ['mourn_1.4.7_amd64.deb', 'mourn_1.4.8_arm64.deb', '../evil.deb']) assert.throws(() => artifactInfo(file, '1.4.8'));
  assert.throws(() => assertUniqueNames(['a/X.sig', 'b/x.sig']));
  assert.throws(() => releaseContext({ RELEASE_TAG: 'v1.4.8' }));
});
test('staging is exclusive and shards detect tampering', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mourn-release-test-'));
  try {
    const context = { tag: 'v1.4.8', version: '1.4.8', commit: 'a'.repeat(40), repository: 'example/client', prerelease: false };
    const source = path.join(root, 'asset.txt');
    const output = path.join(root, 'shard');
    fs.writeFileSync(source, 'synthetic fixture');
    stageAtomic(output, [source], context, 'linux-x86_64');
    assert.equal(verifyShard(output, context, 'linux-x86_64').length, 3);
    assert.throws(() => stageAtomic(output, [source], context, 'linux-x86_64'));
    fs.writeFileSync(path.join(output, 'asset.txt'), 'tampered');
    assert.throws(() => verifyShard(output, context, 'linux-x86_64'));
  } finally { fs.rmSync(root, { force: true, recursive: true }); }
});

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envelope = text => Buffer.from(text, 'utf8').toString('base64');

// Ephemeral unit-test keys only: no release key or production signing process.
function testKey(keyId = Buffer.alloc(8, 7)) {
  const pair = crypto.generateKeyPairSync('ed25519');
  const raw = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const packet = Buffer.concat([Buffer.from('Ed'), keyId, raw]);
  return { ...pair, keyId, encoded: envelope('untrusted comment: synthetic test key\n' + packet.toString('base64') + '\n') };
}

function testSignature(payload, key, algorithm = 'ED') {
  const message = algorithm === 'ED' ? crypto.createHash('blake2b512').update(payload).digest() : payload;
  const primary = crypto.sign(null, message, key.privateKey);
  const packet = Buffer.concat([Buffer.from(algorithm), key.keyId, primary]);
  const comment = 'timestamp:1\tfile:synthetic-fixture';
  const global = crypto.sign(null, Buffer.concat([primary, Buffer.from(comment)]), key.privateKey);
  return envelope('untrusted comment: synthetic test signature\n' + packet.toString('base64') + '\ntrusted comment: ' + comment + '\n' + global.toString('base64') + '\n');
}

function config(root, key) {
  fs.mkdirSync(path.join(root, 'src-tauri'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: '1.4.8', plugins: { updater: { pubkey: key.encoded } } }));
}

function runScript(script, cwd, env = {}) {
  return spawnSync(process.execPath, [path.join(repository, 'scripts', script)], {
    cwd, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, RELEASE_TAG: 'v1.4.8', RELEASE_COMMIT: 'a'.repeat(40), GITHUB_REPOSITORY: 'example/client',
      PUBKEY: '', PUBKEY_FILE: '', TAURI_UPDATER_PUBLIC_KEY: '', TAURI_SIGNING_PRIVATE_KEY: '', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '', ...env },
  });
}

const context = { tag: 'v1.4.8', version: '1.4.8', commit: 'a'.repeat(40), repository: 'example/client', prerelease: false };

function signedFile(dir, name, body, key) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  fs.writeFileSync(file + '.sig', testSignature(body, key));
  return file;
}

test('Tauri outer envelopes verify independent Minisign Ed and ED reference signatures', () => {
  // Public test vectors from minisign-verify 0.2.5; no private key is needed.
  const publicKey = envelope('untrusted comment: reference key\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3\n');
  const legacy = envelope('untrusted comment: signature from minisign secret key\nRWQf6LRCGA9i59SLOFxz6NxvASXDJeRtuZykwQepbDEGt87ig1BNpWaVWuNrm73YiIiJbq71Wi+dP9eKL8OC351vwIasSSbXxwA=\ntrusted comment: timestamp:1555779966\tfile:test\nQtKMXWyYcwdpZAlPF7tE2ENJkRd1ujvKjlj1m9RtHTBnZPa5WKU5uWRs5GoP5M/VqE81QFuMKI5k/SfNQUaOAA==\n');
  const hashed = envelope('untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1556193335\tfile:test\ny/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==\n');
  assert.equal(verifyTauriSignature(Buffer.from('test'), legacy, publicKey), true);
  assert.equal(verifyTauriSignature(Buffer.from('test'), hashed, publicKey), true);
  assert.throws(() => verifyTauriSignature(Buffer.from('Test'), hashed, publicKey), /verification failed/);
  assert.throws(() => decodeTauriPublicKey('RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3'));
});

test('verification rejects another key, payload, key ID, trusted comment and malformed envelopes', () => {
  const key = testKey();
  const another = testKey(key.keyId); // Same ID proves that cryptographic key verification runs.
  const payload = Buffer.from('synthetic package');
  const signature = testSignature(payload, key);
  assert.equal(verifyTauriSignature(payload, signature, key.encoded), true);
  assert.throws(() => verifyTauriSignature(payload, signature, another.encoded), /verification failed/);
  assert.throws(() => verifyTauriSignature(Buffer.from('another package'), signature, key.encoded));
  assert.throws(() => verifyTauriSignature(payload, signature, testKey(Buffer.alloc(8, 8)).encoded), /key ID/);
  const text = Buffer.from(signature, 'base64').toString('utf8');
  assert.equal(verifyTauriSignature(payload, envelope(text.trimEnd()), key.encoded), true);
  assert.equal(verifyTauriSignature(payload, envelope(text.replace(/\n/g, '\r\n')), key.encoded), true);
  assert.throws(() => verifyTauriSignature(payload, envelope(text.replace('timestamp:1', 'timestamp:2')), key.encoded));
  for (const bad of ['', 'not base64!', signature.slice(0, -16), text, envelope('one line'), envelope(text + 'extra\n'), Buffer.from([255]).toString('base64')]) {
    assert.throws(() => verifyTauriSignature(payload, bad, key.encoded));
  }
  const unsupported = text.split('\n');
  const packet = Buffer.from(unsupported[1], 'base64');
  packet[0] = 0xc5;
  unsupported[1] = packet.toString('base64');
  assert.throws(() => verifyTauriSignature(payload, envelope(unsupported.join('\n')), key.encoded), /Invalid Minisign/);
});

test('Linux artifact collection excludes Tauri AppDir but still rejects symlinked packages', { skip: process.platform !== 'linux' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mourn-appdir-test-'));
  try {
    const bundle = path.join(root, 'bundle');
    const appdir = path.join(bundle, 'appimage', 'mourn.AppDir');
    fs.mkdirSync(appdir, { recursive: true });
    fs.writeFileSync(path.join(appdir, 'icon.png'), 'intermediate fixture');
    fs.symlinkSync('icon.png', path.join(appdir, '.DirIcon'));
    fs.writeFileSync(path.join(appdir, 'intermediate.exe'), 'not a release artifact');
    const image = path.join(bundle, 'appimage', 'mourn_1.4.8_amd64.AppImage');
    const elf = Buffer.alloc(20);
    Buffer.from([127, 69, 76, 70, 2, 1]).copy(elf);
    elf.writeUInt16LE(62, 18);
    fs.writeFileSync(image, elf);
    const debSource = path.join(root, 'deb-source');
    fs.mkdirSync(path.join(debSource, 'DEBIAN'), { recursive: true });
    fs.writeFileSync(path.join(debSource, 'DEBIAN', 'control'),
      'Package: mourn-fixture\nVersion: 1.4.8\nArchitecture: amd64\nMaintainer: Fixture <fixture@example.invalid>\nDescription: release regression fixture\n');
    fs.mkdirSync(path.join(bundle, 'deb'));
    const deb = path.join(bundle, 'deb', 'mourn_1.4.8_amd64.deb');
    const packed = spawnSync('dpkg-deb', ['--build', debSource, deb], { encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr);
    const collect = () => collectArtifacts(bundle, context, 'x86_64-unknown-linux-gnu', false);
    assert.deepEqual(collect(), [image, deb]);
    assert.throws(() => walk(bundle), /Symlink forbidden/, 'staging and shard walks must remain strict');
    const key = testKey();
    config(root, key);
    signedFile(path.dirname(image), path.basename(image), fs.readFileSync(image), key);
    signedFile(path.dirname(deb), path.basename(deb), fs.readFileSync(deb), key);
    const env = { RELEASE_TARGET: 'x86_64-unknown-linux-gnu', BUNDLE_DIR: bundle };
    for (const script of ['generate_updater_manifest.js', 'stage_release_assets.js']) {
      const staged = runScript(script, root, env);
      assert.equal(staged.status, 0, staged.stderr);
    }
    assert.equal(fs.existsSync(path.join(root, 'artifacts/release-linux-x86_64', 'mourn.AppDir')), false);
    fs.renameSync(image, path.join(root, 'external.AppImage'));
    fs.symlinkSync(path.join(root, 'external.AppImage'), image);
    assert.throws(collect, /Symlink forbidden/, 'published package symlinks must still be rejected');
    fs.rmSync(image);
    fs.renameSync(path.join(root, 'external.AppImage'), image);
    fs.renameSync(appdir, path.join(root, 'external.AppDir'));
    fs.symlinkSync(path.join(root, 'external.AppDir'), appdir, 'dir');
    assert.throws(collect, /Symlink forbidden/, 'the excluded AppDir itself must not be a symlink');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release staging verifies all packages, including MSI, before exposing output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mourn-signature-stage-test-'));
  try {
    const key = testKey();
    config(root, key);
    const bundle = path.join(root, 'bundle');
    const exe = Buffer.alloc(256);
    exe.write('MZ'); exe.writeUInt32LE(128, 60); exe.writeUInt32LE(0x4550, 128); exe.writeUInt16LE(0x14c, 132);
    signedFile(bundle, 'mourn_1.4.8_x64-setup.exe', exe, key);
    const msiBytes = Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.from('synthetic MSI fixture')]);
    const msi = signedFile(bundle, 'mourn_1.4.8_x64_en-US.msi', msiBytes, key);
    const env = { RELEASE_TARGET: 'x86_64-pc-windows-msvc', BUNDLE_DIR: bundle };
    const generated = runScript('generate_updater_manifest.js', root, env);
    assert.equal(generated.status, 0, generated.stderr);
    const output = path.join(root, 'artifacts/release-windows-x86_64');
    for (const bad of [testSignature(msiBytes, testKey(key.keyId)), testSignature(Buffer.from('other payload'), key), 'malformed']) {
      fs.writeFileSync(msi + '.sig', bad);
      assert.notEqual(runScript('stage_release_assets.js', root, env).status, 0);
      assert.equal(fs.existsSync(output), false);
    }
    fs.writeFileSync(msi + '.sig', testSignature(msiBytes, key));
    const staged = runScript('stage_release_assets.js', root, env);
    assert.equal(staged.status, 0, staged.stderr);
    assert.ok(fs.existsSync(path.join(output, path.basename(msi))));
    fs.writeFileSync(msi + '.sig', 'malformed');
    assert.throws(() => stageAtomic(path.join(root, 'must-not-exist'), [msi, msi + '.sig'], context, 'windows-x86_64', key.encoded));
    assert.equal(fs.existsSync(path.join(root, 'must-not-exist')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('shard assembly rejects a self-consistent index with signatures from another key', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mourn-assembly-test-'));
  try {
    const trusted = testKey();
    const foreign = testKey(trusted.keyId);
    config(root, trusted);
    const source = path.join(root, 'input');
    const output = path.join(root, 'artifacts/shards/release-linux-x86_64');
    const deb = signedFile(source, 'mourn_1.4.8_amd64.deb', Buffer.from('synthetic deb'), foreign);
    const image = signedFile(source, 'mourn_1.4.8_amd64.AppImage', Buffer.from('synthetic image'), foreign);
    const manifestFile = path.join(source, 'updater-manifest-linux-x86_64.json');
    const entry = file => ({ url: 'https://github.com/example/client/releases/download/v1.4.8/' + path.basename(file), signature: fs.readFileSync(file + '.sig', 'utf8') });
    fs.writeFileSync(manifestFile, JSON.stringify({ version: '1.4.8', platforms: { 'linux-x86_64': entry(image), 'linux-x86_64-deb': entry(deb) } }));
    stageAtomic(output, [deb, deb + '.sig', image, image + '.sig', manifestFile], context, 'linux-x86_64', foreign.encoded);
    // The shard hashes are internally valid, but the independently selected trust key rejects it.
    assert.throws(() => verifyShard(output, context, 'linux-x86_64', trusted.encoded), /verification failed/);
    assert.ok(verifyShard(output, context, 'linux-x86_64', foreign.encoded).length > 0);
    const windowsInput = path.join(root, 'windows-input');
    const installer = signedFile(windowsInput, 'mourn_1.4.8_x64-setup.exe', Buffer.from('synthetic installer'), trusted);
    const msi = signedFile(windowsInput, 'mourn_1.4.8_x64_en-US.msi', Buffer.from('synthetic MSI'), trusted);
    const windowsManifest = path.join(windowsInput, 'updater-manifest-windows-x86_64.json');
    fs.writeFileSync(windowsManifest, JSON.stringify({ version: '1.4.8', platforms: { 'windows-x86_64': entry(installer) } }));
    stageAtomic(path.join(root, 'artifacts/shards/release-windows-x86_64'), [installer, installer + '.sig', msi, msi + '.sig', windowsManifest], context, 'windows-x86_64', trusted.encoded);
    const refused = runScript('assemble_release.mjs', root);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /verification failed/);
    assert.equal(fs.existsSync(path.join(root, 'artifacts/draft-release')), false);
    fs.rmSync(output, { recursive: true });
    signedFile(source, path.basename(deb), fs.readFileSync(deb), trusted);
    signedFile(source, path.basename(image), fs.readFileSync(image), trusted);
    fs.writeFileSync(manifestFile, JSON.stringify({ version: '1.4.8', platforms: { 'linux-x86_64': entry(image), 'linux-x86_64-deb': entry(deb) } }));
    stageAtomic(output, [deb, deb + '.sig', image, image + '.sig', manifestFile], context, 'linux-x86_64', trusted.encoded);
    const accepted = runScript('assemble_release.mjs', root);
    assert.equal(accepted.status, 0, accepted.stderr);
    const merged = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/draft-release/updater-manifest.json'), 'utf8'));
    assert.deepEqual(Object.keys(merged.platforms).sort(), ['linux-x86_64', 'linux-x86_64-deb', 'windows-x86_64']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('key injection rejects a secret-only trust-key replacement without modifying configuration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mourn-key-injection-test-'));
  try {
    const key = testKey();
    config(root, key);
    const file = path.join(root, 'src-tauri/tauri.conf.json');
    const before = fs.readFileSync(file);
    assert.notEqual(runScript('inject_pubkey.js', root, { TAURI_UPDATER_PUBLIC_KEY: testKey().encoded }).status, 0);
    assert.deepEqual(fs.readFileSync(file), before);
    assert.equal(runScript('inject_pubkey.js', root, { TAURI_UPDATER_PUBLIC_KEY: key.encoded }).status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('version gate rejects arbitrary refs and mismatched component versions before Git or signing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mourn-version-test-'));
  try {
    config(root, testKey());
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.4.8' }));
    fs.writeFileSync(path.join(root, 'src-tauri/Cargo.toml'), '[package]\nname = "fixture"\nversion = "1.4.8"\n');
    fs.mkdirSync(path.join(root, 'src-capacitor'));
    fs.writeFileSync(path.join(root, 'src-capacitor/package.json'), JSON.stringify({ version: '1.4.8' }));
    for (const name of ['bun.lock', 'src-capacitor/bun.lock']) fs.writeFileSync(path.join(root, name), '{"workspaces": {}}');
    assert.equal(verifyVersions(root, 'v1.4.8').version, '1.4.8');
    for (const tag of ['main', 'refs/heads/main', 'v1.4.8/../main', 'v1.4.8\n']) assert.throws(() => verifyVersions(root, tag), /strict SemVer/);
    fs.writeFileSync(path.join(root, 'src-capacitor/package.json'), JSON.stringify({ version: '1.4.7' }));
    assert.throws(() => verifyVersions(root, 'v1.4.8'), /does not match/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('exact-tag gate checks real detached Git commits and refuses a tag pointing elsewhere', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mourn-tag-fixture-'));
  try {
    config(root, testKey());
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.4.8' }));
    fs.writeFileSync(path.join(root, 'src-tauri/Cargo.toml'), '[package]\nversion = "1.4.8"\n');
    fs.mkdirSync(path.join(root, 'src-capacitor'));
    fs.writeFileSync(path.join(root, 'src-capacitor/package.json'), JSON.stringify({ version: '1.4.8' }));
    for (const name of ['bun.lock', 'src-capacitor/bun.lock']) fs.writeFileSync(path.join(root, name), '{"workspaces": {}}');
    const git = (args, input) => {
      const result = spawnSync('git', ['--no-pager', '--no-optional-locks', ...args], { cwd: root, input, encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git(['init', '--quiet', '--object-format=sha1']);
    const tree = git(['hash-object', '-w', '-t', 'tree', '--stdin'], '');
    const commitObject = message => git(['hash-object', '-w', '-t', 'commit', '--stdin'], `tree ${tree}\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\n${message}\n`);
    const selected = commitObject('selected');
    const other = commitObject('other');
    // Only disposable object/ref fixtures; no git commit/tag or workspace staging.
    fs.mkdirSync(path.join(root, '.git/refs/tags'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git/refs/tags/v1.4.8'), selected + '\n');
    fs.writeFileSync(path.join(root, '.git/HEAD'), selected + '\n');
    assert.equal(verifyCheckout(root, 'v1.4.8', selected).commit, selected);
    assert.throws(() => verifyCheckout(root, 'v1.4.8', other), /exact release tag commit/);
    fs.writeFileSync(path.join(root, '.git/HEAD'), other + '\n');
    assert.throws(() => verifyCheckout(root, 'v1.4.8'), /exact release tag commit/);
    assert.throws(() => verifyCheckout(root, 'v1.4.9'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('APK metadata is checked, not inferred from the uploaded filename', () => {
  const good = "package: name='bio.mourn.mobile' versionCode='1040008' versionName='1.4.8' platformBuildVersionName='16'\n";
  assert.equal(verifyAndroidMetadata(good, 'v1.4.8').version, '1.4.8');
  for (const bad of [good.replace('1.4.8', '1.4.7'), good.replace('bio.mourn.mobile', 'other.app'), good.replace('1040008', '0'), 'not package metadata']) {
    assert.throws(() => verifyAndroidMetadata(bad, 'v1.4.8'));
  }
});

test('manual workflows gate exact tags before secrets and only publish when asked', () => {
  for (const name of ['android.yml', 'release.yml']) {
    const workflow = fs.readFileSync(path.join(repository, '.github/workflows', name), 'utf8');
    assert.match(workflow, /ref: refs\/tags\/\$\{\{ inputs\.tag \}\}/);
    const gate = workflow.indexOf('run: node scripts/verify_release_version.js');
    assert.ok(gate > 0 && gate < workflow.indexOf('secrets.'), name);
    // Tag pushes and fork-reachable triggers never reach secrets.
    assert.doesNotMatch(workflow, /^\s+(?:push|pull_request_target):/m, name);
    // Publishing writes are confined to a single, explicitly requested job.
    const writeIdx = workflow.indexOf('contents: write');
    if (writeIdx !== -1) {
      assert.equal(name, 'release.yml', 'only the desktop release workflow may publish');
      const jobStart = workflow.lastIndexOf('\n  publish:', writeIdx);
      assert.ok(jobStart > 0 && jobStart < writeIdx, 'contents: write must live inside the publish job');
      assert.ok(
        jobStart < workflow.indexOf("if: github.event_name == 'workflow_dispatch' && inputs.publish == 'true'"),
        'the publish job must be gated on the explicit publish input',
      );
      assert.equal(workflow.indexOf('contents: write', writeIdx + 1), -1, 'exactly one write scope');
      assert.match(workflow, /uses: softprops\/action-gh-release@[a-f0-9]{40}/);
      assert.match(workflow, /fail_on_unmatched_files: true/);
    }
    assert.doesNotMatch(workflow, /\brun:.*(?:gh release|ssh |scp |rsync)/m);
  }
});
