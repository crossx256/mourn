import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ALLOWLIST, ROOT, isMain, literals, sourceFiles } from './theme-audit.mjs';

const normalize = (hex) => hex.length === 4 ? '#' + [...hex.slice(1)].map((c) => c + c).join('') : hex;
export function tokenMap(source) {
  const map = new Map();
  for (const m of source.matchAll(/\b(\w+):\s*'(#\w+)'/g)) {
    const key = normalize(m[2].toLowerCase());
    map.set(key, [...(map.get(key) || []), m[1]]);
  }
  return map;
}

export function sweep(source, file, tokens, allowlist = ALLOWLIST) {
  if (allowlist.entries.some((r) => r.file === file && r.exclude)) return { source, changes: [], triage: [] };
  const blocks = file.endsWith('.vue') ? [...source.matchAll(/<style\b[^>]*>([^]*?)<\/style\s*>/gi)].map((m) => [m.index + m[0].indexOf('>') + 1, m.index + m[0].lastIndexOf('</style')]) : [[0, source.length]];
  const changes = [], triage = [];
  for (const m of literals(source)) {
    const candidates = tokens.get(normalize(m.literal)) || [];
    const start = source.lastIndexOf('\n', m.index) + 1;
    const end = source.indexOf('\n', m.index);
    const line = source.slice(start, end < 0 ? source.length : end);
    // Only entire, simple declaration values: no Sass variables, URLs, strings,
    // inline JS, interpolation, gradients, shorthands or ambiguous semantic colors.
    const declaration = /^\s*(?:color|background-color|border-color|outline-color|fill|stroke)\s*:\s*#[\da-f]+\s*(?:!important\s*)?;\s*$/i.test(line);
    const allowed = allowlist.entries.some((r) => r.file === file && r.literal === m.literal);
    if (!allowed && candidates.length === 1 && declaration && blocks.some(([a, b]) => m.index >= a && m.index < b)) {
      changes.push({ ...m, replacement: `rgb(var(--m-${candidates[0]}-rgb))` });
    } else triage.push({ ...m, reason: allowed ? 'allowlisted' : candidates.length > 1 ? `ambiguous: ${candidates.join(', ')}` : 'manual context or unmatched color' });
  }
  let result = source;
  for (const c of [...changes].reverse()) result = result.slice(0, c.index) + c.replacement + result.slice(c.index + c.raw.length);
  return { source: result, changes, triage };
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((a) => !['--write', '--dry-run'].includes(a)) || (args.includes('--write') && args.includes('--dry-run'))) throw new Error('Usage: node scripts/theme-sweep.mjs [--dry-run | --write]');
  const write = args.includes('--write');
  const tokens = tokenMap(await readFile(path.join(ROOT, 'src/theme/tokens.ts'), 'utf8'));
  if (!tokens.size) throw new Error('No default tokens found; refusing sweep');
  let changes = 0, triage = 0, files = 0;
  for (const file of await sourceFiles()) {
    const result = sweep(await readFile(path.join(ROOT, file), 'utf8'), file, tokens);
    if (result.changes.length) {
      console.log(`${file} · ${result.changes.length} proposed changes`);
      files++; changes += result.changes.length;
      if (write) await writeFile(path.join(ROOT, file), result.source);
    }
    for (const m of result.triage) console.log(`TRIAGE ${file}:${m.line} ${m.raw} (${m.reason})`);
    triage += result.triage.length;
  }
  console.log(`${write ? 'WRITE' : 'DRY RUN (no files written)'}: ${changes} changes in ${files} files; ${triage} manual/allowlisted literals. Zero-diff visual gate required before production use of --write.`);
}
