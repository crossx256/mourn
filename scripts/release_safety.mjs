import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { decodeTauriPublicKey, verifyTauriSignature } from './minisign_verify.mjs';

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
export function releaseIdentity(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v') || !semver.test(tag.slice(1))) {
    throw new Error('Release tag must be v followed by strict SemVer');
  }
  return { tag, version: tag.slice(1), prerelease: Boolean(semver.exec(tag.slice(1))[4]) };
}

export function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: 'utf8', shell: false, timeout: 120000, ...options });
  if (result.error || result.status !== 0) throw new Error(`${executable} failed: ${result.error?.message || result.stderr || result.status}`);
  return result.stdout?.trim() || '';
}

export function regularFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) throw new Error(`Expected nonempty regular file: ${file}`);
  return file;
}

export function walk(dir, skipDirectory = () => false) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink forbidden: ${file}`);
    if (entry.isDirectory()) {
      if (!skipDirectory(file)) result.push(...walk(file, skipDirectory));
    } else result.push(regularFile(file));
  }
  return result;
}

export const targets = {
  'x86_64-pc-windows-msvc': { platform: 'windows-x86_64', kinds: ['nsis', 'msi'] },
  'x86_64-unknown-linux-gnu': { platform: 'linux-x86_64', kinds: ['appimage', 'deb'] },
};
export function targetInfo(target) {
  if (!Object.hasOwn(targets, target)) throw new Error(`Unsupported explicit release target: ${target}`);
  return targets[target];
}

// Require Tauri's version/architecture naming; corroborate executable and Debian
// metadata below. RUNNER_OS is not package identity. Other targets need review.
export function artifactInfo(file, version) {
  const name = path.basename(file);
  if (!/^[A-Za-z0-9][A-Za-z0-9._+\-]*$/.test(name)) throw new Error(`Unsafe asset name: ${name}`);
  const prefix = `mourn_${version}_`;
  if (!name.startsWith(prefix)) throw new Error(`Stale or unexpected artifact name: ${name}`);
  const suffix = name.slice(prefix.length);
  if (suffix === 'x64-setup.exe') return { platform: 'windows-x86_64', kind: 'nsis' };
  if (suffix === 'x64_en-US.msi') return { platform: 'windows-x86_64', kind: 'msi' };
  if (suffix === 'amd64.deb') return { platform: 'linux-x86_64', kind: 'deb' };
  if (suffix === 'amd64.AppImage') return { platform: 'linux-x86_64', kind: 'appimage' };
  throw new Error(`Unsupported package architecture/name: ${name}`);
}

export function verifyPackage(file, info, version) {
  if (info.kind === 'deb') {
    const arch = command('dpkg-deb', ['--field', file, 'Architecture']);
    const actualVersion = command('dpkg-deb', ['--field', file, 'Version']);
    if (arch !== 'amd64' || actualVersion !== version) throw new Error('Debian package metadata disagrees with release identity');
  } else if (info.kind === 'appimage') {
    const bytes = fs.readFileSync(file);
    if (bytes.length < 20 || !bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) || bytes[4] !== 2 || bytes[5] !== 1 || bytes.readUInt16LE(18) !== 62) {
      throw new Error('AppImage is not an ELF64 x86_64 executable');
    }
  } else if (info.kind === 'nsis') {
    const bytes = fs.readFileSync(file);
    if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('NSIS installer is not PE');
    const pe = bytes.readUInt32LE(60);
    // NSIS launchers may be 32-bit even for a 64-bit application; the explicit
    // Rust target and package suffix identify the payload, not the launcher.
    if (pe + 6 > bytes.length || bytes.readUInt32LE(pe) !== 0x4550 || ![0x14c, 0x8664].includes(bytes.readUInt16LE(pe + 4))) throw new Error('Invalid NSIS PE launcher');
  } else if (info.kind === 'msi') {
    if (!fs.readFileSync(file).subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) throw new Error('MSI is not a compound document');
  }
}

export function assertUniqueNames(files) {
  const seen = new Set();
  for (const file of files) {
    const name = path.basename(file).toLowerCase();
    if (seen.has(name)) throw new Error(`Asset basename collision: ${name}`);
    seen.add(name);
  }
}

export function collectArtifacts(bundleDir, identity, target, requireSignatures = true) {
  const expected = targetInfo(target);
  // Tauri retains the unpacked AppDir next to the final AppImage. Its icon and
  // library symlinks are build intermediates, not assets to stage or sign.
  // Exclude only that exact real directory; walk still rejects a symlink at
  // this path, all package/signature symlinks, and every symlink in a shard.
  const appdir = path.join(bundleDir, 'appimage', 'mourn.AppDir');
  const all = walk(bundleDir, dir => expected.platform === 'linux-x86_64' && dir === appdir);
  const artifacts = all.filter(file => /\.(exe|msi|deb|appimage)$/i.test(file));
  assertUniqueNames(artifacts);
  const kinds = new Set();
  for (const file of artifacts) {
    const info = artifactInfo(file, identity.version);
    if (info.platform !== expected.platform || kinds.has(info.kind)) throw new Error('Wrong platform or multiple artifacts of one kind');
    kinds.add(info.kind);
    verifyPackage(file, info, identity.version);
    if (requireSignatures) signatureFor(file);
  }
  for (const sig of all.filter(file => file.endsWith('.sig'))) {
    if (!artifacts.includes(sig.slice(0, -4))) throw new Error(`Orphan/unexpected signature: ${sig}`);
    signatureFor(sig.slice(0, -4));
  }
  if (expected.kinds.some(kind => !kinds.has(kind))) throw new Error(`Missing required artifacts: ${expected.kinds.join(', ')}`);
  return artifacts;
}

export function releasePublicKey(root = process.cwd()) {
  // Trust the reviewed source configuration, never a key supplied by a shard.
  const config = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const key = config.plugins?.updater?.pubkey;
  decodeTauriPublicKey(key);
  return key;
}

export function signatureFor(file, publicKey = releasePublicKey()) {
  const signature = fs.readFileSync(regularFile(`${file}.sig`), 'utf8').trim();
  verifyTauriSignature(fs.readFileSync(regularFile(file)), signature, publicKey);
  return signature;
}

export function verifySignedAssets(files, publicKey) {
  const artifacts = files.filter(file => /\.(exe|msi|deb|appimage)$/i.test(file));
  for (const file of artifacts) {
    if (!files.includes(`${file}.sig`)) throw new Error('Package signature is not in the staged asset set');
    signatureFor(file, publicKey);
  }
  for (const file of files.filter(file => file.endsWith('.sig'))) {
    if (!artifacts.includes(file.slice(0, -4))) throw new Error('Orphan signature in staged asset set');
  }
}
export function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(regularFile(file))).digest('hex');
}
export function releaseContext(env = process.env) {
  const identity = releaseIdentity(env.RELEASE_TAG || env.GITHUB_REF_NAME);
  if (env.RELEASE_VERSION && env.RELEASE_VERSION.replace(/^v/, '') !== identity.version) throw new Error('Conflicting release version');
  if (!/^[a-f0-9]{40}$/.test(env.RELEASE_COMMIT || '')) throw new Error('Exact RELEASE_COMMIT required');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY || '')) throw new Error('GITHUB_REPOSITORY required');
  return { ...identity, commit: env.RELEASE_COMMIT, repository: env.GITHUB_REPOSITORY };
}
export function assetUrl(context, name) {
  return `https://github.com/${context.repository}/releases/download/${encodeURIComponent(context.tag)}/${encodeURIComponent(name)}`;
}

// Output is exposed only after every file validates. Never replace an earlier
// stage: reruns must use a fresh checkout/output directory.
export function stageAtomic(output, files, context, platform, publicKey) {
  assertUniqueNames(files);
  files.forEach(regularFile);
  verifySignedAssets(files, publicKey);
  if (fs.existsSync(output)) throw new Error(`Stale staging destination exists: ${output}`);
  const parent = path.dirname(output);
  fs.mkdirSync(parent, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(parent, '.release-stage-'));
  try {
    for (const file of files) fs.copyFileSync(file, path.join(temporary, path.basename(file)), fs.constants.COPYFILE_EXCL);
    const copied = walk(temporary);
        verifySignedAssets(copied, publicKey);
        const sums = copied.map(file => `${sha256(file)}  ${path.basename(file)}`).sort().join('\n') + '\n';
    fs.writeFileSync(path.join(temporary, `SHA256SUMS-${platform}.txt`), sums, { flag: 'wx' });
    const assets = walk(temporary).map(file => ({ name: path.basename(file), sha256: sha256(file) }));
    fs.writeFileSync(path.join(temporary, `release-index-${platform}.json`), JSON.stringify({ ...context, platform, assets }, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temporary, output);
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

export function verifyShard(dir, context, platform, publicKey) {
  const indexName = `release-index-${platform}.json`;
  const index = JSON.parse(fs.readFileSync(regularFile(path.join(dir, indexName)), 'utf8'));
  for (const key of ['version', 'tag', 'commit', 'repository', 'prerelease']) {
    if (index[key] !== context[key]) throw new Error(`Shard ${platform} has conflicting ${key}`);
  }
  if (index.platform !== platform || !Array.isArray(index.assets) || index.assets.length === 0) throw new Error('Invalid shard index');
  assertUniqueNames(index.assets.map(asset => asset.name));
  const files = walk(dir);
  if (files.some(file => path.dirname(file) !== dir) || files.length !== index.assets.length + 1) throw new Error('Unexpected shard files');
  for (const asset of index.assets) {
    if (typeof asset.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+\-]*$/.test(asset.name) || asset.name === indexName) throw new Error('Unsafe index asset name');
    if (sha256(path.join(dir, asset.name)) !== asset.sha256) throw new Error(`Shard digest mismatch: ${asset.name}`);
  }
  verifySignedAssets(files, publicKey);
  return files;
}
