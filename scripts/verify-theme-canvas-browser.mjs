// Real-time, local-only Canvas2D verification. No release build or production modifications.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import ts from 'typescript';
import { compileString } from 'sass';

const chrome = process.env.MOURN_THEME_CHROMIUM;
if (!chrome) throw new Error('Set MOURN_THEME_CHROMIUM to an installed Chromium executable');
const root = resolve(import.meta.dirname, '..');
const out = join(root, 'artifacts/theme-canvas-browser');
await mkdir(out, { recursive: true });
const css = compileString(await readFile(join(root, 'src/css/theme-tokens.scss'), 'utf8'), {
  loadPaths: [join(root, 'src/css')],
  silenceDeprecations: ['import'],
}).css;
const fixture = await readFile(join(root, 'scripts/theme-canvas-fixture.mjs'), 'utf8');
const cache = new Map();
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(
        `<!doctype html><style>${css}\nbody{margin:0}canvas{position:fixed;inset:0;z-index:-1}.master-nav-link{box-sizing:border-box;display:block;min-height:40px;padding:8px;font-size:13px}</style><canvas id="m-backdrop"></canvas><a class="master-nav-link">Density probe</a><script type="importmap">{"imports":{"quasar":"/quasar-brand.js"}}</script><script type="module" src="/fixture.js"></script>`,
      );
    } else if (path === '/fixture.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(fixture);
    } else if (path === '/quasar-brand.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(
        'export const setCssVar = (key,value) => document.documentElement.style.setProperty("--q-"+key,value);',
      );
    } else if (/^\/modules\/[a-z/-]+\.js$/.test(path)) {
      const file = join(root, 'src/theme', path.slice('/modules/'.length).replace(/\.js$/, '.ts'));
      if (!cache.has(file)) {
        const source = await readFile(file, 'utf8');
        const js = ts
          .transpileModule(source, {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
          })
          .outputText.replace(
            /(from\s+['"])(\.[^'"]+)(['"])/g,
            (_, a, b, c) => a + b + (b.endsWith('.js') ? '' : '.js') + c,
          );
        cache.set(file, js);
      }
      res.setHeader('Content-Type', 'text/javascript');
      res.end(cache.get(file));
    } else {
      res.statusCode = 404;
      res.end();
    }
  } catch (error) {
    res.statusCode = 500;
    res.end(String(error));
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const owned = new Set();
const kill = (child) => {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {}
};
const watchdog = setTimeout(() => {
  for (const child of owned) kill(child);
  server.closeAllConnections();
  server.close();
}, 190000);
async function run(width, height) {
  const profile = await mkdtemp(join(tmpdir(), 'mourn-canvas-'));
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { detached: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  owned.add(child);
  let stderr = '',
    ws,
    id = 0,
    sessionId;
  const pending = new Map(),
    events = [];
  child.stderr.on('data', (b) => (stderr += b));
  child.on('error', (error) => (stderr += String(error)));
  try {
    let endpoint;
    for (let i = 0; i < 100; i++) {
      endpoint = stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
      if (endpoint) break;
      await sleep(100);
    }
    if (!endpoint) throw new Error(stderr);
    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    ws.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      if (m.id) {
        const p = pending.get(m.id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') events.push(m);
    };
    const send = (method, params = {}, sid = sessionId) =>
      new Promise((resolve, reject) => {
        const n = ++id;
        const timer = setTimeout(() => {
          pending.delete(n);
          reject(new Error('CDP timeout ' + method));
        }, 75000);
        pending.set(n, { resolve, reject, timer });
        ws.send(JSON.stringify({ id: n, method, params, ...(sid ? { sessionId: sid } : {}) }));
      });
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: true });
    ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
    await send('Runtime.enable');
    await send('Page.enable');
    const windowInfo = await send('Browser.getWindowForTarget', { targetId });
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send('Page.navigate', { url });
    for (let i = 0; i < 100; i++) {
      if (await evaluate('!!window.probe')) break;
      await sleep(100);
    }
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await send('Page.bringToFront');
    const initial = await evaluate('probe.state()');
    if (
      !initial.focus ||
      initial.visibility !== 'visible' ||
      initial.width !== width ||
      initial.height !== height
    )
      throw new Error('Invalid initial state ' + JSON.stringify(initial));
    console.log(`${width}x${height}: real-time 60s loop starting`);
    const soak = await evaluate('probe.soak()');
    const lifecycle = [];
    const before = await evaluate('probe.start()');
    // Disable CDP focus emulation to exercise actual headless focus/blur state.
    await send('Emulation.setFocusEmulationEnabled', { enabled: false });
    const { targetId: other } = await send('Target.createTarget', { url: 'about:blank' });
    await send('Target.activateTarget', { targetId: other });
    const blurred = await evaluate('probe.settle()');
    const blurredAgain = await evaluate('probe.settle()');
    await send('Target.activateTarget', { targetId });
    await send('Page.bringToFront');
    const resumed = await evaluate('probe.settle()');
    lifecycle.push({ kind: 'real-tab-blur-visibility', before, blurred, blurredAgain, resumed });
    await send('Target.closeTarget', { targetId: other });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });

    const density = [];
    for (const scale of [1, 1.25]) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: Math.round(width / scale),
        height: Math.round(height / scale),
        deviceScaleFactor: scale,
        mobile: false,
      });
      density.push({
        scale,
        method: 'CDP browser CSS viewport/DPR emulation (not native zoom)',
        values: await evaluate('probe.density()'),
      });
    }
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const injection = await evaluate('probe.inject()');
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(out, `${width}x${height}.png`), Buffer.from(screenshot.data, 'base64'));
    const checks = {
      duration: soak.endedAt - soak.startedAt >= 60000,
      sevenPatterns: soak.samples.length === 7 && soak.samples.every((s) => s.count > 20),
      foreground: soak.samples.every((s) =>
        s.steps.every((x) => x.focused && x.visibility === 'visible'),
      ),
      oneCanvas: soak.samples.every((s) => s.canvas.canvasCount === 1 && s.canvas.sameCanvas),
      noNaturalAutoDisable: soak.state.autoDisables === 0,
      pause:
        !blurred.focus && blurred.visibility === 'hidden' && blurredAgain.frames === blurred.frames,
      resume:
        resumed.focus && resumed.visibility === 'visible' && resumed.frames > blurredAgain.frames,
      autoDisable:
        injection.first.autoDisables === injection.baseline.autoDisables + 1 &&
        injection.first.frames === injection.baseline.frames + 3 &&
        injection.second.frames === injection.first.frames,
      density: density.every((d) =>
        d.values.every((v) => {
          const expected = {
            compact: [4, 32, 12],
            comfortable: [8, 40, 13],
            spacious: [12, 48, 14],
          }[v.density];
          return (
            v.colorsMatch &&
            v.slots['space-unit'] === expected[0] + 'px' &&
            v.slots['row-h'] === expected[1] + 'px' &&
            v.slots['font-step'] === expected[2] + 'px' &&
            v.row.height === expected[1] &&
            v.row.fontSize === expected[2] + 'px' &&
            v.dpr === d.scale
          );
        }),
      ),
      noExceptions: events.length === 0,
    };
    const result = {
      width,
      height,
      chrome,
      windowInfo,
      initial,
      soak,
      lifecycle,
      density,
      injection,
      checks,
      events,
      stderr,
    };
    await writeFile(join(out, `${width}x${height}.json`), JSON.stringify(result, null, 2));
    console.log(
      JSON.stringify(
        {
          width,
          height,
          checks,
          patterns: soak.samples.map(
            ({
              pattern,
              count,
              medianStepMs,
              p95StepMs,
              medianFrameIntervalMs,
              p95FrameIntervalMs,
            }) => ({
              pattern,
              count,
              medianStepMs,
              p95StepMs,
              medianFrameIntervalMs,
              p95FrameIntervalMs,
            }),
          ),
        },
        null,
        2,
      ),
    );
    return result;
  } finally {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Browser cleanup'));
    }
    pending.clear();
    ws?.close();
    kill(child);
    if (child.exitCode === null && child.signalCode === null)
      await new Promise((resolve) => child.once('exit', resolve));
    owned.delete(child);
    await rm(profile, { recursive: true, force: true });
  }
}
try {
  const results = await Promise.allSettled([run(1366, 768), run(1920, 1080)]);
  const summary = results.map((r) =>
    r.status === 'fulfilled'
      ? { width: r.value.width, height: r.value.height, checks: r.value.checks }
      : { error: String(r.reason) },
  );
  await writeFile(
    join(out, 'summary.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        summary,
        limitations: [
          '60 seconds per viewport, seven sequential patterns; not 60 seconds per pattern',
          'Separate headless Chromium windows/processes with CDP viewport sizing and foreground focus emulation during soak',
          'Canvas2D CPU submission timing, not GPU completion or native Tauri/WebKit performance',
          '125% is CSS viewport/DPR browser emulation, not native zoom',
          'Fixture uses actual theme CSS and applyTheme; only Quasar brand setter is substituted, no full application mount',
        ],
      },
      null,
      2,
    ),
  );
  if (results.some((r) => r.status === 'rejected' || Object.values(r.value.checks).some((v) => !v)))
    process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  for (const child of owned) kill(child);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
