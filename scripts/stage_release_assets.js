#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { artifactInfo, assetUrl, collectArtifacts, releaseContext, signatureFor, stageAtomic, targetInfo } from './release_safety.mjs';

const context = releaseContext();
const { platform } = targetInfo(process.env.RELEASE_TARGET);
if (!process.env.BUNDLE_DIR) throw new Error('Explicit fresh BUNDLE_DIR required');
const artifacts = collectArtifacts(path.resolve(process.env.BUNDLE_DIR), context, process.env.RELEASE_TARGET);
const manifestFile = `artifacts/updater-manifest-${platform}.json`;
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const expectedPlatforms = {};
for (const file of artifacts) {
  const { kind } = artifactInfo(file, context.version);
  const key = kind === 'deb' ? `${platform}-deb` : ['nsis', 'appimage'].includes(kind) ? platform : null;
  if (key) expectedPlatforms[key] = { url: assetUrl(context, path.basename(file)), signature: signatureFor(file) };
}
if (manifest.version !== context.version || JSON.stringify(manifest.platforms) !== JSON.stringify(expectedPlatforms)) throw new Error('Updater manifest does not match this artifact set');
stageAtomic(`artifacts/release-${platform}`, [...artifacts.flatMap(file => [file, `${file}.sig`]), manifestFile], context, platform);
console.log(`Validated and atomically staged ${platform}`);
