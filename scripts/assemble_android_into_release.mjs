// Fold the signed Android APK into the desktop release draft.
//
// The APK is built by a separate job (it needs a JDK, the Android SDK and the
// release keystore, none of which belong in the desktop matrix). This script is
// the hand-off: it refuses an APK that is not the file the Android job produced
// for this exact tag, then appends it to the validated draft and regenerates the
// checksum manifest the publish job verifies against.
//
// The updater manifest is deliberately NOT touched: Android has no Tauri
// updater target, and adding one would make the desktop updater advertise an
// APK it cannot install.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { releaseContext, walk } from './release_safety.mjs';

const context = releaseContext();
const draft = 'artifacts/draft-release';
const apkDir = 'artifacts/android';
const expectedName = `Mourn-mobile-${context.version}.apk`;
const manifestName = 'SHA256SUMS';

if (!fs.existsSync(draft)) throw new Error('No validated desktop draft to extend');

const apks = fs.readdirSync(apkDir).filter((name) => name.endsWith('.apk'));
if (apks.length !== 1) throw new Error(`Expected exactly one APK, found ${apks.length}`);
if (apks[0] !== expectedName) {
  throw new Error(`APK is named ${apks[0]}, expected ${expectedName}`);
}

const apk = path.join(apkDir, apks[0]);
const size = fs.statSync(apk).size;
// A signed release APK of this app is tens of MB; anything tiny is a stub.
if (size < 1_000_000) throw new Error(`APK is only ${size} bytes — refusing to publish it`);
if (fs.existsSync(path.join(draft, expectedName))) {
  throw new Error(`Draft already contains ${expectedName}`);
}

fs.copyFileSync(apk, path.join(draft, expectedName), fs.constants.COPYFILE_EXCL);

// Regenerate the combined manifest over every asset that will be published,
// excluding any earlier manifest/index files.
const manifestFile = path.join(draft, manifestName);
const assets = walk(draft).filter((file) => {
  const name = path.basename(file);
  return name !== manifestName && !/^SHA256SUMS-|^release-index-/.test(name);
});
const lines = assets
  .map((file) => `${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${path.basename(file)}`)
  .sort();
fs.rmSync(manifestFile, { force: true });
fs.writeFileSync(manifestFile, lines.join('\n') + '\n');

console.log(`Added ${expectedName} (${size} bytes) and rewrote ${manifestName}`);
console.log(`Published assets: ${assets.length}`);
