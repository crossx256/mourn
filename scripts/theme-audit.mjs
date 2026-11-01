import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ALLOWLIST = JSON.parse(await readFile(new URL('./theme-allowlist.json', import.meta.url), 'utf8'));
export const isMain = (url) => process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(url);

// Mask comments rather than deleting them, keeping offsets and line numbers intact.
export function literals(source) {
  const masked = source.replace(/<!--[^]*?-->|\/\*[^]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '));
  return [...masked.matchAll(/(?<![\w#])#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})(?![\w-])|\brgba?\([^()]*\)/gi)]
    .filter((m) => !m[0].includes('var('))
    .map((m) => ({ literal: m[0].toLowerCase().replace(/\s+/g, ' '), raw: m[0], index: m.index, line: source.slice(0, m.index).split('\n').length }));
}

export async function sourceFiles(root = ROOT) {
  const files = [];
  async function walk(dir) {
    for (const e of (await readdir(path.join(root, dir), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${dir}/${e.name}`;
      if (e.isDirectory()) await walk(name);
      else if (e.isFile() && /\.(vue|scss|css)$/.test(name)) files.push(name);
    }
  }
  await walk('src');
  return files;
}

export async function audit(root = ROOT, allowlist = ALLOWLIST) {
  const files = {};
  let rawTotal = 0, excludedTotal = 0, allowedTotal = 0;
  for (const file of await sourceFiles(root)) {
    const matches = literals(await readFile(path.join(root, file), 'utf8'));
    rawTotal += matches.length;
    const rules = allowlist.entries.filter((r) => r.file === file);
    if (rules.some((r) => r.exclude)) { excludedTotal += matches.length; continue; }
    const counts = {};
    for (const m of matches) counts[m.literal] = (counts[m.literal] || 0) + 1;
    for (const r of rules) {
      const n = Math.min(counts[r.literal] || 0, r.max);
      counts[r.literal] -= n;
      allowedTotal += n;
    }
    const colors = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0).sort());
    files[file] = { count: Object.values(colors).reduce((a, b) => a + b, 0), colors };
  }
  return { version: 1, scope: 'src/**/*.{vue,scss,css}; comments masked; profile excluded', rawTotal, excludedTotal, allowedTotal, total: Object.values(files).reduce((n, f) => n + f.count, 0), files };
}

if (isMain(import.meta.url)) {
  if (process.argv.slice(2).some((a) => a !== '--json')) throw new Error('Usage: node scripts/theme-audit.mjs [--json]');
  const result = await audit();
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    for (const [file, data] of Object.entries(result.files).sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))) if (data.count) console.log(`${file} · ${data.count}`);
    console.log(`Total: ${result.total} in ${Object.values(result.files).filter((f) => f.count).length} files; raw ${result.rawTotal}; excluded ${result.excludedTotal}; allowed ${result.allowedTotal}`);
  }
}
