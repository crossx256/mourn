
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const blocked = (): never => { throw new Error('Network disabled in secretless CI; mock the transport'); };
// Tests may replace these with deterministic fixtures; no live service fallback.
// These are the baseline, not Vitest stubs: unstubAllGlobals/restoreAllMocks
// restores this blocked implementation, never the host's real transport.
Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: blocked });
Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: class { constructor() { blocked(); } } });
http.request = blocked;
http.get = blocked;
https.request = blocked;
https.get = blocked;
net.connect = blocked;
net.createConnection = blocked;
net.Socket.prototype.connect = blocked;
tls.connect = blocked;
