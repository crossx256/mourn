#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { artifactInfo, assetUrl, collectArtifacts, releaseContext, signatureFor, targetInfo } from './release_safety.mjs';

const context = releaseContext();
const { platform } = targetInfo(process.env.RELEASE_TARGET);
if (!process.env.BUNDLE_DIR) throw new Error('Explicit fresh BUNDLE_DIR required');
const artifacts = collectArtifacts(path.resolve(process.env.BUNDLE_DIR), context, process.env.RELEASE_TARGET);
const platforms = {};
for (const file of artifacts) {
  const { kind } = artifactInfo(file, context.version);
  // Preserve NSIS-first updates (MSI can require elevation) and the separate
  // Debian update path. MSI is distributed, never selected as the updater.
  const key = kind === 'deb' ? `${platform}-deb` : ['nsis', 'appimage'].includes(kind) ? platform : null;
  if (key) platforms[key] = { url: assetUrl(context, path.basename(file)), signature: signatureFor(file) };
}
const manifest = { version: context.version, notes: process.env.RELEASE_NOTES || `mourn desktop ${context.version}`, pub_date: new Date().toISOString(), platforms };
fs.mkdirSync('artifacts', { recursive: true });
fs.writeFileSync(`artifacts/updater-manifest-${platform}.json`, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(`Generated updater manifest for ${platform}`);
