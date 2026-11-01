import fs from 'node:fs';
import path from 'node:path';
import { assertUniqueNames, releaseContext, verifyShard, stageAtomic } from './release_safety.mjs';

const context = releaseContext();
const platforms = ['windows-x86_64', 'linux-x86_64'];
const all = [];
const merged = {};
const root = path.resolve('artifacts/shards');
const directories = fs.readdirSync(root).sort();
if (JSON.stringify(directories) !== JSON.stringify(platforms.map(p => 'release-' + p).sort())) throw new Error('Missing or unexpected release shards');
for (const platform of platforms) {
  const dir = path.join(root, 'release-' + platform);
  const files = verifyShard(dir, context, platform);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'updater-manifest-' + platform + '.json'), 'utf8'));
  if (manifest.version !== context.version) throw new Error('Manifest version mismatch');
  const expected = platform === 'linux-x86_64' ? [platform, platform + '-deb'] : [platform];
  if (JSON.stringify(Object.keys(manifest.platforms).sort()) !== JSON.stringify(expected.sort())) throw new Error('Unexpected updater targets');
  for (const [target, entry] of Object.entries(manifest.platforms)) {
    if (Object.hasOwn(merged, target) || typeof entry.signature !== 'string' || !entry.signature.trim()) throw new Error('Ambiguous or unsigned updater target');
    const url = new URL(entry.url);
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/' + context.repository + '/releases/download/' + encodeURIComponent(context.tag) + '/')) throw new Error('Wrong release asset origin');
    const name = decodeURIComponent(url.pathname.split('/').pop());
    if (!files.includes(path.join(dir, name)) || !files.includes(path.join(dir, name + '.sig'))) throw new Error('Manifest does not reference a verified shard asset');
    if (fs.readFileSync(path.join(dir, name + '.sig'), 'utf8').trim() !== entry.signature) throw new Error('Signature mismatch');
    merged[target] = entry;
  }
  all.push(...files);
}
assertUniqueNames(all);
const mergedFile = 'artifacts/updater-manifest.json';
fs.writeFileSync(mergedFile, JSON.stringify({ version: context.version, notes: 'mourn ' + context.version, platforms: merged }, null, 2) + '\n', { flag: 'wx' });
stageAtomic('artifacts/draft-release', [...all, mergedFile], context, 'combined');
console.log('All release shards validated; combined draft prepared locally. Nothing published or deployed.');
