import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BackdropPrefs } from '../src/theme/preferences';
import type { BackdropPattern, CanvasContextLike } from '../src/theme/backdrop/types';
import { createBackdropPattern } from '../src/theme/backdrop/factory';
import { seededRandom } from '../src/theme/backdrop/patterns/random';
import { ParticlePattern } from '../src/theme/backdrop/patterns/types';

it('adaptive thinning retains seeds across the phone height instead of discarding the lower rows', () => {
  class Probe extends ParticlePattern {
    constructor() { super(0xf10a); }
    protected draw() {}
    seeds() { return this.points.slice(); }
  }
  const pattern = new Probe();
  pattern.resize(411, 911, 1.5, { pattern: 'perlin-flow', color: '#00ffff', intensity: 0.5, size: 1 }, true);
  const original = pattern.seeds();
  pattern.reduceWork(0.5);
  const survivors = pattern.seeds();
  expect(survivors).toHaveLength(9);
  expect(Math.min(...survivors.map((p) => p.y))).toBeLessThan(911 * 0.25);
  expect(Math.max(...survivors.map((p) => p.y))).toBeGreaterThan(911 * 0.75);
  expect(survivors.every((p) => original.includes(p))).toBe(true);
});

const names = [
  'synapse',
  'rain',
  'constellations',
  'perlin-flow',
  'petals',
  'sparkles',
  'embers',
] as const;
const prefs = (
  pattern: BackdropPrefs['pattern'],
  extra: Partial<BackdropPrefs> = {},
): BackdropPrefs => ({ pattern, color: '#ff0000', intensity: 1, size: 1, ...extra });
type Op = { kind: string; args: number[] };
type Paint = { kind: string; color: unknown; alpha: number; width: number; path: Op[] };
function recorder() {
  const paints: Paint[] = [];
  let path: Op[] = [];
  let clears = 0;
  const op = (kind: string, args: number[]) => path.push({ kind, args });
  const context: CanvasContextLike = {
    clearRect() {
      clears++;
    },
    beginPath() {
      path = [];
    },
    setTransform() {},
    moveTo: (...args) => {
      op('move', args);
    },
    lineTo: (...args) => {
      op('line', args);
    },
    bezierCurveTo: (...args) => {
      op('curve', args);
    },
    closePath: () => {
      op('close', []);
    },
    arc: (...args) => {
      op('arc', args);
    },
    fill() {
      paints.push({ kind: 'fill', color: this.fillStyle, alpha: this.globalAlpha, width: 0, path });
    },
    stroke() {
      paints.push({
        kind: 'stroke',
        color: this.strokeStyle,
        alpha: this.globalAlpha,
        width: this.lineWidth,
        path,
      });
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
  };
  return { context, paints, clearCount: () => clears };
}
function render(options: BackdropPrefs, mobile = false, width = 1200, height = 800) {
  const pattern = createBackdropPattern(options)!;
  expect(pattern).not.toBeNull();
  const output = recorder();
  pattern.init(output.context);
  pattern.resize(width, height, 1.5, options, mobile);
  const frame = (elapsed = 33) => {
    output.paints.length = 0;
    pattern.step(output.context, elapsed);
    return structuredClone(output.paints);
  };
  const first = frame();
  return { pattern, ...output, frame, first };
}
const ops = (paints: Paint[]) => paints.flatMap((paint) => paint.path);
const anchors = (paints: Paint[]) =>
  ops(paints).filter((op) => op.kind === 'move' || op.kind === 'arc');
const length = (paint: Paint) => {
  const a = paint.path[0]?.args,
    b = paint.path.at(-1)?.args;
  return a && b ? Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) : 0;
};

describe.each(names)('%s pattern', (name) => {
  it('renders repeatable seeded finite geometry, then animates without leaving alpha behind', () => {
    const a = render(prefs(name)),
      b = render(prefs(name));
    expect(a.first.length).toBeGreaterThan(0);
    expect(a.first).toEqual(b.first);
    expect(
      ops(a.first)
        .flatMap((op) => op.args)
        .every(Number.isFinite),
    ).toBe(true);
    expect(a.frame()).not.toEqual(a.first);
    expect(a.context.globalAlpha).toBe(1);
    expect(a.clearCount()).toBe(2);
  });

  it('honors color, opacity and size for paths as well as cores', () => {
    const full = render(prefs(name));
    const colored = render(prefs(name, { color: '#00aaff' }));
    expect(colored.first.every((p) => p.color === '#00aaff')).toBe(true);
    expect(render(prefs(name, { color: null })).first.every((p) => p.color === '#ff0000')).toBe(
      true,
    );
    const faint = render(prefs(name, { intensity: 0.25 }));
    expect(faint.pattern.particleCount).toBeLessThan(full.pattern.particleCount);
    expect(Math.max(...faint.first.map((p) => p.alpha))).toBeLessThanOrEqual(0.25);
    const small = render(prefs(name, { size: 0.5 }));
    const large = render(prefs(name, { size: 2 }));
    expect(small.first).not.toEqual(large.first);
    const widths = (paints: Paint[]) =>
      paints.filter((p) => p.kind === 'stroke').map((p) => p.width);
    if (widths(small.first).length) {
      expect(Math.max(...widths(large.first))).toBeGreaterThan(Math.max(...widths(small.first)));
    } else {
      const spread = (paints: Paint[]) =>
        Math.max(
          ...ops(paints)
            .filter((o) => o.kind === 'line')
            .map((o) => Math.abs(o.args[0]! - paints[0]!.path[0]!.args[0]!)),
        );
      expect(spread(large.first)).toBeGreaterThan(spread(small.first));
    }
    const zero = render(prefs(name, { intensity: 0 }));
    expect(zero.pattern.particleCount).toBe(0);
    expect(zero.first).toEqual([]);
  });

  it('spans the mobile viewport at the 38 particle cap and remains bounded on huge viewports', () => {
    const mobile = render(prefs(name), true);
    expect(mobile.pattern.particleCount).toBe(38);
    const positions = anchors(mobile.first);
    for (const [axis, bound] of [
      [0, 1200],
      [1, 800],
    ] as const) {
      const values = positions.map((op) => op.args[axis]!);
      expect(Math.min(...values)).toBeLessThan(bound * 0.25);
      expect(Math.max(...values)).toBeGreaterThan(bound * 0.75);
    }
    const huge = render(prefs(name), false, 100000, 100000);
    expect(huge.pattern.particleCount).toBe(96);
    expect(ops(huge.first).length).toBeLessThan(8000);
    expect(
      ops(huge.first)
        .flatMap((op) => op.args)
        .every(Number.isFinite),
    ).toBe(true);
    expect(render(prefs(name), false, 0, 0).first).toEqual([]);
    const low = prefs(name, { intensity: 0.024 });
    expect(render(low, true).pattern.particleCount).toBe(
      Math.floor(render(low).pattern.particleCount * 0.4),
    );
    const desktop = render(prefs(name));
    desktop.pattern.resize(1200, 800, 3, prefs(name), false);
    expect(desktop.pattern.particleCount).toBe(96);
  });

  it('also fills all four quadrants at a narrow 390x844 phone budget', () => {
    const phone = render(prefs(name), true, 390, 844);
    expect(phone.pattern.particleCount).toBe(37);
    const quadrants = new Set(
      anchors(phone.first)
        .filter(
          (op) => op.args[0]! >= 0 && op.args[0]! <= 390 && op.args[1]! >= 0 && op.args[1]! <= 844,
        )
        .map((op) => `${op.args[0]! < 195 ? 0 : 1},${op.args[1]! < 422 ? 0 : 1}`),
    );
    expect(quadrants.size).toBe(4);
  });

  it('keeps the default intensity populated across the phone viewport', () => {
    const phone = render(prefs(name, { intensity: 0.5 }), true, 390, 844);
    expect(phone.pattern.particleCount).toBe(18);
    const positions = anchors(phone.first);
    for (const [axis, bound] of [
      [0, 390],
      [1, 844],
    ] as const) {
      const values = positions.map((op) => op.args[axis]!);
      expect(Math.min(...values)).toBeLessThan(bound * 0.25);
      expect(Math.max(...values)).toBeGreaterThan(bound * 0.75);
    }
  });

  it('resets deterministically on resize and is inert after destroy', () => {
    const a = render(prefs(name));
    a.frame();
    a.pattern.resize(1200, 800, 1, prefs(name), false);
    expect(a.frame()).toEqual(a.first);
    a.pattern.destroy();
    a.pattern.destroy();
    expect(a.pattern.particleCount).toBe(0);
    expect(a.frame()).toEqual([]);
    a.pattern.resize(1200, 800, 1, prefs(name), false);
    expect(a.frame()).toEqual([]);
  });

  it('reduces real drawing work without resetting particle phase', () => {
    const a = render(prefs(name)),
      b = render(prefs(name));
    const adaptive = a.pattern as BackdropPattern & { reduceWork(ratio: number): void };
    adaptive.reduceWork(0.5);
    expect(a.pattern.particleCount).toBe(48);
    const reduced = a.frame(),
      full = b.frame();
    expect(ops(reduced).length).toBeLessThan(ops(full).length * 0.65);
    // Surviving particles keep their head, rather than restarting at their seed.
    const head = (paints: Paint[]) => {
      if (name === 'perlin-flow') return paints[0]!.path.at(-1)!.args;
      if (['synapse', 'constellations', 'embers'].includes(name))
        return ops(paints).find((op) => op.kind === 'arc')!.args;
      return ops(paints)[0]!.args;
    };
    expect(head(reduced)).toEqual(head(full));
    for (let i = 0; i < 20; i++) adaptive.reduceWork(0.5);
    expect(a.pattern.particleCount).toBe(1);
  });
});

it('Synapse draws rectilinear circuits and fast bright pulses on those circuits', () => {
  const a = render(prefs('synapse'), true);
  const rails = a.first.filter((p) => p.kind === 'stroke' && p.width === 0.7);
  expect(rails.length).toBe(38);
  expect(rails.every((p) => p.path.filter((op) => op.kind === 'line').length === 3)).toBe(true);
  for (const paint of a.first.filter((p) => p.kind === 'stroke')) {
    for (let i = 1; i < paint.path.length; i++) {
      const previous = paint.path[i - 1]!.args,
        current = paint.path[i]!.args;
      expect(current[0] === previous[0] || current[1] === previous[1]).toBe(true);
    }
  }
  const heads = (paints: Paint[]) => ops(paints).filter((op) => op.kind === 'arc');
  const before = heads(a.first),
    after = heads(a.frame(100));
  expect(
    after.some(
      (op, i) =>
        Math.hypot(op.args[0]! - before[i]!.args[0]!, op.args[1]! - before[i]!.args[1]!) > 15,
    ),
  ).toBe(true);
});

it('Rain is long slanted streaks with distinct depth, not dotted tails', () => {
  const a = render(prefs('rain'), true);
  expect(ops(a.first).some((op) => op.kind === 'arc')).toBe(false);
  expect(a.first.every((p) => p.kind === 'stroke' && p.path.length === 2)).toBe(true);
  const lengths = a.first.filter((_, i) => i % 2 === 0).map(length);
  expect(Math.min(...lengths)).toBeGreaterThan(25);
  expect(Math.max(...lengths)).toBeGreaterThan(90);
  expect(new Set(a.first.map((p) => p.width)).size).toBeGreaterThan(10);
});

it('Constellations connects drifting stars with continuous viewport-scale edges', () => {
  const a = render(prefs('constellations'), true);
  const edges = a.first.filter((p) => p.kind === 'stroke');
  expect(edges.length).toBeGreaterThan(25);
  expect(Math.max(...edges.map(length))).toBeGreaterThan(150);
  expect(edges.every((p) => p.path.length === 2)).toBe(true);
  expect(a.frame().filter((p) => p.kind === 'stroke')).not.toEqual(edges);
});

it('Perlin flow draws curved finite wakes with stable per-frame work over long runs', () => {
  const a = render(prefs('perlin-flow'), true);
  expect(a.first.every((p) => p.kind === 'stroke')).toBe(true);
  const firstWake = a.first.slice(1, 25);
  const slopes = firstWake.map((p) => {
    const start = p.path[0]!.args,
      end = p.path[1]!.args;
    return Math.atan2(end[1]! - start[1]!, end[0]! - start[0]!);
  });
  expect(Math.max(...slopes) - Math.min(...slopes)).toBeGreaterThan(0.05);
  for (let i = 0; i < 600; i++) {
    // No historical snapshot is needed here; cloning 570,000 paints tests the recorder,
    // not the renderer's bounded work, and exceeds the suite timeout under parallel load.
    a.paints.length = 0;
    a.pattern.step(a.context, 33);
    const frame = a.paints;
    expect(frame.length).toBe(38 * 25);
    // A wrap must not create a screen-spanning diagonal across the seam.
    expect(Math.max(...frame.filter((p) => p.path.length === 2).map(length))).toBeLessThan(20);
  }
});

it('default flow keeps long coherent ribbons, sparkles stay legible and embers retain halos', () => {
  const flow = render(prefs('perlin-flow', { intensity: 0.5 }), true, 390, 844);
  let frame = flow.first;
  for (let i = 0; i < 75; i++) frame = flow.frame();
  const ribbons = frame.filter((p) => p.path.length === 25);
  expect(ribbons).toHaveLength(18);
  for (const ribbon of ribbons) {
    const vertices = ribbon.path.map((op) => op.args);
    const span = vertices
      .slice(1)
      .reduce(
        (sum, v, i) => sum + Math.hypot(v[0]! - vertices[i]![0]!, v[1]! - vertices[i]![1]!),
        0,
      );
    expect(span).toBeGreaterThan(100);
    expect(ribbon.width).toBe(7);
    expect(ribbon.alpha).toBe(0.08);
  }
  const sparkle = render(prefs('sparkles', { intensity: 0.5 }), true, 390, 844);
  const stars = sparkle.first.filter((p) => p.path.some((op) => op.kind === 'close'));
  expect(stars).toHaveLength(18);
  for (const star of stars) {
    const ys = star.path.filter((op) => op.args.length).map((op) => op.args[1]!);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(14);
    expect(star.alpha).toBeGreaterThanOrEqual(0.2);
  }
  const embers = render(prefs('embers', { intensity: 0.5 }), true, 390, 844);
  const halos = embers.first.filter((p) => p.path[0]?.kind === 'arc');
  expect(halos).toHaveLength(18);
  expect(halos.every((p) => p.path[0]!.args[2]! >= 10 && p.alpha >= 0.03)).toBe(true);
});

it('Petals are closed curved silhouettes that tumble, not overlapping discs', () => {
  const a = render(prefs('petals'), true);
  const shapes = a.first.filter((p) => p.kind === 'fill');
  expect(shapes).toHaveLength(38);
  expect(shapes.every((p) => p.path.map((o) => o.kind).join() === 'move,curve,curve,close')).toBe(
    true,
  );
  expect(ops(a.first).some((op) => op.kind === 'arc')).toBe(false);
  expect(a.frame(100).filter((p) => p.kind === 'fill')).not.toEqual(shapes);
});

it('Sparkles are concave four-point stars whose silhouette and opacity twinkle', () => {
  const a = render(prefs('sparkles'), true);
  const stars = a.first.filter((p) => p.path.some((op) => op.kind === 'close'));
  expect(stars).toHaveLength(38);
  expect(stars.every((p) => p.path.filter((op) => op.kind === 'line').length === 7)).toBe(true);
  const alpha = stars[0]!.alpha;
  expect(a.frame(100)[0]!.alpha).not.toBe(alpha);
});

it('Embers rise with elongated glowing cores and continuous fading wakes', () => {
  const a = render(prefs('embers'), true);
  const before = ops(a.first).find((op) => op.kind === 'arc')!;
  const after = ops(a.frame(100)).find((op) => op.kind === 'arc')!;
  expect(after.args[1]).toBeLessThan(before.args[1]!);
  expect(a.first.filter((p) => p.kind === 'stroke')).toHaveLength(38 * 5);
  expect(a.first.filter((p) => p.path.some((op) => op.kind === 'curve'))).toHaveLength(38);
  expect(new Set(a.first.slice(0, 5).map((p) => p.alpha)).size).toBe(5);
});

it('keeps static dots, zero intensity and none policies intact', () => {
  expect(createBackdropPattern(prefs('none'))).toBeNull();
  const dots = render(prefs('dots'));
  expect(dots.frame()).toEqual(dots.first);
  expect(ops(dots.first).every((op) => op.kind === 'arc')).toBe(true);
  expect(render(prefs('dots', { intensity: 0 })).first).toEqual([]);
});

it('uses independent reproducible seeded RNG streams', () => {
  const a = seededRandom(42),
    b = seededRandom(42),
    c = seededRandom(43);
  const values = Array.from({ length: 1000 }, a);
  expect(values).toEqual(Array.from({ length: 1000 }, b));
  expect(values).not.toEqual(Array.from({ length: 1000 }, c));
  expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
});

it('keeps each pattern within 120 lines, without expensive shadows, scheduling or DOM ownership', () => {
  const directory = new URL('../src/theme/backdrop/patterns/', import.meta.url);
  for (const filename of readdirSync(directory).filter((file) => file.endsWith('.ts'))) {
    const source = readFileSync(new URL(filename, directory), 'utf8');
    expect(source.trimEnd().split('\n').length, filename).toBeLessThanOrEqual(120);
    expect(source, filename).not.toMatch(
      /\b(?:window|document|requestAnimationFrame|cancelAnimationFrame|setTimeout|setInterval|addEventListener|shadowBlur)\b|Math\.random|Date\.now/,
    );
  }
});

it('switches all animations and dots for 4800 frames without stale drawing', () => {
  const output = recorder();
  const retired: BackdropPattern[] = [];
  for (let cycle = 0; cycle < 10; cycle++) {
    for (const name of [...names, 'dots'] as const) {
      const current = createBackdropPattern(prefs(name))!;
      current.init(output.context);
      current.resize(1366, 768, 1.5, prefs(name), cycle % 2 === 1);
      for (let frame = 0; frame < 60; frame++) {
        output.paints.length = 0;
        current.step(output.context, 1000 / 30);
        expect(output.context.globalAlpha).toBe(1);
      }
      output.paints.length = 0;
      for (const old of retired) {
        old.step(output.context, 33);
        expect(old.particleCount).toBe(0);
      }
      expect(output.paints).toEqual([]);
      current.destroy();
      retired.push(current);
    }
  }
});
