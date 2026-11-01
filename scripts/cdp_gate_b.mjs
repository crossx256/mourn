// Bounded local-only CDP capture. Does not authenticate or start an application server.
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const execFileAsync = promisify(execFile);
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export async function capture(url, out, width = 1366, height = 768) {
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local URLs only');
  const profile = await mkdtemp(join(tmpdir(), 'mourn-cdp-'));
  const events = [], pending = new Map(), loads = new Map();
    let healthResponses = 0;
    const healthScenario = process.env.SECTION_B_HEALTH;
    if (!['healthy', 'retrying'].includes(healthScenario)) throw new Error('Explicit SECTION_B_HEALTH required');
    let lastLoad = Date.now();
    const deterministic = process.env.SECTION_B_DETERMINISTIC === '1';
  let stderr = '', ws, id = 0, sessionId;
  const child = spawn(process.env.CHROME_PATH || '/opt/brave.com/brave/brave', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  child.stderr.on('data', b => { stderr += b; });
  child.on('error', e => { stderr += String(e); });
  const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const watchdog = setTimeout(kill, 45000);
  try {
    let endpoint;
    for (let i = 0; i < 60; i++) {
      endpoint = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
      if (endpoint || child.exitCode !== null || child.signalCode) break;
      await sleep(200);
    }
    if (!endpoint) throw new Error(`Browser launch failed (exit ${child.exitCode}, signal ${child.signalCode}):\n${stderr}`);
    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      if (m.id) {
        const p = pending.get(m.id); if (!p) return;
        clearTimeout(p.timer); pending.delete(m.id);
        if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
      } else {
        if (/Runtime.exceptionThrown|Runtime.consoleAPICalled|Log.entryAdded/.test(m.method)) events.push(m);
                if (m.method === 'Network.requestWillBeSent' && !['WebSocket', 'EventSource'].includes(m.params.type)) { loads.set(m.params.requestId, m.params.request.url); lastLoad = Date.now(); }
                if (['Network.loadingFinished', 'Network.loadingFailed'].includes(m.method)) { loads.delete(m.params.requestId); lastLoad = Date.now(); }
                if (m.method === 'Network.loadingFailed') events.push(m);
        if (m.method === 'Fetch.requestPaused') {
          const u = new URL(m.params.request.url);
          const local = ['localhost', '127.0.0.1'].includes(u.hostname);
                    if (local && u.pathname === '/api/health') {
                      const status = healthScenario === 'healthy' ? 'healthy' : 'unhealthy';
                      const body = { status, timestamp: '2026-10-20T00:00:00.000Z', checks: { database: { status: 'unknown', latency: null, error: null }, redis: { status: 'unknown', latency: null, error: null } } };
                      send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: status === 'healthy' ? 200 : 503, responseHeaders: [{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'}], body: Buffer.from(JSON.stringify(body)).toString('base64') }, m.sessionId).then(() => healthResponses++).catch(e => events.push({error:String(e)}));
                      return;
                    }
          send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId: m.params.requestId, ...(local && u.pathname.startsWith('/api/') && process.env.SECTION_B_FIXTURE_PORT ? { url: `http://127.0.0.1:${process.env.SECTION_B_FIXTURE_PORT}${u.pathname}${u.search}` } : {}), ...(!local ? { errorReason: 'BlockedByClient' } : {}) }, m.sessionId).catch(e => events.push({ error: String(e) }));
        }
      }
    };
    function send(method, params = {}, sid = sessionId) {
      return new Promise((resolve, reject) => {
        const n = ++id;
        const timer = setTimeout(() => { pending.delete(n); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
        pending.set(n, { resolve, reject, timer });
        ws.send(JSON.stringify({ id: n, method, params, ...(sid ? { sessionId: sid } : {}) }));
      });
    }
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
    await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
        if (deterministic) await send('Page.addScriptToEvaluateOnNewDocument', { source: `
          // Visual test only: seeded non-cryptographic randomness; do not replace crypto APIs.
          let seed = 123456789;
          Math.random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
          const NativeDate = Date;
          globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [1792454400000])); } static now() { return 1792454400000; } };
          document.addEventListener('DOMContentLoaded', () => {
            const style = document.createElement('style');
            style.textContent = '*, *::before, *::after { animation-delay: 0s !important; animation-duration: 0s !important; animation-iteration-count: 1 !important; transition: none !important; caret-color: transparent !important; }';
            document.head.append(style);
          });
        ` });
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        if (deterministic) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await send('Page.navigate', { url });
    let ready = false, readiness;
        let stableSamples = 0, previousHealth;
        const healthSnapshot = async () => {
          const r = await send('Runtime.evaluate', {returnByValue:true, expression:`(() => {
            const rect = s => { const e=document.querySelector(s); if(!e)return null; const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
            return {badge:document.querySelector('.header-brand > span[role="button"]')?.textContent?.trim() || null, search:rect('.desktop-search-mode--left .q-field__control'), focused:document.activeElement?.tagName, query:document.querySelector('.desktop-search-mode--left input')?.value || '', cloak:document.body?.hasAttribute('data-app-cloak'), overlay:!!document.querySelector('.terminal-overlay, .archive-loading')};
          })()`});
          return {...r.result.value, pendingLoads:[...loads.values()]};
        };
    for (let i = 0; i < 100; i++) {
      const state = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
        const b = document.body;
        return { visible: !!b && getComputedStyle(b).visibility === 'visible', cloakRemoved: !!b && !b.hasAttribute('data-app-cloak'), text: b?.innerText.length || 0, fonts: document.fonts.status, images: [...document.images].filter(i => !i.complete).map(i => i.src), state: document.readyState, bootOverlay: !!document.querySelector('.terminal-overlay, .archive-loading') };
      })()` });
      readiness = state.result.value;
      const health = await healthSnapshot();
            const key = JSON.stringify(health);
            stableSamples = key === previousHealth ? stableSamples + 1 : 0;
            previousHealth = key;
            const expectedHealth = healthScenario === 'healthy' ? !health.badge : !!health.badge;
            if (healthResponses >= (healthScenario === 'healthy' ? 1 : 2) && expectedHealth && stableSamples >= 4 && readiness?.visible && !readiness.bootOverlay && readiness.cloakRemoved && readiness.text && readiness.fonts === 'loaded' && !readiness.images.length && readiness.state === 'complete' && loads.size === 0 && Date.now() - lastLoad > 700) { ready = true; break; }
      await sleep(200);
    }
    if (!ready) events.push({ readinessFailure: { readiness, pendingLoads: [...loads.values()] } });
        // Diagnostic screenshots remain evidence, but ready=false must prevent a pass.
    await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true });
    if (deterministic) {
      await send('Animation.enable');
      await send('Animation.setPlaybackRate', { playbackRate: 0 });
      await send('Runtime.evaluate', { expression: "document.querySelectorAll('video,audio').forEach(m => m.pause()); document.getAnimations().forEach(a => { a.pause(); a.currentTime = 0; });" });
    }
    const evaluated = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
      // Observe the actual app; never force visibility or remove overlays.
      const profile = location.pathname === '/stub';
            const routeSelectors = { '/': '.q-page', '/archives': '.archives-index .archive-shell', '/leaderboard': '.q-page', '/graveyard': '.graveyard-page', '/tickets': '.q-page', '/dashboard': '.dashboard-page' };
                  const selectors = profile ? { profile: '.profile-container' } : { header: '.q-header', footer: '.footer, .q-footer', main: routeSelectors[location.pathname] || '.q-page', primaryButton: '.q-btn.bg-primary' };
      const styles = {}, missing = [];
      for (const [key, selector] of Object.entries(selectors)) {
        const el = document.querySelector(selector);
        if (!el) { missing.push({ key, selector }); continue; }
        const s = getComputedStyle(el), r = el.getBoundingClientRect();
        styles[key] = { background: s.backgroundColor, color: s.color, borderColor: s.borderColor, rect: { x:r.x, y:r.y, width:r.width, height:r.height } };
      }
      const rowSelector = '.dashboard-page .performance-toggle-row';
      const rows = [...document.querySelectorAll(rowSelector)].map(el => {
        const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        return { selector: rowSelector, text: el.innerText, height: r.height, width: r.width, top: r.top, minHeight: s.minHeight, paddingTop: s.paddingTop, paddingBottom: s.paddingBottom, boxSizing: s.boxSizing, display: s.display, visibility: s.visibility };
      });
      const router = document.querySelector('#q-app')?.__vue_app__?.config.globalProperties.$router;
            const routerMap = router?.getRoutes().map(r => ({ path: r.path, name: String(r.name || ''), redirect: typeof r.redirect === 'string' ? r.redirect : null }));
            const surfaces = [...document.querySelectorAll('.q-btn, .q-field__control, .q-card, .dash-card, .profile-container, .profile-card, table, canvas, h1, h2, input, textarea')].map((el, index) => {
                          const s = getComputedStyle(el), r = el.getBoundingClientRect();
                          return { index, tag: el.tagName, classes: el.className?.baseVal ?? el.className, text: el.innerText?.slice(0, 100), background: s.backgroundColor, color: s.color, border: s.border, font: s.font, opacity: s.opacity, transform: s.transform, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
                        });
                        return { surfaces, routerMap, matched: router?.currentRoute.value.matched.map(r => r.path), href: location.href, title: document.title, text: document.body.innerText.slice(0, 1500), cloak: getComputedStyle(document.body).visibility, theme: {...document.documentElement.dataset}, profileRendered: !!document.querySelector('.profile-container'), rows, styles, missing };
    })()` });
    if (evaluated.exceptionDetails) throw new Error(JSON.stringify(evaluated.exceptionDetails));
    const probePort = new URL(endpoint).port;
    try {
      if (!deterministic) await execFileAsync(process.execPath, ['scripts/theme-probe.mjs', '--cdp', `http://127.0.0.1:${probePort}`, '--url', url, '--out', `${out}.theme-probe.json`], { timeout: 15000 });
    } catch (error) { events.push({ themeProbeError: String(error), stdout: error.stdout, stderr: error.stderr }); }
    await sleep(500);
    const healthBefore = await healthSnapshot();
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const healthAfter = await healthSnapshot();
    const screenshotStable = JSON.stringify(healthBefore) === JSON.stringify(healthAfter) && !healthBefore.pendingLoads.length && !healthBefore.cloak && !healthBefore.overlay && (healthScenario === 'healthy' ? !healthBefore.badge : !!healthBefore.badge);
    ready = ready && screenshotStable;
    evaluated.result.value.captureHealth = { scenario:healthScenario, responses:healthResponses, before:healthBefore, after:healthAfter, screenshotStable, ready };
    await writeFile(out, Buffer.from(shot.data, 'base64'));
        if (deterministic) {
          const interactionProbes = {};
          for (const [name, selector] of Object.entries({ hover: '.q-page .q-btn:not([disabled]), .profile-container button', field: '.q-page input:not([disabled]), .q-page textarea:not([disabled])' })) {
            const target = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2, selector:${JSON.stringify(selector)}, text:el.innerText, rect:{x:r.x,y:r.y,width:r.width,height:r.height} }; })()` });
            interactionProbes[name] = target.result.value;
            if (!target.result.value) continue;
            if (name === 'hover') await send('Input.dispatchMouseEvent', { type:'mouseMoved', x:target.result.value.x, y:target.result.value.y });
            else await send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)}).focus()` });
            await sleep(150);
            const stateShot = await send('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
            await writeFile(out.replace('.png', `-${name}.png`), Buffer.from(stateShot.data, 'base64'));
            await send('Input.dispatchMouseEvent', { type:'mouseMoved', x:0, y:0 });
          }
          evaluated.result.value.interactions = interactionProbes;
        }
    await writeFile(`${out}.json`, JSON.stringify({ url, width, height, deterministic, ready, readiness, pendingLoads: [...loads.values()], probe: evaluated.result.value, events, stderr }, null, 2));
    return evaluated.result.value;
  } catch (e) {
    await writeFile(`${out}.failure.json`, JSON.stringify({ error: String(e), stderr, events }, null, 2));
    throw e;
  } finally {
    clearTimeout(watchdog); ws?.close();
    for (const p of pending.values()) clearTimeout(p.timer);
    kill(); await sleep(200); await rm(profile, { recursive: true, force: true });
  }
}
if (process.argv[1]?.endsWith('/cdp_gate_b.mjs')) {
  const [, , url, out, w, h] = process.argv;
  if (!url || !out) throw new Error('Usage: cdp_shot.mjs LOCAL_URL OUT.png [WIDTH HEIGHT]');
  console.log(JSON.stringify(await capture(url, out, Number(w || 1366), Number(h || 768)), null, 2));
}
