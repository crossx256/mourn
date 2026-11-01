import type { BackdropPrefs } from '../../preferences';
import type { BackdropPattern, CanvasContextLike } from '../types';
import { seededRandom } from './random';

export interface Particle {
  x: number;
  y: number;
  phase: number;
  speed: number;
}
export const wrap = (value: number, bound: number): number => ((value % bound) + bound) % bound;

export abstract class ParticlePattern implements BackdropPattern {
  protected width = 0;
  protected height = 0;
  protected time = 0;
  protected detail = 1;
  protected spacing = 0;
  protected points: Particle[] = [];
  protected options: BackdropPrefs = { pattern: 'none', color: null, intensity: 0, size: 1 };
  private destroyed = false;

  constructor(
    private readonly seed: number,
    private readonly cap = 96,
  ) {}
  get particleCount(): number {
    return this.points.length;
  }
  init(): void {}

  resize(
    width: number,
    height: number,
    _dpr: number,
    options: BackdropPrefs,
    mobile: boolean,
  ): void {
    if (this.destroyed) return;
    this.width = Number.isFinite(width) ? Math.max(0, width) : 0;
    this.height = Number.isFinite(height) ? Math.max(0, height) : 0;
    this.options = { ...options };
    this.time = 0;
    this.detail = 1;
    const budget = Math.min(this.cap, 96, Math.floor((this.width * this.height) / 3500));
    const count = Math.floor(Math.floor(budget * options.intensity) * (mobile ? 0.4 : 1));
    this.spacing = Math.sqrt((this.width * this.height) / Math.max(1, count));
    const random = seededRandom(this.seed);
    const columns = Math.max(
      1,
      Math.ceil(Math.sqrt((count * this.width) / Math.max(1, this.height))),
    );
    const rows = Math.max(1, Math.ceil(count / columns));
    this.points = Array.from({ length: count }, (_, index) => ({
      x: (((index % columns) + 0.15 + random() * 0.7) / columns) * this.width,
      y: ((Math.floor(index / columns) + 0.15 + random() * 0.7) / rows) * this.height,
      phase: random() * Math.PI * 2,
      speed: 0.5 + random(),
    }));
  }

  // Optional engine contract: shrink future work in place, preserving particle phase.
  reduceWork(ratio: number): void {
    if (this.destroyed || !Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) return;
    const previous = this.points;
    const count = Math.min(previous.length, Math.max(1, Math.floor(previous.length * ratio)));
    // Seeds are row-stratified. Truncating the array erases the bottom of the screen;
    // sample across it instead, retaining each survivor's phase and bounded wake.
    this.points = Array.from({ length: count }, (_, i) =>
      previous[count === 1 ? 0 : Math.floor(i * (previous.length - 1) / (count - 1))]!,
    );
    this.detail = Math.max(0.25, this.detail * ratio);
  }

  step(context: CanvasContextLike, elapsedMs: number): void {
    if (this.destroyed) return;
    this.time += Number.isFinite(elapsedMs) ? Math.max(0, Math.min(100, elapsedMs)) / 1000 : 0;
    context.clearRect(0, 0, this.width, this.height);
    context.fillStyle = this.options.color ?? '#ff0000';
    context.strokeStyle = context.fillStyle;
    try {
      if (this.points.length) this.draw(context);
    } finally {
      context.globalAlpha = 1;
    }
  }

  protected dot(context: CanvasContextLike, x: number, y: number, radius: number, alpha = 1): void {
    context.globalAlpha = this.options.intensity * Math.max(0, Math.min(1, alpha));
    context.beginPath();
    context.arc(
      wrap(x, this.width),
      wrap(y, this.height),
      radius * this.options.size,
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  protected ink(context: CanvasContextLike, alpha: number, width = 1): void {
    context.globalAlpha = this.options.intensity * Math.max(0, Math.min(1, alpha));
    context.lineWidth = width * this.options.size;
  }

  protected abstract draw(context: CanvasContextLike): void;
  destroy(): void {
    this.points = [];
    this.time = 0;
    this.destroyed = true;
  }
}
