// Local-only coturn fixture. Reuses an installed/extracted binary; never downloads.
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
const delay = ms => new Promise(r => setTimeout(r, ms));
export async function localTurn(scratch) {
  const lookup = spawnSync('which', ['turnserver'], { encoding: 'utf8' });
  const binary = [lookup.stdout?.trim(), join(tmpdir(), 'mourn-turn-gate/root/usr/bin/turnserver')].find(p => p && existsSync(p));
  if (!binary) return null;
  const reservation = createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const port = reservation.address().port;
  await new Promise(r => reservation.close(r));
  const secret = randomBytes(32).toString('hex');
  const config = join(scratch, 'turn.conf');
  await writeFile(config, [
    `listening-port=${port}`, 'listening-ip=127.0.0.1', 'relay-ip=127.0.0.1',
    'realm=localhost', 'use-auth-secret', `static-auth-secret=${secret}`, 'fingerprint',
    'no-cli', 'no-multicast-peers', 'allow-loopback-peers', 'no-tls', 'no-dtls',
    'no-stdout-log', 'log-file=/dev/null', `pidfile=${join(scratch, 'turn.pid')}`, 'relay-threads=1',
  ].join('\n') + '\n', { mode: 0o600 });
  const child = spawn(binary, ['-c', config], { stdio: 'ignore', env: { PATH: process.env.PATH, LD_LIBRARY_PATH: join(dirname(binary), '../lib/x86_64-linux-gnu') } });
  const stop = async () => { child.kill(); if (child.exitCode === null) await Promise.race([new Promise(r => child.once('exit', r)), delay(2000).then(() => child.kill('SIGKILL'))]); };
  let startupError; child.on('error', e => { startupError = e; });
  try {
    for (let tries = 0; tries < 100; tries++) {
      if (startupError) throw startupError;
      if (child.exitCode !== null) throw new Error(`local coturn exited: ${child.exitCode}`);
      const ready = await new Promise(resolve => { const socket = connect(port, '127.0.0.1'); socket.setTimeout(100); socket.on('connect', () => { socket.destroy(); resolve(true); }); socket.on('error', () => resolve(false)); socket.on('timeout', () => { socket.destroy(); resolve(false); }); });
      if (ready) return { secret, port, stop };
      await delay(100);
    }
    throw new Error('local coturn listener timeout');
  } catch (e) { await stop(); throw e; }
}
