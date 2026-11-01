// tests/transportHandshake.test.ts
// A WebSocket that never finishes opening is the one thing in vault
// initialization with no bound of its own: the browser keeps it CONNECTING, the
// promise never settles, and the messaging page sits on "SYNCING ACROSS
// DEVICES" forever. This guards the bound.
//
// Run: npx vitest run tests/transportHandshake.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VaultTransport } from '../src/crypto/transport';

class NeverOpeningSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: NeverOpeningSocket[] = [];

  readyState = NeverOpeningSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn(() => {
    this.readyState = NeverOpeningSocket.CLOSED;
  });

  constructor(
    public url: string,
    public protocols?: string | string[],
  ) {
    NeverOpeningSocket.instances.push(this);
  }
}

const proofProvider = async () => ({ token: 'device-token', proof: 'proof' });

describe('VaultTransport handshake bound', () => {
  beforeEach(() => {
    NeverOpeningSocket.instances = [];
    vi.stubGlobal('WebSocket', NeverOpeningSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rejects a handshake that never opens instead of hanging forever', async () => {
    const transport = new VaultTransport('device-id', 'device-token', proofProvider);

    const connection = transport.connect('mourn.bio', true, '/api/v1/vault/ws/secure');
    const settled = expect(connection).rejects.toThrow('WebSocket handshake timed out');

    await vi.advanceTimersByTimeAsync(VaultTransport.WS_OPEN_TIMEOUT_MS + 1);
    await settled;
    expect(NeverOpeningSocket.instances).toHaveLength(1);
    expect(NeverOpeningSocket.instances[0].close).toHaveBeenCalled();
  });

  it('resolves immediately when the socket opens, without waiting for the bound', async () => {
    const transport = new VaultTransport('device-id', 'device-token', proofProvider);

    const connection = transport.connect('mourn.bio', true, '/api/v1/vault/ws/secure');
    await Promise.resolve();
    await Promise.resolve();

    const socket = NeverOpeningSocket.instances[0];
    socket.readyState = NeverOpeningSocket.OPEN;
    socket.onopen?.();

    await expect(connection).resolves.toBeUndefined();
    expect(transport.isOpen()).toBe(true);
  });

  it('rejects immediately when the socket closes before opening', async () => {
    const transport = new VaultTransport('device-id', 'device-token', proofProvider);

    const connection = transport.connect('mourn.bio', true, '/api/v1/vault/ws/secure');
    const settled = expect(connection).rejects.toThrow('WebSocket closed before opening');

    await Promise.resolve();
    await Promise.resolve();
    NeverOpeningSocket.instances[0].onclose?.();
    await settled;
  });
});
