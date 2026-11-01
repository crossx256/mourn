#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { command, releaseIdentity } from './release_safety.mjs';

export function verifyVersions(root, tag) {
  const identity = releaseIdentity(tag);
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const cargo = read('src-tauri/Cargo.toml').match(/^\[package\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  const versions = [
    ['package.json', JSON.parse(read('package.json')).version],
    ['src-tauri/tauri.conf.json', JSON.parse(read('src-tauri/tauri.conf.json')).version],
    ['src-tauri/Cargo.toml', cargo?.match(/^version\s*=\s*"([^"]+)"/m)?.[1]],
    ['src-capacitor/package.json', JSON.parse(read('src-capacitor/package.json')).version],
  ];
  for (const [file, version] of versions) {
    if (version !== identity.version) throw new Error(`${file} version ${version || '<missing>'} does not match ${identity.version}`);
  }
  // Both Bun lockfiles are required. Frozen installs/audits validate their
  // dependency graphs; Bun does not necessarily record a workspace version.
  for (const file of ['bun.lock', 'src-capacitor/bun.lock']) {
    if (!read(file).includes('"workspaces"')) throw new Error(`Missing Bun workspace lock: ${file}`);
  }
  return identity;
}

export function verifyCheckout(root, tag, expectedCommit) {
  const identity = verifyVersions(root, tag);
  const commit = command('git', ['--no-pager', '--no-optional-locks', 'rev-parse', '--verify', 'HEAD^{commit}'], { cwd: root });
  const tagged = command('git', ['--no-pager', '--no-optional-locks', 'rev-parse', '--verify', `refs/tags/${identity.tag}^{commit}`], { cwd: root });
  if (!/^[a-f0-9]{40}$/.test(commit) || commit !== tagged || (expectedCommit && expectedCommit !== commit)) throw new Error('Checkout is not the exact release tag commit');
  return { ...identity, commit };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const identity = verifyCheckout(process.cwd(), process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME, process.env.RELEASE_COMMIT);
  const { commit } = identity;
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=${identity.tag}\nversion=${identity.version}\nprerelease=${identity.prerelease}\ncommit=${commit}\n`);
  console.log(`Release versions and tag commit match: ${identity.tag} (${commit})`);
}
