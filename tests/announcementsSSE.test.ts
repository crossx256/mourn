// tests/announcementsSSE.test.ts
// CS-11: the announcements SSE store must not run its own reconnect timer on
// top of the native EventSource retry, and it must retry immediately when the
// document becomes visible again after a dropped connection.
//
// The store is driven for real with a minimal EventSource shim; only the timers
// are faked so the reconnect window is observable.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { toRaw } from 'vue';

interface ShimSource {
  url: string;
  closed: boolean;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  listeners: Record<string, Array<(ev: MessageEvent) => void>>;
  emitOpen(): void;
  emitError(): void;
  emit(event: string, data: unknown): void;
}

const sources: ShimSource[] = [];

class FakeEventSource implements ShimSource {
  closed = false;
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners: Record<string, Array<(ev: MessageEvent) => void>> = {};

  constructor(public url: string) {
    sources.push(this);
  }

  addEventListener(event: string, handler: (ev: MessageEvent) => void) {
    (this.listeners[event] ||= []).push(handler);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  emitOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  emitError() {
    // The browser's own retry keeps the source CONNECTING after a transport error.
    this.readyState = 0;
    this.onerror?.();
  }

  emit(event: string, data: unknown) {
    for (const handler of this.listeners[event] || []) {
      handler({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

const windowListeners = new Map<string, Set<() => void>>();
const fakeWindow = {
  location: { href: 'https://localhost/' },
  addEventListener: (type: string, fn: () => void) => {
    if (!windowListeners.has(type)) windowListeners.set(type, new Set());
    windowListeners.get(type)!.add(fn);
  },
  removeEventListener: (type: string, fn: () => void) => {
    windowListeners.get(type)?.delete(fn);
  },
};

function dispatchWindow(type: string) {
  for (const fn of [...(windowListeners.get(type) || [])]) fn();
}

const fakeDocument = {
  visibilityState: 'visible' as DocumentVisibilityState,
  addEventListener: (type: string, fn: () => void) => {
    if (!windowListeners.has(type)) windowListeners.set(type, new Set());
    windowListeners.get(type)!.add(fn);
  },
  removeEventListener: (type: string, fn: () => void) => {
    windowListeners.get(type)?.delete(fn);
  },
};

function setVisibility(state: DocumentVisibilityState) {
  fakeDocument.visibilityState = state;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  sources.length = 0;
  windowListeners.clear();
  setVisibility('visible');
  setActivePinia(createPinia());
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', fakeDocument);
  // The source checks `'EventSource' in window`, so the shim has to live on the
  // (stubbed) window object as well as on globalThis.
  (fakeWindow as unknown as Record<string, unknown>).EventSource = FakeEventSource;
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('setTimeout', setTimeout);
  vi.stubGlobal('clearTimeout', clearTimeout);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function store() {
  const { useAnnouncementsStore } = await import('../src/stores/announcements');
  return useAnnouncementsStore();
}

describe('CS-11 announcements SSE reconnect ownership', () => {
  it('does not close the stream or arm its own timer when the native retry is in charge', async () => {
    const announcements = await store();
    announcements.connectSSE();
    expect(sources).toHaveLength(1);
    const es = sources[0];
    es.emitOpen();
    expect(announcements.connected).toBe(true);

    es.emitError();

    // The native EventSource owns the reconnect: no app timer, and the stream is
    // left alone so the browser can retry the same connection.
    expect(vi.getTimerCount()).toBe(0);
    expect(es.closed).toBe(false);
    expect(toRaw(announcements._eventSource)).toBe(es);
    expect(announcements.connected).toBe(false);

    // A native retry that succeeds restores the connection on the same stream.
    es.emitOpen();
    expect(announcements.connected).toBe(true);
    expect(sources).toHaveLength(1);
  });

  it('reconnects immediately when the document becomes visible after a drop', async () => {
    const announcements = await store();
    announcements.connectSSE();
    const first = sources[0];
    first.emitOpen();
    first.emitError();
    // Simulate the native retry giving up: the stream is closed for good.
    first.close();

    dispatchWindow('visibilitychange');

    expect(sources).toHaveLength(2);
    expect(toRaw(announcements._eventSource)).toBe(sources[1]);

    const second = sources[1];
    second.emitOpen();
    expect(announcements.connected).toBe(true);

    // A visible document with a live stream must not open another one.
    dispatchWindow('visibilitychange');
    expect(sources).toHaveLength(2);
  });

  it('stays quiet while the document is hidden', async () => {
    const announcements = await store();
    announcements.connectSSE();
    const es = sources[0];
    es.emitError();
    es.close();

    setVisibility('hidden');
    dispatchWindow('visibilitychange');
    expect(sources).toHaveLength(1);
  });

  it('leaves the native retry alone while offline, then reconnects on the online event', async () => {
    const announcements = await store();
    announcements.connectSSE();
    const es = sources[0];
    es.emitOpen();
    vi.stubGlobal('navigator', { onLine: false });
    es.emitError();
    // Still the native retry's job: no app timer, no app-side close.
    expect(es.closed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(sources).toHaveLength(1);

    // The native retry gave up: keep the (already closed) stream so the
    // visibility check can tell it is dead, but wait for `online` rather than
    // burning a timer dialling into a dead network.
    es.emitError();
    expect(sources).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);

    // The native retry gave up: keep the (already dead) stream so the
    // visibility check can tell, but wait for `online` rather than burning a
    // timer dialling into a dead network.
    es.close();
    dispatchWindow('offline');
    expect(sources).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);

    vi.stubGlobal('navigator', { onLine: true });
    // Either trigger (a new connectSSE, or the online event itself) re-dials at
    // most one fresh stream.
    announcements.connectSSE();
    expect(sources).toHaveLength(2);
    dispatchWindow('online');
    expect(sources).toHaveLength(2);
  });

  it('stops listening for visibility once disconnected', async () => {
    const announcements = await store();
    announcements.connectSSE();
    announcements.disconnectSSE();
    expect(sources[0].closed).toBe(true);

    dispatchWindow('visibilitychange');
    expect(sources).toHaveLength(1);
  });
});
