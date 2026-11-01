import type { CanvasContextLike } from '../types';
import { ParticlePattern, wrap } from './types';

export class Petals extends ParticlePattern {
  constructor() {
    super(0x9e7a);
  }

  protected draw(context: CanvasContextLike): void {
    for (const point of this.points) {
      const angle = point.phase + this.time * point.speed;
      const size = (7 + point.speed * 4) * this.options.size;
      const x = wrap(point.x + this.time * 23 + Math.sin(angle) * 36, this.width);
      const y = wrap(point.y + this.time * (24 + point.speed * 20), this.height);
      const length = size * (0.8 + Math.sin(angle * 0.7) * 0.2);
      const breadth = size * (0.15 + Math.abs(Math.cos(angle * 1.3)) * 0.55);
      // Local basis models axial rotation and edge-on tumbling without canvas transforms.
      const vertex = (u: number, v: number): [number, number] => [
        x + Math.cos(angle) * u - Math.sin(angle) * v,
        y + Math.sin(angle) * u + Math.cos(angle) * v,
      ];
      this.ink(context, 0.4 + 0.3 * Math.abs(Math.cos(angle)));
      context.beginPath();
      context.moveTo(...vertex(-length, 0));
      context.bezierCurveTo(
        ...vertex(-length * 0.3, -breadth),
        ...vertex(length * 0.9, -breadth),
        ...vertex(length, 0),
      );
      context.bezierCurveTo(
        ...vertex(length * 0.2, breadth * 1.5),
        ...vertex(-length * 0.7, breadth),
        ...vertex(-length, 0),
      );
      context.closePath();
      context.fill();
      if (this.detail < 0.5) continue;
      this.ink(context, 0.35, 0.65);
      context.beginPath();
      context.moveTo(...vertex(-length * 0.7, 0));
      context.lineTo(...vertex(length * 0.7, 0));
      context.stroke();
    }
  }
}
