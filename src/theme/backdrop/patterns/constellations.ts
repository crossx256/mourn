import type { CanvasContextLike } from '../types';
import { ParticlePattern, wrap } from './types';

export class Constellations extends ParticlePattern {
  constructor() {
    super(0xc057);
  }

  protected draw(context: CanvasContextLike): void {
    const reach = Math.min(420, this.spacing * 1.9);
    const stars = this.points.map((point) => ({
      x: wrap(
        point.x + this.time * point.speed * 3 + Math.sin(this.time * 0.25 + point.phase) * 18,
        this.width,
      ),
      y: wrap(point.y + Math.cos(this.time * 0.2 + point.phase) * 24, this.height),
    }));
    const grid = new Map<string, number[]>();
    stars.forEach((star, index) => {
      const key = `${Math.floor(star.x / reach)},${Math.floor(star.y / reach)}`;
      const bucket = grid.get(key) ?? [];
      bucket.push(index);
      grid.set(key, bucket);
    });
    stars.forEach((star, index) => {
      const point = this.points[index];
      if (!point) return;
      let links = 0;
      const cellX = Math.floor(star.x / reach);
      const cellY = Math.floor(star.y / reach);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const other of grid.get(`${cellX + dx},${cellY + dy}`) ?? []) {
            if (other <= index || links >= Math.ceil(3 * this.detail)) continue;
            const target = stars[other];
            if (!target) continue;
            const distance = Math.hypot(target.x - star.x, target.y - star.y);
            if (distance > reach) continue;
            links++;
            this.ink(context, 0.12 + (1 - distance / reach) * 0.28, 0.8);
            context.beginPath();
            context.moveTo(star.x, star.y);
            context.lineTo(target.x, target.y);
            context.stroke();
          }
        }
      }
      const twinkle = 0.65 + Math.sin(this.time * point.speed + point.phase) * 0.25;
      if (this.detail >= 0.5) this.dot(context, star.x, star.y, 4, twinkle * 0.12);
      this.dot(context, star.x, star.y, 1 + point.speed, twinkle);
    });
  }
}
