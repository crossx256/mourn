import { readFile } from 'node:fs/promises';
import { audit, isMain } from './theme-audit.mjs';

export function growth(current, baseline) {
  const failures = [];
  for (const [file, data] of Object.entries(current.files)) {
    const old = baseline.files[file] || { count: 0, colors: {} };
    if (data.count > old.count) failures.push(`${file}: total ${old.count} → ${data.count}`);
    for (const [color, n] of Object.entries(data.colors)) {
      if (n > (old.colors[color] || 0)) failures.push(`${file}: ${color} ${old.colors[color] || 0} → ${n}`);
    }
  }
  return failures;
}

if (isMain(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('Usage: node scripts/theme-guard.mjs (baseline updates require explicit review)');
  const baseline = JSON.parse(await readFile(new URL('./theme-baseline.json', import.meta.url), 'utf8'));
  const current = await audit();
  const failures = growth(current, baseline);
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  else console.log(`Theme guard PASS: ${current.total} literals; baseline ${baseline.total}; no per-file or per-literal growth.`);
}
