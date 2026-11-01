import type { BackdropPrefs } from '../preferences';
import type { BackdropPattern, CanvasContextLike } from './types';

export class StaticDots implements BackdropPattern {
  private width = 0;
  private height = 0;
  private options: BackdropPrefs = { pattern: 'none', color: null, intensity: 0.5, size: 1 };
  private points: Array<{ x: number; y: number }> = [];

  get particleCount(): number {
    return this.points.length;
  }

  init(): void {
    // Static dots need no one-time canvas setup.
  }

  resize(
    width: number,
    height: number,
    _dpr: number,
    options: BackdropPrefs,
    mobile: boolean,
  ): void {
    this.width = width;
    this.height = height;
    this.options = options;
    const spacing = Math.max(24, 72 / options.size);
    const budget = options.intensity <= 0 ? 0 : Math.floor((width * height) / (spacing * spacing));
    const cap = Math.floor(budget * (mobile ? 0.4 : 1));
    this.points = Array.from({ length: cap }, (_, index) => ({
      x: (index * spacing * 1.618) % width || spacing / 2,
      y: (index * spacing * 2.414) % height || spacing / 2,
    }));
  }

  step(context: CanvasContextLike): void {
    context.clearRect(0, 0, this.width, this.height);
    context.fillStyle = this.options.color ?? '#ff0000';
    context.globalAlpha = 0.08 + this.options.intensity * 0.32;
    for (const point of this.points) {
      context.beginPath();
      context.arc(point.x, point.y, this.options.size, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  destroy(): void {
    this.points = [];
  }
}
