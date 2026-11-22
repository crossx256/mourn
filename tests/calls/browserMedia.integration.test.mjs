import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomUUID } from 'node:crypto';

// Opt-in: exercise the shipped BrowserMedia, not a second WebRTC implementation.
// Use an already-installed Chromium; this test never downloads a browser.
const root = fileURLToPath(new URL('../../', import.meta.url));
async function openBrowser(url, profile) {
  const child = spawn(process.env.CHROMIUM_PATH, ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', ...(process.env.TURN_TEST_CERT_SPKI ? [`--ignore-certificate-errors-spki-list=${process.env.TURN_TEST_CERT_SPKI}`] : []), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let socket;
  const stop = async () => {
    socket?.close(); child.kill();
    if (child.exitCode === null) await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  };
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let stderr = ''; const timer = setTimeout(() => reject(new Error('Chromium startup timed out')), 10000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.stderr.on('data', bytes => {
        stderr += bytes;
        const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let serial = 0; const pending = new Map();
    socket.onmessage = event => {
      const message = JSON.parse(event.data); const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(message.id);
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
    };
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await send('Target.createTarget', { url });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    const deadline = Date.now() + 10000;
    while (!await evaluate('!!window.BrowserMedia')) {
      if (Date.now() > deadline) throw new Error('BrowserMedia module did not load');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return { evaluate, stop };
  } catch (error) { await stop(); throw error; }
}

for (const transport of ['p2p', 'udp', 'tcp', 'tls']) test(`BrowserMedia ${transport}: bidirectional audio, restart and capture teardown`, { skip: !process.env.CHROMIUM_PATH || transport !== 'p2p' && !process.env.TURN_AUTH_SECRET, timeout: 60000 }, async () => {
  const relay = transport !== 'p2p';
  const username = `${Math.floor(Date.now() / 1000) + 600}:${randomUUID()}`;
  const host = process.env.TURN_HOST || 'localhost';
  const urls = transport === 'tls' ? `turns:${host}:${process.env.TURN_TLS_PORT || 5349}?transport=tcp` : `turn:${host}:${process.env.TURN_PORT || 3478}?transport=${transport}`;
  const ice = relay ? [{ urls, username, credential: createHmac('sha1', process.env.TURN_AUTH_SECRET).update(username).digest('base64') }] : [];
  const scratch = await mkdtemp(join(tmpdir(), 'mourn-media-'));
  const peers = []; let server;
  try {
    const build = spawnSync('bun', ['build', 'src/calls/media/browserMedia.ts', '--target=browser', '--outfile', join(scratch, 'media.js')], { cwd: root, encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    const source = await readFile(join(scratch, 'media.js'));
    server = createServer((req, res) => {
      if (req.url === '/media.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(source); }
      else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><script type="module">import {BrowserMedia} from "/media.js";window.BrowserMedia=BrowserMedia;</script>'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    peers.push(await openBrowser(url, join(scratch, 'a')));
    peers.push(await openBrowser(url, join(scratch, 'b')));
    for (const peer of peers) await peer.evaluate(`(() => {
      window.candidates=[];window.errors=[];window.phase='new';
      window.media=new BrowserMedia({alwaysRelay:${relay},events:{onIce:c=>candidates.push(c),onConnectionState:s=>phase=s,onError:e=>errors.push(e),onStats:()=>{}}});
    })()`);
    const offer = await peers[0].evaluate(`media.startOutgoing(${JSON.stringify(ice)},1)`);
    const answer = await peers[1].evaluate(`media.acceptOffer(${JSON.stringify(offer)},${JSON.stringify(ice)},1)`);
    await peers[0].evaluate(`media.setRemoteAnswer(${JSON.stringify(answer)})`);
    const statsExpression = `(async()=>{const stats=await media.pc.getStats();let bytes=0,local,remote;for(const row of stats.values()){if(row.type==='inbound-rtp'&&row.kind==='audio')bytes+=row.bytesReceived||0;if(row.type==='transport'&&row.selectedCandidatePairId){const pair=stats.get(row.selectedCandidatePairId);local=stats.get(pair.localCandidateId)?.candidateType;remote=stats.get(pair.remoteCandidateId)?.candidateType;}}return {bytes,phase,errors,local,remote};})()`;
    let stats; const deadline = Date.now() + 15000;
    do {
      for (let i = 0; i < 2; i++) {
        for (const candidate of await peers[i].evaluate('candidates.splice(0)')) await peers[1-i].evaluate(`media.addIce(${JSON.stringify(candidate)})`);
      }
      stats = await Promise.all(peers.map(peer => peer.evaluate(statsExpression)));
      if (stats.every(row => row.bytes > 0 && row.phase === 'connected')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    console.log(JSON.stringify({ negotiation: stats }));
    assert.ok(stats.every(row => row.bytes > 0 && row.phase === 'connected'), JSON.stringify(stats));
    assert.ok(stats.every(row => row.errors.length === 0), JSON.stringify(stats));
    if (relay) assert.ok(stats.every(row => row.local === 'relay' && row.remote === 'relay'));
    // No more candidate forwarding: media must not depend on a live signalling path.
    await new Promise(resolve => setTimeout(resolve, 1500));
    const after = await Promise.all(peers.map(peer => peer.evaluate(statsExpression)));
    assert.ok(after.every((row, i) => row.bytes > stats[i].bytes));
    // Renegotiate the real production media instances, preserving their capture tracks.
    const restart = await peers[0].evaluate('media.restartIce(undefined,2)');
    const restartedAnswer = await peers[1].evaluate(`media.acceptOffer(${JSON.stringify(restart)},${JSON.stringify(ice)},2)`);
    await peers[0].evaluate(`media.setRemoteAnswer(${JSON.stringify(restartedAnswer)})`);
    const restartDeadline = Date.now() + 10000;
    let resumed;
    do {
      for (let i = 0; i < 2; i++) for (const candidate of await peers[i].evaluate('candidates.splice(0)')) await peers[1-i].evaluate(`media.addIce(${JSON.stringify(candidate)})`);
      resumed = await Promise.all(peers.map(peer => peer.evaluate(statsExpression)));
      if (resumed.every((row, i) => row.phase === 'connected' && row.bytes > after[i].bytes)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < restartDeadline);
    assert.ok(resumed.every((row, i) => row.phase === 'connected' && row.bytes > after[i].bytes), JSON.stringify(resumed));
    for (const peer of peers) {
      assert.equal(await peer.evaluate('(async()=>{const tracks=media.stream.getTracks();await media.close();return tracks.every(t=>t.readyState==="ended")&&media.pc===null&&media.audio===null;})()'), true);
    }
    console.log(JSON.stringify({ transport, before: stats, after, resumed, captureReleased: true }));
  } finally {
    await Promise.all(peers.map(peer => peer.stop()));
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
