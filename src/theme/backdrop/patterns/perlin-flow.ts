import type { CanvasContextLike } from '../types';
import { seededRandom } from './random';
import { ParticlePattern, wrap, type Particle } from './types';

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
type Vertex = { x: number; y: number };

export class PerlinFlow extends ParticlePattern {
  private readonly gradients: number[];
  private readonly wakes = new WeakMap<Particle, Vertex[]>();

  constructor() {
    super(0xf10a);
    const random = seededRandom(0x9e21);
    this.gradients = Array.from({ length: 256 }, () => random() * Math.PI * 2);
  }

  private noise(x: number, y: number): number {
    const ix = Math.floor(x),
      iy = Math.floor(y);
    const fx = x - ix,
      fy = y - iy;
    const gradient = (dx: number, dy: number) => {
      const angle = this.gradients[((ix + dx) * 37 + (iy + dy) * 101) & 255] ?? 0;
      return Math.cos(angle) * (fx - dx) + Math.sin(angle) * (fy - dy);
    };
    return mix(
      mix(gradient(0, 0), gradient(1, 0), fade(fx)),
      mix(gradient(0, 1), gradient(1, 1), fade(fx)),
      fade(fy),
    );
  }

  private position(point: Particle, time: number): Vertex {
    const t = time * this.options.size;
    // Advect anchored seeds through a smooth displacement field, avoiding attractor clumps.
    return {
      x: point.x + t * 165 + this.noise(point.x / 180 + t * 0.3, point.y / 180) * 90,
      y: point.y + this.noise(point.x / 180, point.y / 180 + t * 0.6) * 130,
    };
  }

  protected draw(context: CanvasContextLike): void {
    for (const point of this.points) {
      let wake = this.wakes.get(point);
      const next = this.position(point, this.time);
      if (!wake) {
        // Pre-roll a finite wake so the first frame is a stream, not a field of dots.
        wake = Array.from({ length: 25 }, (_, i) => this.position(point, this.time - i / 30));
        this.wakes.set(point, wake);
      } else {
        wake.unshift(next);
        wake.length = Math.min(wake.length, 25);
      }
      const ox = wrap(next.x, this.width) - next.x;
      const oy = wrap(next.y, this.height) - next.y;
      const stride = this.detail < 0.5 ? 3 : this.detail < 1 ? 2 : 1;
      this.ink(context, 0.16, 7);
      context.beginPath();
      const tail = wake[wake.length - 1];
      if (tail) context.moveTo(tail.x + ox, tail.y + oy);
      for (let i = wake.length - 1 - stride; i >= 0; i -= stride) {
        const vertex = wake[i];
        if (vertex) context.lineTo(vertex.x + ox, vertex.y + oy);
      }
      context.stroke();
      for (let i = wake.length - 1; i >= stride; i -= stride) {
        const a = wake[i],
          b = wake[i - stride];
        if (!a || !b) continue;
        this.ink(context, 0.25 + (1 - i / wake.length) * 0.7, 2.8);
        context.beginPath();
        context.moveTo(a.x + ox, a.y + oy);
        context.lineTo(b.x + ox, b.y + oy);
        context.stroke();
      }
    }
  }
}
