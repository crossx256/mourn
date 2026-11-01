import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse, compileStyle } from '@vue/compiler-sfc';
import { compileString } from 'sass';
import { expect, it, vi } from 'vitest';
vi.mock('quasar', () => ({ setCssVar() {} }));
import { deriveSlots, hexToTriplet } from '../src/theme/apply';
import { defaults } from '../src/theme/preferences';
import { PRESETS, type Preset } from '../src/theme/presets';
import { ACCENTS } from '../src/theme/ramp';

const chrome = process.env.MOURN_THEME_CHROMIUM;
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
it.skipIf(!chrome)(
  'renders the actual scoped cascade above z0 and loads the bundled font without changing default crimson',
  async () => {
    const messaging = parse(read('../src/pages/MessagingPage.vue')).descriptor.styles[0]!;
    const scoped = compileStyle({
      source: messaging.content,
      filename: 'MessagingPage.vue',
      id: 'data-v-msg',
      scoped: true,
      preprocessLang: 'scss',
    });
    expect(scoped.errors).toEqual([]);
    const notice = compileStyle({
      source: parse(read('../src/components/NoticeCard.vue')).descriptor.styles[0]!.content,
      filename: 'NoticeCard.vue', id: 'data-v-notice', scoped: true,
    });
    expect(notice.errors).toEqual([]);
    const backdrop = parse(read('../src/components/theme/BackdropLayer.vue')).descriptor.styles[0]!;
    const css = compileString(read('../src/css/theme-tokens.scss'), {
      loadPaths: ['src/css'],
      silenceDeprecations: ['import'],
    }).css;
    const shared = compileString(read('../src/css/messaging-shared.scss')).css;
    const chromeCss = compileString(read('../src/css/mainlayout.scss')).css;
    const lateLegacy = compileString(read('../src/css/quasar.variables.scss')).css;
    const logoCss = parse(read('../src/components/icons/MournLogoInline.vue')).descriptor.styles[0]!.content;
    const slotCases = (Object.keys(PRESETS) as Preset[]).flatMap((preset) =>
      [null, ...ACCENTS]
        .filter((accent) => preset !== 'crimson' || accent !== null)
        .map((accent) => ({
          preset,
          accent,
          slots: Object.fromEntries(
            Object.entries(deriveSlots({ ...defaults(), preset, accent })).map(([key, hex]) => [
              key,
              hexToTriplet(hex),
            ]),
          ),
        })),
    );
    const html = `<!doctype html><html data-client-theme="on" data-theme="crimson"><head><style>
    ${shared}\n${css}\n${scoped.code}\n${notice.code}\n${backdrop.content}\n${logoCss}\n${lateLegacy}\n${chromeCss}
    .brand-word { color: var(--primary); }
    ::-webkit-scrollbar-thumb { background: var(--dash-accent-dim); }
    .q-layout { min-height: 500px; } .vault-page { min-height: 400px; }
        /* Sample endpoint colors, not an in-flight transition between swatches. */
        .vault-send-btn { transition: none !important; }
  </style></head><body><canvas id="m-backdrop"></canvas><div class="q-layout"><div class="q-page-container">
    <span id="brand-mark" class="mourn-logo-inline">mark</span><span class="brand-word">mourn</span>
    <div class="notice-card bg-black" data-v-notice><div class="notice-divider" data-v-notice></div>
      <span class="notice-header" data-v-notice>Announcements</span></div>
    <div class="group-chat-window"><div class="group-chat-header">Suite</div></div>
    <hr class="mobile-menu-separator"><div class="notif-divider"></div>
    <div class="vault-page" data-v-msg><div class="vault-center" data-v-msg>
      <div class="vault-msg-bubble vault-msg-bubble--sent" data-v-msg><span id="text">Client text</span></div>
      <div class="vault-input-area" data-v-msg><div class="vault-input-field" data-v-msg>
        <div class="q-field__control"><textarea class="q-field__native"></textarea></div>
      </div><button class="vault-send-btn" data-v-msg>Send</button></div>
      <i class="q-icon" style="font-family: monospace">icon</i><code style="font-family: monospace">code</code>
    </div></div></div></div><pre id="result">pending</pre>
    <script>(async function () {
      const root = document.documentElement;
      const style = selector => getComputedStyle(document.querySelector(selector));
      const initial = { input: style('.q-field__control').backgroundColor, send: style('.vault-send-btn').backgroundColor,
        bubble: style('.vault-msg-bubble').backgroundColor };
      root.setAttribute('data-backdrop-active', '');
      const active = { layoutZ: style('.q-layout').zIndex, canvasZ: style('#m-backdrop').zIndex,
        page: style('.vault-page').backgroundColor, center: style('.vault-center').backgroundColor,
        opacity: style('#text').opacity, pointer: style('#m-backdrop').pointerEvents,
        group: style('.group-chat-window').backgroundColor };
      root.dataset.frosted = 'on'; document.body.classList.add('theme-frosted');
      const frost = { background: style('.vault-input-area').backgroundColor, filter: style('.vault-input-area').backdropFilter };
      root.dataset.font = 'opendyslexic';
      const faces = await document.fonts.load('14px OpenDyslexic');
      const font = { loaded: faces.length, family: style('#text').fontFamily, icon: style('.q-icon').fontFamily, code: style('code').fontFamily };
      delete root.dataset.font; delete root.dataset.frosted; root.removeAttribute('data-backdrop-active');
      document.body.classList.remove('theme-frosted');
      const restored = { input: style('.q-field__control').backgroundColor, send: style('.vault-send-btn').backgroundColor,
        bubble: style('.vault-msg-bubble').backgroundColor };
      const slotFailures = [];
      for (const test of ${JSON.stringify(slotCases)}) {
        root.dataset.theme = test.preset;
        if (test.accent) root.dataset.themeAccent = test.accent; else delete root.dataset.themeAccent;
        for (const [key, value] of Object.entries(test.slots)) root.style.setProperty('--m-' + key + '-rgb', value);
        for (const [slot, selector] of [['input', '.q-field__control'], ['send', '.vault-send-btn'], ['bubble', '.vault-msg-bubble']]) {
          const actual = style(selector).backgroundColor;
          const expected = 'rgb(' + test.slots[slot + 'Bg'].split(' ').join(', ') + ')';
          if (actual !== expected) slotFailures.push({ preset: test.preset, accent: test.accent, slot, actual, expected });
          const text = style(slot === 'input' ? '.q-field__native' : selector).color;
          const expectedText = 'rgb(' + test.slots[slot + 'Text'].split(' ').join(', ') + ')';
          if (text !== expectedText) slotFailures.push({ preset: test.preset, accent: test.accent, slot, text, expectedText });
        }
      }
      root.style.setProperty('--m-accent-rgb', '0 255 255');
      const lateAliases = { name: style('.brand-word').color, logo: style('#brand-mark').color,
        scroll: getComputedStyle(document.body, '::-webkit-scrollbar-thumb').backgroundColor };
      const announcementInk = { divider: style('.notice-divider').backgroundImage,
        sweep: getComputedStyle(document.querySelector('.notice-divider'), '::after').backgroundImage,
        heading: style('.notice-header').textShadow,
        menu: style('.mobile-menu-separator').backgroundImage,
        notification: getComputedStyle(document.querySelector('.notif-divider'), '::after').backgroundImage };
      document.querySelector('#result').textContent = JSON.stringify({ initial, active, frost, font, restored, slotFailures, lateAliases, announcementInk });
    })().catch(error => { document.querySelector('#result').textContent = JSON.stringify({ error: String(error) }); });</script>
  </body></html>`;
    const server = createServer((req, res) => {
      if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
        return;
      }
      const font = req.url?.match(/^\/fonts\/opendyslexic\/(OpenDyslexic-[A-Za-z-]+\.woff2)$/)?.[1];
      if (font) {
        res.setHeader('Content-Type', 'font/woff2');
        res.end(readFileSync(new URL(`../public/fonts/opendyslexic/${font}`, import.meta.url)));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing fixture port');
      const { stdout } = await promisify(execFile)(
        chrome!,
        [
          '--headless=new',
          '--no-sandbox',
          '--disable-gpu',
          '--no-first-run',
          '--no-default-browser-check',
          '--virtual-time-budget=5000',
          '--dump-dom',
          `http://127.0.0.1:${address.port}/`,
        ],
        { timeout: 20000, maxBuffer: 4 * 1024 * 1024 },
      );
      const json = stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
      expect(json).not.toBe('pending');
      const result = JSON.parse(json ?? '{}');
      expect(result.error).toBeUndefined();
      expect(result.initial).toEqual({
        input: 'rgba(255, 255, 255, 0.05)',
        send: 'rgba(0, 0, 0, 0)',
        bubble: 'rgba(255, 0, 0, 0.06)',
      });
      expect(result.active).toEqual({
        layoutZ: '1',
        canvasZ: '0',
        page: 'rgba(0, 0, 0, 0)',
        center: 'rgba(0, 0, 0, 0)',
        opacity: '1',
        pointer: 'none',
        group: 'rgba(0, 0, 0, 0)',
      });
      expect(result.frost).toEqual({ background: 'rgba(13, 13, 13, 0.88)', filter: 'blur(12px)' });
      expect(result.font.loaded).toBeGreaterThan(0);
      expect(result.font.family).toContain('OpenDyslexic');
      expect(result.font.icon).toBe('monospace');
      expect(result.font.code).toBe('monospace');
      expect(result.restored).toEqual(result.initial);
      expect(result.slotFailures).toEqual([]);
      expect(result.lateAliases).toEqual({ name: 'rgb(0, 255, 255)', logo: 'rgb(0, 255, 255)', scroll: 'rgba(0, 255, 255, 0.6)' });
      expect(result.announcementInk.divider).toContain('rgba(0, 255, 255, 0.3)');
      expect(result.announcementInk.sweep).toContain('rgba(0, 255, 255, 0.6)');
      expect(result.announcementInk.heading).toContain('rgba(0, 255, 255, 0.3)');
      expect(result.announcementInk.menu).toContain('rgba(0, 255, 255, 0.3)');
      expect(result.announcementInk.notification).toContain('rgba(0, 255, 255, 0.6)');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
  30000,
);
