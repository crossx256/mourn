import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { useCursorEffect } from '../src/composables/useCursorEffect';
import { useTitleGlitch } from '../src/composables/useTitleGlitch';
import { useRenderingPolicy } from '../src/composables/useRenderingPolicy';

const hooks = vi.hoisted(() => ({
  mounted: [] as (() => void)[],
  unmounted: [] as (() => void)[],
}));
vi.mock('vue', async (original) => ({
  ...(await original<typeof import('vue')>()),
  onMounted: (fn: () => void) => hooks.mounted.push(fn),
  onUnmounted: (fn: () => void) => hooks.unmounted.push(fn),
}));
vi.mock('../src/composables/useRenderingPolicy', async () => {
  const { ref } = await import('vue');
  const animate = ref(true);
  return { useRenderingPolicy: () => ({ animate }) };
});

const animate = useRenderingPolicy().animate;
let scope = effectScope();
let frames: Map<number, FrameRequestCallback>;
let serial = 0;
let events: EventTarget;
let clear: ReturnType<typeof vi.fn>;
let container: { style: { cursor: string } };

beforeEach(() => {
  vi.useFakeTimers();
  hooks.mounted.length = 0;
  hooks.unmounted.length = 0;
  scope = effectScope();
  // The mock intentionally exposes a writable ref.
  (animate as ReturnType<typeof ref<boolean>>).value = true;
  frames = new Map();
  events = new EventTarget();
  clear = vi.fn();
  container = { style: { cursor: '' } };
  const context = new Proxy(
    { clearRect: clear },
    {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : vi.fn()),
    },
  );
  vi.stubGlobal('window', Object.assign(events, { innerWidth: 1200, innerHeight: 800 }));
  vi.stubGlobal('document', {
    title: 'original',
    body: { appendChild: vi.fn() },
    querySelector: () => container,
    createElement: () => ({ style: {}, getContext: () => context }),
  });
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      complete = true;
      naturalWidth = 12;
    },
  );
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    frames.set(++serial, fn);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});

afterEach(() => {
  hooks.unmounted.forEach((fn) => fn());
  scope.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function frame(time: number) {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((fn) => fn(time));
}
function move() {
  events.dispatchEvent(Object.assign(new Event('mousemove'), { clientX: 20, clientY: 30 }));
}

describe('decorative rendering lifecycle', () => {
  it('stops an empty cursor loop, coalesces input and tears down disabled effects', async () => {
    const profile = ref({ cursorEffect: 'cursor-trail' });
    scope.run(() => useCursorEffect(profile));
    hooks.mounted.forEach((fn) => fn());
    expect(frames.size).toBe(1);
    frame(17);
    expect(frames.size).toBe(0);
    for (let i = 0; i < 1000; i++) move();
    expect(frames.size).toBe(1);
    for (let i = 2; i < 60; i++) frame(i * 17);
    expect(frames.size).toBe(0);
    expect(container.style.cursor).toBe('');
    profile.value.cursorEffect = 'none';
    await nextTick();
    move();
    expect(frames.size).toBe(0);
  });

  it('cancels pending cursor work when rendering is suspended and resumes once', async () => {
    scope.run(() => useCursorEffect(ref({ cursorEffect: 'bubbles' })));
    hooks.mounted.forEach((fn) => fn());
    (animate as ReturnType<typeof ref<boolean>>).value = false;
    await nextTick();
    expect(frames.size).toBe(0);
    move();
    expect(frames.size).toBe(0);
    (animate as ReturnType<typeof ref<boolean>>).value = true;
    await nextTick();
    expect(frames.size).toBe(1);
  });

  it('suspends title timers, displays the full title and respects explicit stop', async () => {
    const effect = scope.run(() => useTitleGlitch({ title: 'mourn', delay: () => 1 }))!;
    hooks.mounted.forEach((fn) => fn());
    vi.advanceTimersByTime(79);
    expect(document.title).toBe('original');
    vi.advanceTimersByTime(1);
    expect(document.title).not.toBe('original');
    (animate as ReturnType<typeof ref<boolean>>).value = false;
    await nextTick();
    expect(document.title).toBe('mourn');
    expect(vi.getTimerCount()).toBe(0);
    effect.stop();
    (animate as ReturnType<typeof ref<boolean>>).value = true;
    await nextTick();
    expect(document.title).toBe('original');
    expect(vi.getTimerCount()).toBe(0);
  });
});
