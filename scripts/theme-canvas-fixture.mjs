import { BackdropEngine } from '/modules/backdrop/engine.js';
import { createBackdropPattern } from '/modules/backdrop/factory.js';
import { applyTheme, deriveSlots, hexToTriplet } from '/modules/apply.js';
import { defaults } from '/modules/preferences.js';

const canvas = document.querySelector('canvas');
const deps = {
  window,
  document,
  now: () => performance.now(),
  requestAnimationFrame: requestAnimationFrame.bind(window),
  cancelAnimationFrame: cancelAnimationFrame.bind(window),
};
const patterns = [
  'synapse',
  'rain',
  'constellations',
  'perlin-flow',
  'petals',
  'sparkles',
  'embers',
];
const samples = [];
let current,
  injected = false,
  autoDisables = 0;
const engine = new BackdropEngine(canvas, deps, {
  onAutoDisable() {
    autoDisables++;
  },
  createPattern(options) {
    const pattern = createBackdropPattern(options);
    const step = pattern.step.bind(pattern);
    pattern.step = (context, elapsed) => {
      const at = performance.now();
      step(context, elapsed);
      if (injected)
        while (performance.now() - at < 7) {
          /* Test-only real main-thread work. */
        }
      const ms = performance.now() - at;
      if (current)
        current.steps.push({
          at,
          ms,
          elapsed,
          particles: pattern.particleCount,
          focused: document.hasFocus(),
          visibility: document.visibilityState,
        });
    };
    return pattern;
  },
});
const configure = (pattern) =>
  engine.configure({ pattern, intensity: 1, size: 1, color: '#ff0000' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const state = () => ({
  frames: engine.getMetrics().frames,
  focus: document.hasFocus(),
  visibility: document.visibilityState,
  canvasCount: document.querySelectorAll('canvas').length,
  sameCanvas: document.querySelector('canvas') === canvas,
  width: innerWidth,
  height: innerHeight,
  dpr: devicePixelRatio,
  backing: [canvas.width, canvas.height],
  autoDisables,
});
const percentile = (values, ratio) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * ratio) - 1] ?? null;
window.probe = {
  state,
  configure,
  density() {
    return ['compact', 'comfortable', 'spacious'].map((density) => {
      const prefs = { ...defaults(), preset: 'crimson', density };
      applyTheme(prefs);
      const root = getComputedStyle(document.documentElement);
      const style = getComputedStyle(document.querySelector('.master-nav-link'));
      const rect = document.querySelector('.master-nav-link').getBoundingClientRect();
      return {
        density,
        slots: Object.fromEntries(
          ['space-unit', 'row-h', 'font-step'].map((key) => [
            key,
            root.getPropertyValue('--m-' + key).trim(),
          ]),
        ),
        colorsMatch: Object.entries(deriveSlots(prefs)).every(
          ([key, value]) =>
            root.getPropertyValue('--m-' + key + '-rgb').trim() === hexToTriplet(value),
        ),
        row: { height: rect.height, fontSize: style.fontSize, padding: style.paddingTop },
        visualScale: visualViewport.scale,
        dpr: devicePixelRatio,
      };
    });
  },
  async soak() {
    const startedAt = performance.now();
    for (let i = 0; i < patterns.length; i++) {
      current = { pattern: patterns[i], startedAt: performance.now(), steps: [] };
      samples.push(current);
      configure(patterns[i]);
      engine.start();
      const deadline = startedAt + ((i + 1) * 60000) / patterns.length;
      // Browser timers may wake fractionally early; measure at least the requested duration.
      do {
        await sleep(Math.max(1, deadline - performance.now()));
      } while (performance.now() < deadline);
      current.endedAt = performance.now();
      current.canvas = state();
    }
    engine.stop();
    current = null;
    return {
      startedAt,
      endedAt: performance.now(),
      state: state(),
      samples: samples.map((sample) => {
        const intervals = sample.steps.slice(1).map((s, i) => s.at - sample.steps[i].at);
        return {
          ...sample,
          count: sample.steps.length,
          medianStepMs: percentile(
            sample.steps.map((s) => s.ms),
            0.5,
          ),
          p95StepMs: percentile(
            sample.steps.map((s) => s.ms),
            0.95,
          ),
          medianFrameIntervalMs: percentile(intervals, 0.5),
          p95FrameIntervalMs: percentile(intervals, 0.95),
        };
      }),
    };
  },
  async start() {
    engine.configure({ pattern: 'rain', intensity: 0.1, size: 1, color: '#ff0000' });
    engine.start();
    await sleep(250);
    return state();
  },
  async settle() {
    await sleep(250);
    return state();
  },
  async inject() {
    engine.stop();
    configure('embers');
    const baseline = state();
    injected = true;
    engine.start();
    await sleep(450);
    const first = state();
    await sleep(250);
    const second = state();
    injected = false;
    engine.destroy();
    return { baseline, first, second };
  },
};
