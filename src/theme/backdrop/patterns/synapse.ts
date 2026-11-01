import type { CanvasContextLike } from '../types';
import { ParticlePattern, wrap } from './types';

export class Synapse extends ParticlePattern {
  constructor() {
    super(0x51a9);
  }

  protected draw(context: CanvasContextLike): void {
    const cell = Math.max(12, Math.min(100, this.width / 8, this.height / 6, this.spacing * 0.6));
    for (const point of this.points) {
      const x = Math.floor(point.x / cell) * cell;
      const y = Math.floor(point.y / cell) * cell;
      const direction = x < this.width / 2 ? 1 : -1;
      const horizontal = Math.min(
        cell * (1 + Math.floor(point.speed * 2)),
        (direction > 0 ? this.width - x : x) / 2,
      );
      const vertical =
        cell * (y < cell ? 1 : y > this.height - cell * 2 ? -1 : point.phase < Math.PI ? 1 : -1);
      const length = horizontal * 2 + Math.abs(vertical);
      const vertices = [
        [x, y],
        [x + horizontal * direction, y],
        [x + horizontal * direction, y + vertical],
        [x + horizontal * 2 * direction, y + vertical],
      ] as const;
      const stops = [0, horizontal, horizontal + Math.abs(vertical), length];
      const at = (distance: number): [number, number] =>
        distance < horizontal
          ? [x + distance * direction, y]
          : distance < horizontal + Math.abs(vertical)
            ? [x + horizontal * direction, y + Math.sign(vertical) * (distance - horizontal)]
            : [x + (distance - Math.abs(vertical)) * direction, y + vertical];
      this.ink(context, 0.14, 0.7);
      context.beginPath();
      context.moveTo(x, y);
      for (const vertex of vertices.slice(1)) context.lineTo(...vertex);
      context.stroke();
      const head = wrap(
        (point.phase / (Math.PI * 2)) * length + this.time * (180 + point.speed * 120),
        length,
      );
      const wake = Math.min(length * 0.65, 90 * this.options.size);
      const bands = Math.max(2, Math.ceil(5 * this.detail));
      for (let band = 0; band < bands; band++) {
        const end = head - (band / bands) * wake;
        const start = Math.max(0, head - ((band + 1) / bands) * wake);
        if (end <= 0) continue;
        this.ink(context, 0.9 * (1 - band / bands), 2.4);
        context.beginPath();
        context.moveTo(...at(start));
        // Include every corner crossed by the wake: never cut diagonally across a circuit.
        for (let corner = 1; corner < 3; corner++) {
          const distance = stops[corner];
          const vertex = vertices[corner];
          if (distance !== undefined && vertex && distance > start && distance < end) {
            context.lineTo(...vertex);
          }
        }
        context.lineTo(...at(end));
        context.stroke();
      }
      const [hx, hy] = at(head);
      this.dot(context, hx, hy, 1.6, 1);
    }
  }
}
