import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
// Opt-in SQL must already be provisioned and explicitly disposable. Never load
// DATABASE_URL or .env; no schema migration/build/download is performed here.
const sqlUrl = process.env.CALLS_TEST_DATABASE_URL;
if (sqlUrl) {
  const url = new URL(sqlUrl);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'disposable loopback PostgreSQL only');
  assert.match(url.pathname, /^\/calls_(?:combined|audit|test)(?:_[a-z0-9_]+)?$/, 'explicitly named disposable calls database only');
  assert.ok(!url.searchParams.has('host'), 'connection host override forbidden');
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const backendRequire = createRequire(new URL('../../../mourn.bio/package.json', import.meta.url));
const { createMemoryDb } = backendRequire('./test/helpers/callsMemoryDb');
const chromiumPath = process.env.CHROMIUM_PATH || '/opt/brave.com/brave/brave';
const express = backendRequire('express');
const { WebSocketServer } = backendRequire('ws');
const { createCallsService } = backendRequire('./services/calls');
const { createCallSocketHandler } = backendRequire('./services/callSocket');
const { createCallsRouter, callsJson } = backendRequire('./routes/api/v1/calls.routes');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function localTurn(scratch) {
  const lookup = spawnSync('which', ['turnserver'], { encoding: 'utf8' });
  const binary = [process.env.COTURN_BINARY, lookup.stdout?.trim(), join(tmpdir(), 'mourn-turn-gate/root/usr/bin/turnserver')].find(p => p && existsSync(p));
  if (!binary) return null;
  const reservation = createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const secret = randomBytes(32).toString('hex');
  const config = join(scratch, 'turn.conf');
  await writeFile(config, [`listening-port=${port}`, 'listening-ip=127.0.0.1', 'relay-ip=127.0.0.1',
    'realm=localhost', 'use-auth-secret', `static-auth-secret=${secret}`, 'fingerprint', 'no-cli',
    'no-multicast-peers', 'allow-loopback-peers', 'no-tls', 'no-dtls', 'no-stdout-log',
    'log-file=/dev/null', `pidfile=${join(scratch, 'turn.pid')}`, 'relay-threads=1'].join('\n') + '\n', { mode: 0o600 });
  const version = spawnSync(binary, ['--version'], { timeout: 3000, encoding: 'utf8', env: { ...process.env, LD_LIBRARY_PATH: join(dirname(binary), '../lib/x86_64-linux-gnu') } });
  const child = spawn(binary, ['-c', config], { stdio: 'ignore', env: { ...process.env, LD_LIBRARY_PATH: join(dirname(binary), '../lib/x86_64-linux-gnu') } });
  let startupError; child.on('error', error => { startupError = error; });
  const stop = async () => { if (child.exitCode !== null) return; child.kill(); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(2000).then(() => child.kill('SIGKILL'))]); };
  try {
    await until(async () => {
      if (startupError) throw startupError;
      assert.equal(child.exitCode, null, 'coturn unexpectedly exited');
      return new Promise(resolve => { const socket = connect(port, '127.0.0.1'); socket.setTimeout(100); socket.on('connect', () => { socket.destroy(); resolve(true); }); socket.on('error', () => resolve(false)); socket.on('timeout', () => { socket.destroy(); resolve(false); }); });
    }, Boolean, 'local coturn readiness', 10000);
    return { secret, port, stop, version: (version.stdout || version.stderr).trim() };
  } catch (error) { await stop(); throw error; }
}
async function until(work, predicate, label, timeout = 15000) {
  const end = Date.now() + timeout; let result;
  do { result = await work(); if (predicate(result)) return result; await delay(100); } while (Date.now() < end);
  assert.fail(`${label}: ${JSON.stringify(result)}`);
}
async function browser(url, profile) {
  const child = spawn(chromiumPath, ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let socket; const pending = new Map();
  const stop = async () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('browser teardown')); } pending.clear(); socket?.close(); child.kill(); if (child.exitCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(2000).then(() => child.kill('SIGKILL'))]); };
  try {
    const endpoint = await new Promise((resolve, reject) => { let output = ''; const timer = setTimeout(() => reject(new Error('Chromium startup timeout')), 10000); child.once('error', e => { clearTimeout(timer); reject(e); }); child.stderr.on('data', b => { output += b; const m = output.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(timer); resolve(m[1]); } }); });
    socket = new WebSocket(endpoint); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0;
    socket.onmessage = event => { const m = JSON.parse(event.data); const p = pending.get(m.id); if (p) { clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } };
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)); }, 20000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId })); });
    const { targetId } = await send('Target.createTarget', { url });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    await until(() => evaluate('({ready:!!window.fixtureReady,errors:window.errors})'), r => r.ready, 'fixture bundle readiness');
    return { evaluate, stop, pid: child.pid };
  } catch (e) { await stop(); throw e; }
}
for (const relay of [false, true]) test(`combined production voice ${relay ? 'forced UDP relay' : 'direct'}: encrypted signalling, WS outage, reconciliation, teardown`, { timeout: 90000 }, async t => {
  const forbiddenAccess = [];
  const protect = target => new Proxy(target, { get(object, key) {
    if (typeof key === 'string' && /signal|session|journal|outbox|inbox/i.test(key)) { forbiddenAccess.push(key); throw new Error('FORBIDDEN_SIGNAL_MODEL:' + key); }
    const value = object[key];
    return typeof value === 'function' ? value.bind(object) : value;
  } });
  const queries = [];
  const rawDb = sqlUrl ? new (backendRequire('@prisma/client').PrismaClient)({ datasources: { db: { url: sqlUrl } }, log: [{ emit: 'event', level: 'query' }] }) : createMemoryDb();
  if (sqlUrl) rawDb.$on('query', event => queries.push(event.query));
  const transaction = rawDb.$transaction.bind(rawDb);
  rawDb.$transaction = (fn, options) => transaction(tx => fn(protect(tx)), options);
  const db = protect(rawDb);
  const scratch = await mkdtemp(join(tmpdir(), 'mourn-combined-'));
  const browsers = [], users = [], endpoints = [], sockets = new Map(), wire = [], fixtureErrors = [], presenceTasks = new Set();
  let server, wss, service, link, turn;
  const tracked = promise => { presenceTasks.add(promise); promise.catch(e => fixtureErrors.push(String(e))).finally(() => presenceTasks.delete(promise)); };
  try {
    if (relay) { turn = await localTurn(scratch); if (!turn) { assert.notEqual(process.env.CALLS_REQUIRE_RELAY, '1', 'required local coturn is unavailable; downloads are never attempted'); t.skip('No installed/extracted local coturn; no downloads attempted (set COTURN_BINARY)'); return; } }
    if (sqlUrl) assert.match((await db.$queryRaw`SELECT version() AS version`)[0].version, /PostgreSQL/);
    const build = spawnSync('bun', ['build', 'tests/calls/combinedVoice.browser.ts', '--target=browser', '--define', 'import.meta.env.DEV=false', '--define', '__MOURN_TARGET__="desktop"', '--outfile', join(scratch, 'fixture.js')], { cwd: root, encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    const bundle = await readFile(join(scratch, 'fixture.js'));
    const app = express();
    const auth = (req, res, next) => { const endpoint = endpoints.find(e => e.deviceId === req.headers['x-fixture-device']); if (!endpoint) return res.status(401).json({ code: 'FIXTURE_AUTH_REQUIRED' }); req.user = { id: endpoint.userId, deviceId: endpoint.deviceId }; next(); };
    const emitDevice = (id, packet) => { wire.push({ target: id, ...packet }); const socket = sockets.get(id); if (socket?.readyState !== 1) return false; socket.send(JSON.stringify(packet)); return true; };
    service = createCallsService({ db, env: { CALLS_ENABLED: 'true', TURN_STATIC_AUTH_SECRET: turn?.secret || 'synthetic-unused', TURN_URLS: `turn:127.0.0.1:${turn?.port || 9}?transport=udp` }, emitDevice, emitUser: (id, packet) => endpoints.filter(e => e.userId === id).forEach(e => emitDevice(e.deviceId, packet)), isOnline: id => sockets.get(id)?.readyState === 1 });
    app.use('/api/v1', callsJson, createCallsRouter({ service, requireAuth: auth, requireNative: (req, res, next) => next() }));
    app.get('/fixture.js', (req, res) => res.type('js').send(bundle));
    app.get('/', (req, res) => res.type('html').send('<!doctype html><script type="module" src="/fixture.js"></script>'));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    wss = new WebSocketServer({ server });
    const handler = createCallSocketHandler({ service: () => service });
    wss.on('connection', (socket, req) => {
      const id = new URL(req.url, 'http://localhost').searchParams.get('fixtureDevice');
      const endpoint = endpoints.find(e => e.deviceId === id);
      if (!endpoint) return socket.close(1008);
      const actor = { userId: endpoint.userId, deviceId: id }; sockets.set(id, socket); tracked(service.presence(id, true));
      socket.on('message', raw => { tracked(handler(actor, JSON.parse(raw.toString()), packet => socket.send(JSON.stringify(packet)))); });
      socket.on('close', () => { if (sockets.get(id) === socket) { sockets.delete(id); tracked(service.presence(id, false)); } handler.forget(id); });
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (let i = 0; i < 2; i++) {
      const peer = await browser(origin, join(scratch, `browser-${i}`)); browsers.push(peer);
      const keys = await peer.evaluate('publicKeys');
      const id = randomUUID();
      const user = await db.user.create({ data: { id, username: 'voicefixture' + id.slice(0, 12), usernameNormalized: 'voicefixture' + id.slice(0, 12), passwordHash: 'synthetic-not-a-password' } }); users.push(user);
      const device = await db.device.create({ data: { userId: user.id, ...keys, deviceHash: randomUUID(), platform: 'ANDROID', lastSeenAt: new Date() } });
      endpoints.push({ userId: user.id, deviceId: device.id, ...keys });
    }
    assert.notEqual(browsers[0].pid, browsers[1].pid);
    link = await db.link.create({ data: { senderId: users[0].id, receiverId: users[1].id, status: 'ESTABLISHED', establishedAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 86400000) } });
    for (let i = 0; i < 2; i++) await browsers[i].evaluate(`setup(${JSON.stringify({ local: endpoints[i], endpoints, linkId: link.id, relay })})`);
    assert.equal(service.config({}).signallingPolicy, 'memory-only-v1');
    const snapshots = () => Promise.all(browsers.map(b => b.evaluate('snapshot()')));
    await browsers[0].evaluate(`manager.dial(${JSON.stringify(link.id)})`);
    await until(async () => wire.find(p => p.type === 'CALL_SIGNAL' && p.kind === 'offer'), Boolean, 'backend offer relay');
    const forwarded = wire.find(p => p.type === 'CALL_SIGNAL' && p.kind === 'offer');
    const original = (await browsers[0].evaluate('snapshot()')).sentMetadata.find(p => p.signalId === forwarded.signalId);
    assert.deepEqual(
      { needsOffer: forwarded.needsOffer, createdAt: forwarded.createdAt, expiresAt: forwarded.expiresAt },
      { needsOffer: original.needsOffer, createdAt: original.createdAt, expiresAt: original.expiresAt },
      'backend must preserve optional needsOffer and AEAD-authenticated timestamps verbatim; never normalize/re-sign in fixture',
    );
    const ringing = await until(snapshots, rows => rows[1].received.includes('offer') && rows[1].phase === 'RINGING', 'encrypted offer delivery');
    assert.equal(ringing[1].tracks.length, 0, 'incoming offer must not capture mic before accept');
    const callId = ringing[0].callId;
    const offer = wire.find(p => p.type === 'CALL_SIGNAL' && p.callId === callId && p.kind === 'offer');
    assert.equal(offer.target, endpoints[1].deviceId); assert.equal(offer.fromDeviceId, endpoints[0].deviceId);
    assert.match(offer.ciphertextHex, /^[0-9a-f]+$/); assert.ok(!Buffer.from(offer.ciphertextHex, 'hex').toString().includes('v=0'));
    await browsers[1].evaluate('manager.accept()');
    const initial = await until(snapshots, rows => rows.every(r => r.phase === 'ACTIVE' && r.stats.length === 1 && r.stats[0].bytes > 0 && r.stats[0].energy > 0), 'bidirectional real audio');
    const call = await db.call.findUnique({ where: { id: callId }, include: { devices: true } });
    assert.equal(call.state, 'ACTIVE'); assert.equal(call.answeredDeviceId, endpoints[1].deviceId); assert.equal(call.devices.filter(d => d.userId === users[1].id && d.state === 'ANSWERED').length, 1);
    // The winning endpoint's repeat concurrent answer requests are idempotent.
    const repeated = await Promise.all([service.answer({ userId: users[1].id, deviceId: endpoints[1].deviceId }, callId), service.answer({ userId: users[1].id, deviceId: endpoints[1].deviceId }, callId)]);
    assert.ok(repeated.every(r => r.call.answeredDeviceId === endpoints[1].deviceId));
    assert.ok(initial.every(r => r.sessions === 1));
    if (relay) assert.ok(initial.every(r => r.stats[0].localType === 'relay' && r.stats[0].remoteType === 'relay'));
    await until(snapshots, rows => rows.every((r, i) => r.stats[0].bytes > initial[i].stats[0].bytes && r.stats[0].energy > initial[i].stats[0].energy), 'increasing audio at both peers');
    assert.ok(initial[0].received.includes('answer'));
    await browsers[0].evaluate('manager.setMuted(true)');
    const muted = (await browsers[0].evaluate('snapshot()')).tracks.filter(t => t.state === 'live');
    assert.ok(muted.length > 0 && muted.every(t => !t.enabled));
    await browsers[0].evaluate('manager.setMuted(false)');
    const unmuted = (await browsers[0].evaluate('snapshot()')).tracks.filter(t => t.state === 'live');
    assert.ok(unmuted.length > 0 && unmuted.every(t => t.enabled));
    // Real backend sockets are forcibly terminated, not a candidate-pump pause.
    for (const socket of sockets.values()) socket.terminate();
    await until(snapshots, rows => rows.every(r => r.socketState === 3 && r.closedSockets === 1), 'actual backend WS loss');
    await until(async () => sockets.size, size => size === 0, 'backend socket registry teardown');
    await Promise.all([...presenceTasks]);
    const outageBefore = await snapshots();
    await delay(2000);
    const outage = await snapshots();
    assert.ok(outage.every((r, i) => r.phase === 'ACTIVE' && r.stats[0].bytes > outageBefore[i].stats[0].bytes && r.stats[0].energy > outageBefore[i].stats[0].energy), JSON.stringify(outage));
    assert.equal((await db.call.findUnique({ where: { id: callId } })).state, 'ACTIVE');
    for (const peer of browsers) await peer.evaluate('connect()');
    const reconnected = await until(snapshots, rows => rows.every((r, i) => r.socketState === 1 && r.phase === 'ACTIVE' && r.stats[0].bytes > outage[i].stats[0].bytes), 'reconnect/reconcile');
    assert.ok(reconnected.every((r, i) => r.received.filter(t => t === 'offer').length === outage[i].received.filter(t => t === 'offer').length && r.mediaInstances === outage[i].mediaInstances && r.sessions === outage[i].sessions), 'reconnect must retain existing in-memory media/crypto session without replay');
    await browsers[0].evaluate('manager.hangup()');
    const ended = await until(snapshots, rows => rows.every(r => r.phase === 'ENDED' && r.stats.length === 0 && r.tracks.length > 0 && r.tracks.every(t => t.state === 'ended')), 'hangup releases every captured track');
    assert.equal((await db.call.findUnique({ where: { id: callId } })).state, 'ENDED');
    const retired = await until(snapshots, rows => rows.every(r => r.sessions === 0 && r.pending === 0), 'terminal grace releases call ratchets/retry timers', 14000);
    assert.deepEqual(forbiddenAccess, []);
    assert.ok(queries.every(sql => !/call_signals|call_sessions|ciphertext|ratchet|journal/i.test(sql)), 'SQL must contain lifecycle metadata only');
    assert.ok(ended.every(r => r.persistentWrites.length === 0));
    assert.deepEqual(fixtureErrors, []); assert.ok(retired.every(r => r.errors.length === 0), JSON.stringify(retired));
    // A new process has no SDP/ICE/ratchet state. Owned ACTIVE metadata must be
    // interrupted at boot, never admitted as a resumable signalling session.
    await browsers[0].evaluate(`manager.dial(${JSON.stringify(link.id)})`);
    await until(snapshots, rows => rows[1].phase === 'RINGING' && rows[1].callId !== callId, 'second fresh ring');
    await browsers[1].evaluate('manager.accept()');
    const beforeRestart = await until(snapshots, rows => rows.every(r => r.phase === 'ACTIVE' && r.stats.length === 1 && r.stats[0].bytes > 0 && r.stats[0].energy > 0), 'second call audio before process loss');
    const interruptedId = beforeRestart[0].callId;
    await browsers[0].stop();
    await until(async () => sockets.has(endpoints[0].deviceId), present => !present, 'dead caller socket removed');
    await Promise.all([...presenceTasks]);
    assert.equal((await db.call.findUnique({ where: { id: interruptedId } })).state, 'ACTIVE', 'caller process loss initially leaves only lifecycle metadata');
    browsers[0] = await browser(origin, join(scratch, 'browser-restarted'));
    await browsers[0].evaluate(`setup(${JSON.stringify({ local: endpoints[0], endpoints, linkId: link.id, relay })})`);
    const afterRestart = await until(snapshots, rows => rows[0].phase === 'IDLE' && rows[1].phase === 'ENDED', 'fresh process interrupts owned ACTIVE call');
    assert.equal((await db.call.findUnique({ where: { id: interruptedId } })).state, 'ENDED');
    assert.equal((await db.call.findUnique({ where: { id: interruptedId } })).endReason, 'failed');
    assert.equal(afterRestart[0].sessions, 0); assert.equal(afterRestart[0].mediaInstances, 0);
    assert.deepEqual(afterRestart[0].sentKinds, []); assert.deepEqual(afterRestart[0].tracks, []);
    assert.ok(afterRestart[1].tracks.every(track => track.state === 'ended'));
    for (const peer of browsers) await peer.evaluate('shutdown()');
    const shutdown = await snapshots();
    assert.ok(shutdown.every(r => r.sessions === 0 && r.pending === 0 && r.tracks.every(t => t.state === 'ended')), 'logout/dispose releases RAM engines, retries and all microphone tracks');
    assert.ok(shutdown.every(r => r.errors.length === 0 && r.persistentWrites.length === 0), JSON.stringify(shutdown));
    assert.deepEqual(forbiddenAccess, []); assert.deepEqual(fixtureErrors, []);
    assert.ok(queries.every(sql => !/call_signals|call_sessions|ciphertext|ratchet|journal/i.test(sql)), 'SQL must contain lifecycle metadata only, including boot interruption');
    console.log(JSON.stringify({ relay, coturnVersion: turn?.version, independentBrowserProcesses: 2, callerProcessRecreated: true, encryptedOfferForwardedOnly: true, initial, outage, reconnected, ended, retired, beforeRestart, afterRestart, shutdown, sqlQueries: queries.length, auth: 'synthetic device-bound HTTP/WS identity lookup; production auth handshake/native keychain NOT tested', database: sqlUrl ? 'real disposable PostgreSQL, real Prisma serializable transactions/advisory locks' : 'isolated Prisma-shaped RAM fixture; PostgreSQL not tested' }));
  } catch (error) {
    const browserDiagnostics = await Promise.all(browsers.map(async peer => { try { return await peer.evaluate('window.snapshot ? snapshot() : ({errors:window.errors})'); } catch (failure) { return { diagnosticError: String(failure) }; } }));
    console.log(JSON.stringify({ relay, failure: String(error), database: sqlUrl ? 'real disposable PostgreSQL' : 'RAM fixture', sqlQueries: queries.length, forbiddenAccess, fixtureErrors, browserDiagnostics }));
    throw error;
  } finally {
    for (const peer of browsers) { try { await peer.evaluate('window.shutdown?.()'); } catch {} }
    await Promise.all(browsers.map(b => b.stop()));
    for (const socket of sockets.values()) socket.terminate();
    if (wss) await new Promise(resolve => wss.close(resolve));
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await Promise.allSettled([...presenceTasks]);
    await service?.stopCallSweeper();
    await turn?.stop();
    // Delete only this run's random fixtures, never truncate/reset a shared DB.
    if (sqlUrl) {
      if (link) await db.call.deleteMany({ where: { linkId: link.id } });
      if (link) await db.link.delete({ where: { id: link.id } });
      if (users.length) await db.device.deleteMany({ where: { userId: { in: users.map(user => user.id) } } });
      if (users.length) await db.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } });
    }
    await db.$disconnect();
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
