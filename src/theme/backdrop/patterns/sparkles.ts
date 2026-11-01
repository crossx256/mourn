import type { CanvasContextLike } from '../types';
import { ParticlePattern } from './types';

export class Sparkles extends ParticlePattern {
  constructor() {
    super(0x59a2);
  }

  protected draw(context: CanvasContextLike): void {
    for (const point of this.points) {
      const wave = (1 + Math.sin(point.phase + this.time * point.speed * 2.5)) / 2;
      const glow = wave * wave;
      const radius = (7 + glow * 15) * this.options.size;
      const waist = radius * 0.18;
      this.ink(context, 0.4 + glow * 0.6);
      context.beginPath();
      context.moveTo(point.x, point.y - radius);
      context.lineTo(point.x + waist, point.y - waist);
      context.lineTo(point.x + radius * 0.7, point.y);
      context.lineTo(point.x + waist, point.y + waist);
      context.lineTo(point.x, point.y + radius);
      context.lineTo(point.x - waist, point.y + waist);
      context.lineTo(point.x - radius * 0.7, point.y);
      context.lineTo(point.x - waist, point.y - waist);
      context.closePath();
      context.fill();
      if (this.detail < 0.5) continue;
      this.dot(context, point.x, point.y, 0.8 + glow, 0.6 + glow * 0.4);
    }
  }
}
