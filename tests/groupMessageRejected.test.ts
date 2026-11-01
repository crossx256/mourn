// BM-04 (client) — the server's explicit rejection for a Suite message that
// could not be persisted must reach the store and mark THAT message failed.
//
// Server contract (services/socket.js): a GROUP_MESSAGE_SUBMIT whose
// Serializable transaction kept hitting P2034 now answers
//   { type: 'GROUP_MESSAGE_REJECTED', groupId, epoch, reason, retryable }
// instead of dropping the frame. The client had no handler at all, so the
// message it had already written locally kept looking sent while recipients
// never got it.
//
// The id the client is holding is the CLIENT id it generated in sendMessage
// ('grp_<uuid>'), stored as the local message `id`. The server does not know it
// (GROUP_MESSAGE_SUBMIT carries no client id, and GROUP_MESSAGE_ACK carries the
// server id), so the rejection is correlated by (groupId, epoch) — the same
// tuple GROUP_EPOCH_MISMATCH already uses — and marks the local message that
// tuple identifies.
//
//   red    — transport ignores the frame; the store never learns.
//   green  — transport dispatches onGroupMessageRejected; the store marks the
//            matching local message failed and reports the send failure.
//
// Run: bunx vitest run tests/groupMessageRejected.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const transportState = vi.hoisted(() => ({ sent: [] as unknown[] }));

vi.mock('boot/axios', () => ({
  api: {
    get: vi.fn(async () => ({ data: {} })),
    post: vi.fn(async () => ({ data: {} })),
    patch: vi.fn(async () => ({ data: {} })),
    delete: vi.fn(async () => ({ data: {} })),
  },
}));
vi.mock('../src/stores/auth', () => ({
  useAuthStore: () => ({ user: { id: 'uid', username: 'sender' }, token: 'token' }),
}));
vi.mock('../src/utils/notificationSound', () => ({ playNotificationSound: vi.fn() }));

import { VaultTransport } from '../src/crypto/transport';
import { useGroupStore, type GroupMessage } from '../src/stores/groupStore';

/**
 * A real transport with its socket receive handler installed. The socket
 * constructor is stubbed (no network); once `onopen` fires, the transport's own
 * `onmessage` receives frames exactly as in production.
 */
async function connectedTransport() {
  const transport = new VaultTransport('own-device', 'token', async () => ({ token: 'token', proof: 'proof' }));
  vi.stubGlobal('WebSocket', class {
    static OPEN = 1;
    readyState = 1;
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onclose?: (event: unknown) => void;
    onerror?: (event: unknown) => void;
    constructor() {
      queueMicrotask(() => this.onopen?.());
    }
    send(raw: string) {
      transportState.sent.push(JSON.parse(raw));
    }
    close() {}
  });
  await transport.connect('localhost:0', false);
  return transport;
}

function deliver(transport: VaultTransport, frame: unknown) {
  const socket = (transport as unknown as { ws: { onmessage?: (event: { data: string }) => void } }).ws;
  expect(typeof socket?.onmessage, 'socket receive handler was never installed').toBe('function');
  socket.onmessage!({ data: JSON.stringify(frame) });
}

function seedMessages(groupId: string, ids: string[]) {
  const store = useGroupStore();
  const messages: GroupMessage[] = ids.map((id, index) => ({
    id,
    groupId,
    senderId: 'uid',
    senderDeviceId: 'own-device',
    senderUsername: 'sender',
    senderProfile: null,
    content: `text ${index}`,
    replyTo: null,
    attachment: null,
    epoch: 4,
    createdAt: new Date(1_700_000_000_000 + index).toISOString(),
    reactions: {},
  }));
  store.messages = { ...store.messages, [groupId]: messages };
  return store;
}

beforeEach(() => {
  setActivePinia(createPinia());
  transportState.sent = [];
  vi.unstubAllGlobals();
});

describe('GROUP_MESSAGE_REJECTED', () => {
  it('transport dispatches a well-formed rejection to onGroupMessageRejected', async () => {
    const transport = await connectedTransport();
    const handler = vi.fn();
    transport.onGroupMessageRejected = handler;

    deliver(transport, {
      type: 'GROUP_MESSAGE_REJECTED',
      groupId: 'g',
      epoch: 4,
      reason: 'SERIALIZATION_CONFLICT',
      retryable: true,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ groupId: 'g', epoch: 4, reason: 'SERIALIZATION_CONFLICT' });
  });

  it('transport ignores a rejection without a groupId', async () => {
    const transport = await connectedTransport();
    const handler = vi.fn();
    transport.onGroupMessageRejected = handler;
    deliver(transport, { type: 'GROUP_MESSAGE_REJECTED', reason: 'SERIALIZATION_CONFLICT' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('a rejection delivered through the wire marks the pending message failed', async () => {
    const store = seedMessages('g', ['grp_first', 'grp_second']);
    const transport = await connectedTransport();
    transport.onGroupMessageRejected = (payload) => {
      store.handleMessageRejected(payload.groupId, payload.epoch, payload.reason);
    };

    deliver(transport, { type: 'GROUP_MESSAGE_REJECTED', groupId: 'g', epoch: 4, reason: 'SERIALIZATION_CONFLICT' });

    const messages = store.messages.g;
    // The rejection names the NEWEST unresolved own message in that epoch
    // (see handleMessageRejected), so 'grp_second' is the one it marks.
    expect(messages.find((m) => m.id === 'grp_second')?.failed).toBe(true);
    expect(messages.find((m) => m.id === 'grp_first')?.failed).toBeUndefined();
    expect(store.lastError).toMatch(/could not be delivered/i);
  });

  it('does not mark a message from another epoch', () => {
    const store = seedMessages('g', ['grp_old']);
    store.messages.g[0].epoch = 3;
    store.handleMessageRejected('g', 4, 'SERIALIZATION_CONFLICT');
    expect(store.messages.g[0].failed).toBeUndefined();
  });

  it('an unknown group is a no-op, not a throw', () => {
    const store = useGroupStore();
    expect(() => store.handleMessageRejected('nope', 1, 'SERIALIZATION_CONFLICT')).not.toThrow();
  });
});
