import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const require = createRequire(fileURLToPath(new URL('../package.json', import.meta.url)));
const ts = require('typescript') as typeof import('typescript');

/**
 * M-item: the Graveyard ritual overlay could stay up forever. It starts visible,
 * and the check that dismisses it ran only from the ritual component's two events.
 * When the letter fetch finished AFTER the typewriter emitted (slow network),
 * nothing re-ran the check and the reader was left looking at a frozen bar. The
 * predicate also accepted either event, so the overlay could drop mid-line.
 *
 * This executes the page's real dismissal functions with the store's synthetic
 * module shape from the audit probe (frontend-synthetic-probes.cjs).
 */
const source = readFileSync(new URL('../src/pages/GraveyardPage.vue', import.meta.url), 'utf8');
const functions = ts.transpileModule(
  source.slice(source.indexOf('function onSequenceComplete()'), source.indexOf('// ── Data fetching')),
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

function harness() {
  const showRitual = { value: true };
  const watched: Array<{ getter: unknown; callback: () => void }> = [];
  const frameQueue: Array<() => void> = [];
  const context = {
    showRitual,
    sequenceDone: { value: false },
    lineDone: { value: false },
    graveyardStore: { loading: true },
    requestAnimationFrame: (fn: () => void) => frameQueue.push(fn),
    // The page registers `watch(() => graveyardStore.loading, dismissRitualWhenReady)`;
    // the harness records the callback so setLoading() can emulate Vue's flush.
    // Only the ritual's own watcher: the page also watches the letters array
    // (to re-resolve the open letter by id), and that callback needs page state
    // this harness does not model.
    watch: (getter: unknown, callback: () => void) => {
      if (String(getter).includes('loading')) watched.push({ getter, callback });
      return () => undefined;
    },
    RITUAL_MAX_WAIT_MS: 12_000,
    ritualGiveUp: null,
    clearTimeout: () => undefined,
    setTimeout: () => 1,
  };
  runInNewContext(
    `${functions}\nglobalThis.api = { onLineComplete, onSequenceComplete, dismissRitualWhenReady };`,
    context,
  );
  const api = (context as unknown as { api: Record<string, () => void> }).api;
  return {
    api,
    context,
    /** Runs the animation frame callback the dismissal queued, if any. */
    flushFrame() {
      frameQueue.splice(0).forEach((fn) => fn());
      return showRitual.value;
    },
    setLoading(value: boolean) {
      context.graveyardStore.loading = value;
      // Emulate Vue flushing the watcher the page registered on this flag.
      watched.forEach((entry) => entry.callback());
    },
  };
}

it('reveals the page when the fetch finishes after the typewriter already ended', () => {
  const h = harness();
  h.api.onLineComplete();
  h.api.onSequenceComplete();
  // Fetch still in flight: the overlay stays and nothing is queued yet.
  expect(h.flushFrame()).toBe(true);
  // ...then the letters arrive. Nothing else fires; the check must re-run.
  h.setLoading(false);
  expect(h.flushFrame()).toBe(false);
});

it('does not dismiss on the first typed line alone', () => {
  const h = harness();
  h.context.graveyardStore.loading = false;
  h.api.onLineComplete();
  h.api.dismissRitualWhenReady();
  expect(h.flushFrame()).toBe(true);
});

it('dismisses once both the whole sequence and the data are in', () => {
  const h = harness();
  h.context.graveyardStore.loading = false;
  h.api.onSequenceComplete();
  expect(h.flushFrame()).toBe(false);
});

it('gives the reader a way out of a hung fetch', () => {
  // The overlay is decoration; a fetch that never settles must not block the page.
  expect(source).toMatch(/RITUAL_MAX_WAIT_MS/);
  expect(source).toMatch(/ritualGiveUp = setTimeout\(\(\) => \{[\s\S]{0,120}showRitual\.value = false/);
  expect(source).toMatch(/onUnmounted\(\(\) => \{\s*stopRitualGiveUp\(\)/);
});
