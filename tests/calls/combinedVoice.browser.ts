// Real call manager, BrowserMedia, CipherEngine and RAM-only CallSignalTransport.
// Synthetic authenticated endpoint lookup replaces login/keychain, not call crypto.
import sodium from 'libsodium-wrappers';
import { CallManager } from '../../src/calls/callManager';
import { BrowserMedia } from '../../src/calls/media/browserMedia';
import { CallSignalTransport } from '../../src/calls/signalTransport';
import { CipherEngine } from '../../src/crypto/engine';
import { callSessionTranscript } from '../../src/calls/session';
const w = window as any;
w.errors = []; w.persistentWrites = [];
const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia = async constraints => { const stream = await capture(constraints); w.tracks.push(...stream.getTracks()); return stream; };
window.addEventListener('unhandledrejection', e => w.errors.push(String(e.reason?.stack || e.reason)));
// This isolated page has no legitimate persistent writes. Fail on every IDB write,
// including a renamed call-session store; also catch storage/OPFS escape paths.
for (const method of ['put', 'add', 'delete', 'clear']) {
  (IDBObjectStore.prototype as any)[method] = function () {
    w.persistentWrites.push(`idb:${this.name}:${method}`);
    throw new Error('FORBIDDEN_CALL_PERSISTENCE');
  };
}
Storage.prototype.setItem = function (key) { w.persistentWrites.push(`storage:${key}`); throw new Error('FORBIDDEN_CALL_PERSISTENCE'); };
if (navigator.storage?.getDirectory) navigator.storage.getDirectory = async () => { w.persistentWrites.push('opfs'); throw new Error('FORBIDDEN_CALL_PERSISTENCE'); };
await sodium.ready;
const device = sodium.crypto_box_keypair();
const identity = sodium.crypto_sign_keypair();
w.publicKeys = { devicePub: sodium.to_hex(device.publicKey), identityPub: sodium.to_hex(identity.publicKey) };
w.setup = async (config: any) => {
  const local = config.local;
  const engines = new Map<string, CipherEngine>();
  const queues = new Map();
  w.media = []; w.tracks = []; w.received = []; w.sent = []; w.phases = []; w.closedSockets = 0;
  w.errors = []; w.persistentWrites = [];
  const request = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch('/api/v1' + path, { method, headers: { 'X-Fixture-Device': local.deviceId, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.code), { response: { data: result } });
    return result;
  };
  w.request = request;
  let transport: CallSignalTransport;
  const api = {
    create: (linkId: string) => request('/calls', { linkId, media: 'audio' }),
    answer: (id: string) => request(`/calls/${id}/answer`, {}),
    ready: (id: string) => request(`/calls/${id}/ready`, {}),
    get: async (id: string) => (await request(`/calls/${id}`)).call,
    active: async () => (await request('/calls/active')).calls,
    ice: (id: string) => request('/calls/ice?callId=' + id),
    end: (id: string, reason: string, report: any) => request(`/calls/${id}/end`, { reason, ...report }),
    decline: (id: string) => request(`/calls/${id}/decline`, { reason: 'declined' }),
  };
  const send = (packet: any) => { if (w.socket?.readyState !== WebSocket.OPEN) throw new Error('FIXTURE_SOCKET_OFFLINE'); w.socket.send(JSON.stringify(packet)); };
  const receiptTokens = new Map();
  transport = new CallSignalTransport({
    queues: () => queues,
    deviceId: () => local.deviceId,
    capture: () => ({ assertCurrent() {}, isCurrent: () => true }),
    ensureConnected: async () => { if (w.socket?.readyState !== WebSocket.OPEN) throw new Error('FIXTURE_SOCKET_OFFLINE'); },
    resolvePeer: async (callId, deviceId, userId) => {
      const call = await api.get(callId);
      const remote = config.endpoints.find((e: any) => e.deviceId === deviceId);
      if (!remote || remote.userId === local.userId || userId && remote.userId !== userId || call.linkId !== config.linkId) throw new Error('FIXTURE_PEER_MISMATCH');
      const caller = config.endpoints.find((e: any) => e.deviceId === call.callerDeviceId);
      const callee = local.deviceId === caller.deviceId ? remote : local;
      return { ...remote, callId, linkId: config.linkId, transcript: callSessionTranscript(callId, config.linkId, caller, callee), iAmInitiator: local.deviceId === caller.deviceId };
    },
    getEngine: async (peer, key) => {
      if (!engines.has(key)) {
        const engine = new CipherEngine();
        await engine.init(device.privateKey, sodium.from_hex(peer.devicePub), local.userId, peer.userId, { iAmInitiator: peer.iAmInitiator }, peer.transcript);
        engines.set(key, engine);
      }
      return engines.get(key)!;
    },
    releaseCall: callId => { for (const key of engines.keys()) if (key.includes(callId)) engines.delete(key); },
    send: packet => { w.sent.push({ kind: packet.kind, callId: packet.callId, signalId: packet.signalId, createdAt: packet.createdAt, expiresAt: packet.expiresAt, needsOffer: packet.needsOffer }); send({ type: 'CALL_SIGNAL', ...packet }); },
    ack: (callId, signalId) => send({ type: 'CALL_SIGNAL_ACK', callId, signalId, receiptToken: receiptTokens.get(signalId) }),
  });
  w.transport = transport;
  const manager = w.manager = new CallManager({ api, localDeviceId: local.deviceId, userId: local.userId,
    transport: {
      // Same fresh-authoritative-ring admission contract as vault.admitCallSignals;
      // this fixture does not load the app stores, login or native keychain.
      admit: async (callId, created) => {
        const call = created ?? await api.get(callId);
        if (call.id !== callId || call.state !== 'RINGING' || call.linkId !== config.linkId ||
          (created ? call.callerId !== local.userId || call.callerDeviceId !== local.deviceId
            : call.calleeId !== local.userId || Date.parse(call.ringExpiresAt) <= Date.now())) throw new Error('CALL_FRESH_RING_REQUIRED');
        transport.admitCall(callId);
      },
      retire: callId => transport.retireCall(callId),
      send: (linkId, targetDeviceId, body) => transport.send(linkId, config.endpoints.find((e: any) => e.deviceId === targetDeviceId).userId, [{ id: targetDeviceId }], body),
    },
    createMedia: events => { const media = new BrowserMedia({ alwaysRelay: config.relay, events }); w.media.push(media); return media; },
    onChange: state => w.phases.push(state.phase),
  });
  transport.onError(error => w.errors.push(error.message));
  transport.onSignal(async event => { w.received.push(event.body.t); await manager.signal(event.body); });
  let events = Promise.resolve();
  w.connect = async () => {
    const socket = w.socket = new WebSocket(`ws://${location.host}/socket?fixtureDevice=${local.deviceId}`);
    socket.onmessage = event => { events = events.then(async () => {
      const packet = JSON.parse(event.data);
      if (packet.type === 'CALL_SIGNAL') { receiptTokens.set(packet.signalId, packet.receiptToken); await transport.receive(packet); }
      else if (packet.type === 'CALL_SIGNAL_ACK') transport.handleAck(packet);
      else if (packet.type === 'CALL_SIGNAL_ERROR') transport.handleError(packet);
      else if (packet.type === 'CALL_READY') await manager.peerReady(packet.callId, packet.deviceId);
      else if (packet.type === 'CALL_INCOMING' || packet.type === 'CALL_STATE') {
        const call = await api.get(packet.callId);
        await manager.serverState(call);
      }
    }).catch(error => w.errors.push(String(error))); };
    socket.onclose = () => { w.closedSockets++; transport.handleDisconnect(); void manager.event({ type: 'SOCKET_LOST' }); };
    await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error('Fixture WS failed')); });
    await manager.event({ type: 'SOCKET_RESTORED' });
    await manager.reconcile();
  };
  await manager.setEnabled(true);
  await manager.discardInterruptedCalls();
  await w.connect();
  w.snapshot = async () => {
    const stats = [];
    for (const media of w.media) {
      if (media.stream) for (const track of media.stream.getTracks()) if (!w.tracks.includes(track)) w.tracks.push(track);
      if (!media.pc) continue;
      const report = await media.pc.getStats(); let bytes = 0, energy = 0, localType, remoteType;
      for (const row of report.values()) {
        if (row.type === 'inbound-rtp' && row.kind === 'audio') { bytes += row.bytesReceived || 0; energy += row.totalAudioEnergy || 0; }
        if (row.type === 'transport' && row.selectedCandidatePairId) { const pair = report.get(row.selectedCandidatePairId); localType = report.get(pair.localCandidateId)?.candidateType; remoteType = report.get(pair.remoteCandidateId)?.candidateType; }
      }
      stats.push({ bytes, energy, localType, remoteType, state: media.pc.connectionState });
    }
    return { phase: manager.state.phase, callId: manager.call?.id, errors: w.errors, stats, received: w.received, sentKinds: w.sent.map((p: any) => p.kind), socketState: w.socket.readyState, closedSockets: w.closedSockets, tracks: w.tracks.map((t: any) => ({ state: t.readyState, enabled: t.enabled })), sessions: engines.size, pending: transport.pendingCount, mediaInstances: w.media.length, sentMetadata: w.sent, persistentWrites: w.persistentWrites };
  };
  w.shutdown = async () => { await manager.logout(); transport.dispose(); w.socket.close(); };
};
w.fixtureReady = true;
