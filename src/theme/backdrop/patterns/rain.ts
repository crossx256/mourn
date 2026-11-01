import type { CanvasContextLike } from '../types';
import { ParticlePattern, wrap } from './types';

export class Rain extends ParticlePattern {
  constructor() {
    super(0x7a19);
  }

  protected draw(context: CanvasContextLike): void {
    for (const point of this.points) {
      const depth = (point.speed - 0.5) / 1;
      const length = (28 + depth * 82) * this.options.size;
      const fall = this.time * (160 + depth * 440);
      const y = wrap(point.y + fall, this.height + length) - length;
      const x = wrap(point.x + fall * 0.16, this.width + length * 0.16);
      // Two continuous strokes give a dim long exposure and a bright leading edge.
      this.ink(context, 0.22 + depth * 0.32, 0.65 + depth * 1.25);
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + length * 0.16, y + length);
      context.stroke();
      if (this.detail < 0.5) continue;
      this.ink(context, 0.45 + depth * 0.4, 0.65 + depth * 0.9);
      context.beginPath();
      context.moveTo(x + length * 0.12, y + length * 0.75);
      context.lineTo(x + length * 0.16, y + length);
      context.stroke();
    }
  }
}
