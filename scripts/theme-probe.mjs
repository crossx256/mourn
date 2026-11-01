import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--cdp', '--url', '--out'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: theme-probe.mjs --out FILE [--cdp http://127.0.0.1:9222] [--url URL-prefix]');
  options[args[i]] = args[i + 1];
}
if (!options['--out']) throw new Error('--out is required; attach to an existing Chrome debugging session (no browser/server is launched)');
const response = await fetch(`${options['--cdp'] || 'http://127.0.0.1:9222'}/json/list`, { signal: AbortSignal.timeout(5000) });
if (!response.ok) throw new Error(`CDP discovery: HTTP ${response.status}`);
const pages = (await response.json()).filter((p) => p.type === 'page' && (!options['--url'] || p.url.startsWith(options['--url'])));
if (pages.length !== 1) throw new Error(`Expected one matching page, found ${pages.length}; specify --url`);
const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
const timer = setTimeout(() => { console.error('CDP probe timed out'); ws.close(); process.exitCode = 1; }, 10000);
try {
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const expression = `(() => {
    const selectors = { header: '.q-header', footer: '.footer, .q-footer', drawer: '.q-drawer__content', card: '.dash-card', chatRow: '.chat-list-item, .message-row', input: '.q-field--outlined .q-field__control', primaryButton: '.q-btn.bg-primary' };
    const styles = {}, missing = [];
    for (const [name, selector] of Object.entries(selectors)) {
      const el = document.querySelector(selector);
      if (!el) { missing.push({ name, selector }); continue; }
      const s = getComputedStyle(el);
      styles[name] = { background: s.backgroundColor, color: s.color, borderColor: s.borderColor };
    }
    return { styles, missing };
  })()`;
  const result = await new Promise((resolve, reject) => {
    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.id !== 1) return;
      if (msg.error || msg.result.exceptionDetails) reject(new Error(JSON.stringify(msg)));
      else resolve(msg.result.result.value);
    };
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
  await writeFile(options['--out'], JSON.stringify(result, null, 2) + '\n');
  console.log(`Captured ${Object.keys(result.styles).length}/7 surfaces; missing ${result.missing.length}`);
  if (result.missing.length) process.exitCode = 1;
} finally { clearTimeout(timer); ws.close(); }
