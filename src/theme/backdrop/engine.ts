import type { BackdropPrefs } from '../preferences';
import { createBackdropPattern } from './factory';
import type { BackdropDependencies, BackdropMetrics, BackdropPattern, CanvasLike } from './types';

const FRAME_INTERVAL = 1000 / 30;
const TARGET_STEP_MS = 1.5;
const SLOW_STEP_MS = 4;

export interface BackdropEngineCallbacks {
  onAutoDisable?(): void;
  createPattern?(options: BackdropPrefs): BackdropPattern | null;
}

export class BackdropEngine {
  private options: BackdropPrefs = { pattern: 'none', color: null, intensity: 0.5, size: 1 };
  private pattern: BackdropPattern | null = null;
  private frameId: number | null = null;
  private running = false;
  private autoDisabled = false;
  private lastFrameAt = 0;
  private staticDirty = true;
  private lastStepAt: number | null = null;
  private suspended = false;
  private destroyed = false;
  private slowSteps = 0;
  private frames = 0;
  private stepTimes: number[] = [];
  private readonly context;
  private readonly reducedMotion;

  constructor(
    private readonly canvas: CanvasLike,
    private readonly deps: BackdropDependencies,
    private readonly callbacks: BackdropEngineCallbacks = {},
  ) {
    this.context = canvas.getContext('2d');
    this.reducedMotion = deps.window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion.addEventListener('change', this.syncPauseState);
    deps.window.addEventListener('focus', this.syncPauseState);
    deps.window.addEventListener('blur', this.syncPauseState);
    deps.window.addEventListener('resize', this.resize);
    deps.document.addEventListener('visibilitychange', this.syncPauseState);
  }

  configure(options: BackdropPrefs): void {
    if (this.destroyed) return;
    if (
      Object.keys(this.options).every(
        (key) => this.options[key as keyof BackdropPrefs] === options[key as keyof BackdropPrefs],
      )
    )
      return;
    this.autoDisabled = false;
    this.slowSteps = 0;
    this.lastStepAt = null;
    this.lastFrameAt = 0;
    this.options = { ...options };
    const hadPattern = this.pattern !== null;
    this.pattern?.destroy();
    this.pattern =
      options.pattern === 'none'
        ? null
        : this.callbacks.createPattern
          ? this.callbacks.createPattern(options)
          : createBackdropPattern(options);
    if (this.pattern && this.context) this.pattern.init(this.context);
    if (hadPattern && !this.pattern && this.context) {
      this.context.clearRect(0, 0, this.deps.window.innerWidth, this.deps.window.innerHeight);
    }
    this.resize();
    if (!this.pattern) this.cancelFrame();
    else if (this.running) this.syncPauseState();
  }

  start(): void {
    if (this.destroyed || this.autoDisabled) return;
    this.running = true;
    this.syncPauseState();
  }

  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    this.syncPauseState();
  }

  stop(): void {
    this.running = false;
    this.cancelFrame();
    this.clearCanvas();
    this.staticDirty = true;
    this.lastStepAt = null;
    this.lastFrameAt = 0;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
    this.pattern?.destroy();
    this.pattern = null;
    this.deps.window.removeEventListener('focus', this.syncPauseState);
    this.deps.window.removeEventListener('blur', this.syncPauseState);
    this.deps.window.removeEventListener('resize', this.resize);
    this.deps.document.removeEventListener('visibilitychange', this.syncPauseState);
    this.reducedMotion.removeEventListener('change', this.syncPauseState);
  }

  getMetrics(): BackdropMetrics {
    const sorted = [...this.stepTimes].sort((a, b) => a - b);
    const percentile = (ratio: number) =>
      sorted.length === 0 ? 0 : (sorted[Math.ceil(sorted.length * ratio) - 1] ?? 0);
    return {
      frames: this.frames,
      measuredSteps: this.stepTimes.length,
      lastStepMs: this.stepTimes.at(-1) ?? 0,
      medianStepMs: percentile(0.5),
      p95StepMs: percentile(0.95),
      targetStepMs: TARGET_STEP_MS,
      particleCount: this.pattern?.particleCount ?? 0,
      dpr: Math.min(this.deps.window.devicePixelRatio || 1, 1.5),
    };
  }

  private readonly resize = (): void => {
    if (!this.pattern || !this.context) return;
    const width = this.deps.window.innerWidth;
    const height = this.deps.window.innerHeight;
    const dpr = Math.min(this.deps.window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.pattern.resize(width, height, dpr, this.options, this.deps.mobile === true);
    this.staticDirty = true;
    if (this.running) this.syncPauseState();
  };

  private readonly syncPauseState = (): void => {
    // Pause only when the page is genuinely not visible. A blurred window still
    // paints (the window stays on screen while a context menu or another app has
    // focus), so pausing on focus loss froze the backdrop for no CPU saving.
    const paused =
      this.destroyed ||
      this.suspended ||
      this.deps.document.visibilityState === 'hidden' ||
      this.reducedMotion.matches;
    if (paused) {
      this.cancelFrame();
      this.clearCanvas();
      this.lastFrameAt = 0;
      this.lastStepAt = null;
      this.staticDirty = true;
    } else this.queueFrame();
  };

  private queueFrame(): void {
    if (this.options.pattern === 'dots' && !this.staticDirty) return;
    if (
      this.frameId !== null ||
      !this.running ||
      !this.pattern ||
      this.destroyed ||
      this.autoDisabled ||
      !this.context
    )
      return;
    this.frameId = this.deps.requestAnimationFrame(this.onFrame);
  }

  private clearCanvas(): void {
    this.context?.clearRect(0, 0, this.deps.window.innerWidth, this.deps.window.innerHeight);
  }

  private cancelFrame(): void {
    if (this.frameId === null) return;
    this.deps.cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  private readonly onFrame: FrameRequestCallback = (timestamp) => {
    this.frameId = null;
    if (!this.running || !this.pattern || !this.context) return;
    const elapsed = timestamp - this.lastFrameAt;
    if (
      this.options.pattern === 'dots' ||
      this.options.pattern === 'synapse' ||
      elapsed + 0.001 >= FRAME_INTERVAL
    ) {
      this.staticDirty = false;
      // Retain phase rather than drifting to the next display frame (~20Hz at 60Hz).
      this.lastFrameAt += Math.floor((elapsed + 0.001) / FRAME_INTERVAL) * FRAME_INTERVAL;
      const stepElapsed = this.lastStepAt === null ? FRAME_INTERVAL : timestamp - this.lastStepAt;
      this.lastStepAt = timestamp;
      const startedAt = this.deps.now();
      this.pattern.step(this.context, Math.max(0, Math.min(100, stepElapsed)));
      const stepMs = Math.max(0, this.deps.now() - startedAt);
      this.frames++;
      if (this.stepTimes.length === 300) this.stepTimes.shift();
      this.stepTimes.push(stepMs);
      if (stepMs > SLOW_STEP_MS) this.slowSteps++;
      else this.slowSteps = 0;
      if (this.slowSteps >= 3) {
        this.autoDisabled = true;
        this.clearCanvas();
        this.callbacks.onAutoDisable?.();
        return;
      }
      if (stepMs > TARGET_STEP_MS) {
        // Canvas calls cannot be interrupted; reduce the next step, never its recorded cost.
        const adaptive = this.pattern as BackdropPattern & { reduceWork?(ratio: number): void };
        adaptive.reduceWork?.(Math.max(0.25, Math.min(0.75, TARGET_STEP_MS / stepMs)));
      }
    }
    this.syncPauseState();
  };
}
