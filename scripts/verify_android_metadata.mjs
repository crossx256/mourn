import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseIdentity } from './release_safety.mjs';

export function verifyAndroidMetadata(badging, tag) {
  const identity = releaseIdentity(tag);
  const line = badging.split(/\r?\n/).find(line => line.startsWith('package: '));
  const field = name => line?.match(new RegExp(`(?:^| )${name}='([^']*)'`))?.[1];
  if (field('name') !== 'bio.mourn.mobile' || field('versionName') !== identity.version ||
      !/^[1-9]\d*$/.test(field('versionCode') || '') || Number(field('versionCode')) > 2100000000) {
    throw new Error('APK application ID or version metadata differs from the reviewed release');
  }
  return identity;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const identity = verifyAndroidMetadata(fs.readFileSync(0, 'utf8'), process.env.RELEASE_TAG);
  console.log('APK application ID and version match ' + identity.tag);
}
