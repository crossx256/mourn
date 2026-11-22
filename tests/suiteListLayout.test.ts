import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { parse } from '@vue/compiler-sfc';
import { compileString } from 'sass';
import { expect, it } from 'vitest';

const chrome = process.env.MOURN_THEME_CHROMIUM;
const require = createRequire(import.meta.url);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

it.skipIf(!chrome)('keeps long Suite rows and their actions inside the list viewport', () => {
  const page = parse(read('../src/pages/MessagingPage.vue')).descriptor;
  const css = compileString(page.styles.find((style) => style.lang === 'scss')!.content).css;
  const quasar = readFileSync(require.resolve('quasar/dist/quasar.prod.css'), 'utf8');
  const layoutCss = read('../src/css/suite-list.css');
  const row = (name: string) => `<div class="vault-suite-item">
    <div class="q-avatar vault-suite-avatar" style="font-size:36px"></div>
    <div class="vault-suite-info"><span class="vault-suite-name">${name}</span><span class="vault-suite-sub">500 members</span></div>
    <div class="vault-suite-actions"><span class="vault-badge">99</span>
      <button class="q-btn q-btn--round q-btn--dense vault-icon-btn" style="font-size:8px"><i class="q-icon">●</i></button>
      <button class="q-btn q-btn--round q-btn--dense vault-icon-btn" style="font-size:8px"><i class="q-icon">●</i></button>
    </div>
  </div>`;
  const list = (
    width: number,
  ) => `<section class="vault-tabs-pane" style="flex:none;width:${width}px;min-width:0;height:240px">
    <div class="vault-suites-head">Suites</div>
    <div class="q-scrollarea vault-scroll"><div class="q-scrollarea__container scroll relative-position fit hide-scrollbar">
      <div class="q-scrollarea__content absolute">${row('A'.repeat(64))}${row('Short Suite')}</div>
    </div></div>
  </section>`;
  const dir = mkdtempSync(join(tmpdir(), 'mourn-suite-list-'));
  const file = join(dir, 'layout.html');
  try {
    writeFileSync(
      file,
      `<!doctype html><meta charset="utf-8"><style>${quasar}\n${css}\n${layoutCss}</style>
    <div class="messaging-page-root">${[320, 420].map(list).join('')}</div><pre id="results"></pre>
    <script>
      const measures = [...document.querySelectorAll('.q-scrollarea__container')].map((scroller) => {
        const [long, short] = scroller.querySelectorAll('.vault-suite-item');
        const name = long.querySelector('.vault-suite-name');
        return {
          viewport: scroller.clientWidth,
          overflow: scroller.scrollWidth - scroller.clientWidth,
          actionsClipped: [...long.querySelectorAll('.vault-suite-actions > *')]
            .some((action) => action.getBoundingClientRect().right > scroller.getBoundingClientRect().right),
          longNameClipped: name.scrollWidth > name.clientWidth,
          shortNameVisible: short.querySelector('.vault-suite-name').scrollWidth === short.querySelector('.vault-suite-name').clientWidth,
        };
      });
      document.querySelector('#results').textContent = JSON.stringify(measures);
    </script>`,
    );
    const dom = execFileSync(
      chrome!,
      ['--no-sandbox', '--disable-gpu', '--disable-background-networking', '--dump-dom', file],
      { encoding: 'utf8', timeout: 15000 },
    );
    const measurements = JSON.parse(dom.match(/<pre id="results">(.*?)<\/pre>/)?.[1] ?? 'null');
    expect(measurements).toEqual(
      [320, 420].map((viewport) => ({
        viewport,
        overflow: 0,
        actionsClipped: false,
        longNameClipped: true,
        shortNameVisible: true,
      })),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
