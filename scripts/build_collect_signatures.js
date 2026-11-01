#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { command, collectArtifacts, releaseContext, targetInfo } from './release_safety.mjs';

const context = releaseContext();
targetInfo(process.env.RELEASE_TARGET);
if (!process.env.CARGO_TARGET_DIR || !process.env.BUNDLE_DIR) throw new Error('Explicit fresh CARGO_TARGET_DIR and BUNDLE_DIR required');
const expected = path.resolve(process.env.CARGO_TARGET_DIR, process.env.RELEASE_TARGET, 'release', 'bundle');
if (path.resolve(process.env.BUNDLE_DIR) !== expected || fs.existsSync(expected)) throw new Error('Bundle output must be absent and match the explicit Cargo target');
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error('Tauri updater signing key required');
const bundles = process.env.RELEASE_TARGET.includes('windows') ? 'msi,nsis' : 'appimage,deb';
command('bun', ['run', 'tauri', 'build', '--target', process.env.RELEASE_TARGET, '--bundles', bundles], { stdio: 'inherit', timeout: 3600000 });
// Tauri creates updater signatures, but distribution-only packages (notably
// Debian packages) also need their own adjacent signature; never reuse one.
for (const file of collectArtifacts(expected, context, process.env.RELEASE_TARGET, false)) {
  if (!fs.existsSync(`${file}.sig`)) command('bun', ['run', 'tauri', 'signer', 'sign', file], { stdio: 'inherit' });
}
collectArtifacts(expected, context, process.env.RELEASE_TARGET);
console.log('All current-target release artifacts are signature-verified against the reviewed updater key');
