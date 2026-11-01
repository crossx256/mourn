import type { CanvasContextLike } from '../types';
import { ParticlePattern, wrap } from './types';

export class Embers extends ParticlePattern {
  constructor() {
    super(0xe8be);
  }

  protected draw(context: CanvasContextLike): void {
    for (const point of this.points) {
      const speed = 32 + point.speed * 48;
      const y = wrap(point.y - this.time * speed, this.height);
      const sway = (t: number) => Math.sin(point.phase + t * point.speed * 1.5) * 28;
      const x = wrap(point.x + sway(this.time), this.width);
      const heat = 0.55 + (0.45 * y) / this.height;
      const flicker = 0.8 + Math.sin(point.phase + this.time * 11) * 0.2;
      const radius = (2 + point.speed * 1.3) * this.options.size;
      const segments = Math.max(2, Math.ceil(5 * this.detail));
      for (let i = segments; i > 0; i--) {
        const age = (i / segments) * 1.05 * this.options.size;
        const previous = ((i - 1) / segments) * 1.05 * this.options.size;
        this.ink(context, heat * flicker * (1 - i / (segments + 1)) * 0.85, 2.2);
        context.beginPath();
        context.moveTo(x + sway(this.time - age) - sway(this.time), y + age * speed);
        context.lineTo(x + sway(this.time - previous) - sway(this.time), y + previous * speed);
        context.stroke();
      }
      // Broad translucent halo + compact hot core, with no shadow/filter cost.
      this.dot(context, x, y, (radius / this.options.size) * 4, heat * flicker * 0.22);
      this.ink(context, heat * flicker);
      context.beginPath();
      context.moveTo(x, y - radius * 2);
      context.bezierCurveTo(x + radius * 1.5, y, x + radius, y + radius, x, y + radius);
      context.bezierCurveTo(x - radius, y + radius, x - radius, y, x, y - radius * 2);
      context.fill();
    }
  }
}
