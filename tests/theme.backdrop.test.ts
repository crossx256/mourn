import { describe, expect, it, vi } from 'vitest';
import { BackdropEngine } from '../src/theme/backdrop/engine';
import type {
  BackdropDependencies,
  BackdropPattern,
  CanvasLike,
} from '../src/theme/backdrop/types';

function harness(options: { mobile?: boolean; reducedMotion?: boolean } = {}) {
  const callbacks = new Map<number, FrameRequestCallback>();
  let rafId = 0;
  let now = 0;
  let focused = true;
  let reducedMotion = options.reducedMotion === true;
  const mediaListeners = new Set<EventListener>();
  const media = {
    get matches() {
      return reducedMotion;
    },
    addEventListener: (_name: string, listener: EventListener) => mediaListeners.add(listener),
    removeEventListener: (_name: string, listener: EventListener) =>
      mediaListeners.delete(listener),
  };
  const clockReads: number[] = [];
  const context = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: '',
    lineWidth: 1,
    setTransform: vi.fn(),
    fillStyle: '',
    globalAlpha: 1,
  };
  const canvas = {
    id: 'm-backdrop',
    width: 0,
    height: 0,
    style: {},
    getContext: () => context,
  } as unknown as CanvasLike;
  const windowListeners = new Map<string, Set<EventListener>>();
  const documentListeners = new Map<string, Set<EventListener>>();
  const deps: BackdropDependencies = {
    now: () => clockReads.shift() ?? now,
    requestAnimationFrame: (callback) => {
      const id = ++rafId;
      callbacks.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => callbacks.delete(id),
    window: {
      innerWidth: 1000,
      innerHeight: 600,
      devicePixelRatio: 2,
      matchMedia: () => media,
      addEventListener: (name, listener) => {
        const listeners = windowListeners.get(name) ?? new Set();
        listeners.add(listener);
        windowListeners.set(name, listeners);
      },
      removeEventListener: (name, listener) => windowListeners.get(name)?.delete(listener),
    },
    document: {
      visibilityState: 'visible',
      hasFocus: () => focused,
      addEventListener: (name, listener) => {
        const listeners = documentListeners.get(name) ?? new Set();
        listeners.add(listener);
        documentListeners.set(name, listeners);
      },
      removeEventListener: (name, listener) => documentListeners.get(name)?.delete(listener),
    },
    mobile: options.mobile,
  };
  const dispatch = (listeners: Map<string, Set<EventListener>>, name: string) => {
    for (const listener of listeners.get(name) ?? []) listener(new Event(name));
  };
  return {
    canvas,
    context,
    deps,
    callbacks,
    windowListeners,
    documentListeners,
    mediaListeners,
    setReducedMotion: (value: boolean) => {
      reducedMotion = value;
      for (const listener of mediaListeners) listener(new Event('change'));
    },
    setFocused: (value: boolean) => {
      focused = value;
    },
    setVisibility: (value: string) => {
      deps.document.visibilityState = value;
    },
    dispatchWindow: (name: string) => dispatch(windowListeners, name),
    dispatchDocument: (name: string) => dispatch(documentListeners, name),
    setStepDurations: (...durations: number[]) => {
      for (const duration of durations) clockReads.push(0, duration);
    },
    runFrame: (value: number) => {
      now = value;
      const entry = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!entry) throw new Error('No frame queued');
      callbacks.delete(entry[0]);
      entry[1](value);
    },
  };
}

describe('BackdropEngine', () => {
  it('uses the real pattern factory for every animated selection', () => {
    const h = harness();
    const engine = new BackdropEngine(h.canvas, h.deps);
    for (const pattern of [
      'synapse',
      'rain',
      'constellations',
      'perlin-flow',
      'petals',
      'sparkles',
      'embers',
    ] as const) {
      engine.configure({ pattern, color: '#00ffff', intensity: 1, size: 1 });
      engine.start();
      h.runFrame(1000);
      expect(engine.getMetrics().particleCount).toBeGreaterThan(0);
      expect(h.context.fillStyle).toBe('#00ffff');
      expect(h.callbacks.size).toBe(1);
    }
    engine.destroy();
  });
  it('adapts future work above 1.5ms without hiding slow samples or weakening the cutoff', () => {
    const h = harness();
    let count = 96;
    const drawn: number[] = [];
    const reduceWork = vi.fn((ratio: number) => {
      count = Math.floor(count * ratio);
    });
    const disabled = vi.fn();
    const engine = new BackdropEngine(h.canvas, h.deps, {
      onAutoDisable: disabled,
      createPattern: () => ({
        init() {},
        resize() {},
        destroy() {},
        step() {
          drawn.push(count);
        },
        get particleCount() {
          return count;
        },
        reduceWork,
      }),
    });
    engine.configure({ pattern: 'rain', color: null, intensity: 1, size: 1 });
    engine.start();
    h.setStepDurations(1.5, 3, 5, 5, 5);
    for (let i = 1; i <= 5; i++) h.runFrame(i * 34);
    expect(drawn[0]).toBe(96);
    expect(drawn[1]).toBe(96);
    expect(drawn[2]).toBeLessThan(96);
    expect(drawn[3]).toBeLessThan(drawn[2]!);
    expect(reduceWork).toHaveBeenCalled();
    expect(disabled).toHaveBeenCalledOnce();
    expect(h.callbacks.size).toBe(0);
    expect(engine.getMetrics()).toMatchObject({ frames: 5, measuredSteps: 5, p95StepMs: 5 });
    engine.destroy();
  });

  it('resets consecutive slow steps on a changed configuration', () => {
    const h = harness();
    const disabled = vi.fn();
    const engine = new BackdropEngine(h.canvas, h.deps, {
      onAutoDisable: disabled,
      createPattern: () => ({ init() {}, resize() {}, step() {}, destroy() {}, particleCount: 1 }),
    });
    engine.configure({ pattern: 'rain', color: null, intensity: 1, size: 1 });
    engine.start();
    h.setStepDurations(5, 5, 5, 5, 5);
    h.runFrame(34);
    h.runFrame(68);
    engine.configure({ pattern: 'rain', color: '#00ffff', intensity: 1, size: 1 });
    h.runFrame(102);
    h.runFrame(136);
    expect(disabled).not.toHaveBeenCalled();
    h.runFrame(170);
    expect(disabled).toHaveBeenCalledOnce();
    expect(engine.getMetrics().measuredSteps).toBe(5);
    engine.destroy();
  });

  it('bounds timing history while keeping lifetime frame count', () => {
    const h = harness();
    const engine = new BackdropEngine(h.canvas, h.deps);
    engine.configure({ pattern: 'rain', color: null, intensity: 1, size: 1 });
    engine.start();
    for (let i = 1; i <= 2000; i++) h.runFrame(i * 34);
    expect(engine.getMetrics().frames).toBe(2000);
    expect(engine.getMetrics().measuredSteps).toBe(300);
    engine.destroy();
  });

  it('clears on pause and clamps the first resumed step', () => {
    const h = harness();
    const step = vi.fn();
    const engine = new BackdropEngine(h.canvas, h.deps, {
      createPattern: () => ({ init() {}, resize() {}, step, destroy() {}, particleCount: 1 }),
    });
    engine.configure({ pattern: 'rain', color: null, intensity: 1, size: 1 });
    engine.start();
    h.runFrame(34);
    h.context.clearRect.mockClear();
    engine.setSuspended(true);
    expect(h.context.clearRect).toHaveBeenCalledWith(0, 0, 1000, 600);
    engine.setSuspended(false);
    h.runFrame(60000);
    expect(step.mock.calls.at(-1)?.[1]).toBeLessThanOrEqual(100);
    engine.destroy();
  });

  it('does not rebuild on equal config or restart an auto-disabled config', () => {
    const h = harness();
    const destroy = vi.fn();
    const createPattern = vi.fn(() => ({
      init() {},
      resize() {},
      step() {},
      destroy,
      particleCount: 1,
    }));
    const engine = new BackdropEngine(h.canvas, h.deps, { createPattern });
    const options = { pattern: 'rain' as const, color: null, intensity: 1, size: 1 };
    engine.configure(options);
    engine.start();
    h.setStepDurations(5, 5, 5);
    h.runFrame(34);
    engine.configure({ ...options });
    h.runFrame(68);
    h.runFrame(102);
    expect(h.context.clearRect).toHaveBeenCalled();
    engine.configure({ ...options });
    engine.start();
    engine.setSuspended(false);
    expect(h.callbacks.size).toBe(0);
    expect(createPattern).toHaveBeenCalledOnce();
    expect(destroy).not.toHaveBeenCalled();
    engine.configure({ ...options, size: 2 });
    expect(h.callbacks.size).toBe(1);
    engine.destroy();
    engine.configure(options);
    engine.start();
    expect(createPattern).toHaveBeenCalledTimes(2);
    expect(h.callbacks.size).toBe(0);
  });

  it('renders dots once per configure, resize or resume without continuous RAF', () => {
    const h = harness();
    const engine = new BackdropEngine(h.canvas, h.deps);
    engine.configure({ pattern: 'none', color: '#ff0000', intensity: 0.5, size: 1 });
    engine.start();
    expect(h.callbacks.size).toBe(0);

    engine.configure({ pattern: 'dots', color: '#ff0000', intensity: 0.5, size: 1 });
    expect(h.callbacks.size).toBe(1);
    engine.start();
    expect(h.callbacks.size).toBe(1);
    h.runFrame(34);
    expect(h.callbacks.size).toBe(0);
    expect(h.context.clearRect).toHaveBeenCalledTimes(1);
    engine.start();
    expect(h.callbacks.size).toBe(0);
    h.dispatchWindow('resize');
    expect(h.callbacks.size).toBe(1);
    h.runFrame(68);
    expect(h.callbacks.size).toBe(0);
    engine.setSuspended(true);
    engine.setSuspended(false);
    h.runFrame(102);
    expect(h.callbacks.size).toBe(0);
    expect(engine.getMetrics().frames).toBe(3);
    engine.configure({ pattern: 'none', color: null, intensity: 0.5, size: 1 });
    expect(h.callbacks.size).toBe(0);
    expect(h.context.clearRect).toHaveBeenCalledTimes(5);
  });

  it.each([
    'synapse',
    'rain',
    'constellations',
    'perlin-flow',
    'petals',
    'sparkles',
    'embers',
  ] as const)(
    '%s uses a single RAF chain: Synapse at 60Hz, other animations at 30Hz',
    (pattern) => {
      const h = harness();
      const renderer = {
        init: vi.fn(),
        resize: vi.fn(),
        step: vi.fn(),
        destroy: vi.fn(),
        particleCount: 1,
      } satisfies BackdropPattern;
      const engine = new BackdropEngine(h.canvas, h.deps, { createPattern: () => renderer });
      engine.configure({ pattern, color: null, intensity: 0.5, size: 1 });
      engine.start();
      engine.start();
      for (let frame = 1; frame <= 60; frame++) {
        expect(h.callbacks.size).toBe(1);
        h.runFrame((frame * 1000) / 60);
        expect(renderer.step).toHaveBeenCalledTimes(
          pattern === 'synapse' ? frame : Math.floor(frame / 2),
        );
        expect(h.callbacks.size).toBe(1);
      }
      expect(renderer.init).toHaveBeenCalledOnce();
      expect(engine.getMetrics().frames).toBe(pattern === 'synapse' ? 60 : 30);
      engine.destroy();
      expect(h.callbacks.size).toBe(0);
    },
  );

  it('caps DPR and applies the mobile particle factor', () => {
    const desktop = harness();
    const mobile = harness({ mobile: true });
    const desktopEngine = new BackdropEngine(desktop.canvas, desktop.deps);
    const mobileEngine = new BackdropEngine(mobile.canvas, mobile.deps);
    const options = { pattern: 'dots' as const, color: null, intensity: 1, size: 1 };
    desktopEngine.configure(options);
    mobileEngine.configure(options);
    expect(desktopEngine.getMetrics().dpr).toBe(1.5);
    expect(desktop.canvas.width).toBe(1500);
    expect(mobileEngine.getMetrics().particleCount).toBe(
      Math.floor(desktopEngine.getMetrics().particleCount * 0.4),
    );
  });

  it('keeps painting through blur but pauses for hidden, manual policy and reduced motion', () => {
    const h = harness();
    const engine = new BackdropEngine(h.canvas, h.deps);
    engine.configure({ pattern: 'dots', color: null, intensity: 0.5, size: 1 });
    engine.start();
    expect(h.callbacks.size).toBe(1);
    // A blurred window is still on screen (context menu, another app focused),
    // so the backdrop must keep animating instead of freezing.
    h.setFocused(false);
    h.dispatchWindow('blur');
    expect(h.callbacks.size).toBe(1);
    h.setFocused(true);
    h.dispatchWindow('focus');
    expect(h.callbacks.size).toBe(1);
    h.setVisibility('hidden');
    h.dispatchDocument('visibilitychange');
    expect(h.callbacks.size).toBe(0);
    h.setVisibility('visible');
    h.dispatchDocument('visibilitychange');
    expect(h.callbacks.size).toBe(1);
    engine.setSuspended(true);
    expect(h.callbacks.size).toBe(0);
    engine.configure({ pattern: 'dots', color: '#00ffff', intensity: 1, size: 2 });
    expect(h.callbacks.size).toBe(0);
    engine.setSuspended(false);
    expect(h.callbacks.size).toBe(1);
    h.setReducedMotion(true);
    expect(h.callbacks.size).toBe(0);
    h.setReducedMotion(false);
    expect(h.callbacks.size).toBe(1);
    engine.destroy();
    expect([...h.windowListeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
    expect([...h.documentListeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
    expect(h.mediaListeners.size).toBe(0);

    const reduced = harness({ reducedMotion: true });
    const reducedEngine = new BackdropEngine(reduced.canvas, reduced.deps);
    reducedEngine.configure({ pattern: 'dots', color: null, intensity: 0.5, size: 1 });
    reducedEngine.start();
    expect(reduced.callbacks.size).toBe(0);
  });

  it('reports frame metrics and auto-disables after three consecutive steps over 4ms', () => {
    const h = harness();
    const disabled = vi.fn();
    const engine = new BackdropEngine(h.canvas, h.deps, { onAutoDisable: disabled });
    engine.configure({ pattern: 'rain', color: null, intensity: 0.5, size: 1 });
    engine.start();
    h.setStepDurations(5, 5, 5);
    h.runFrame(34);
    h.runFrame(68);
    h.runFrame(102);
    expect(disabled).toHaveBeenCalledOnce();
    expect(h.callbacks.size).toBe(0);
    expect(engine.getMetrics()).toMatchObject({
      frames: 3,
      measuredSteps: 3,
      lastStepMs: 5,
      medianStepMs: 5,
      p95StepMs: 5,
      targetStepMs: 1.5,
    });
  });
});
