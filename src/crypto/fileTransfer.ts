/**
 * P2P File Transfer via WebRTC Data Channels
 *
 * Files never touch the server. The existing WebSocket is used only for
 * signaling (SDP offer/answer + ICE candidates). Once the data channel
 * opens, the file streams directly peer-to-peer.
 *
 * Flow:
 *   1. Sender calls `offerFile()` — creates RTCPeerConnection + data channel,
 *      generates SDP offer, sends it via the Vault WebSocket as a control message.
 *   2. Receiver gets the offer → `acceptTransfer()` — creates its own
 *      RTCPeerConnection, sets remote SDP, generates answer, sends it back.
 *   3. ICE candidates are exchanged via `RTC_SIGNAL` WebSocket frames.
 *   4. Data channel opens → file is chunked and streamed.
 *   5. Receiver reassembles and triggers download.
 */

import { reactive } from 'vue';

export interface FileTransferMeta {
  transferId: string;
  filename: string;
  size: number;
  mimetype: string;
  senderId: string;
  linkId: string;
}

export interface TransferProgress {
  transferId: string;
  filename: string;
  size: number;
  mimetype: string;
  direction: 'send' | 'receive';
  progress: number; // 0–100
  state: 'pending' | 'connecting' | 'transferring' | 'complete' | 'failed';
  error?: string;
  blobUrl?: string; // Set on receive-complete for download
}

const CHUNK_SIZE = 64 * 1024; // 64 KB chunks
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const MAX_ACTIVE_TRANSFERS = 8;

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// Active transfers
export const transfers = reactive<Record<string, TransferProgress>>({});

// Connections
const peerConnections = new Map<string, RTCPeerConnection>();
const dataChannels = new Map<string, RTCDataChannel>();
const transferPeers = new Map<string, string>();
const readers = new Map<string, ReadableStreamDefaultReader<Uint8Array>>();

// Incoming file buffers
const receiveBuffers = new Map<string, Uint8Array[]>();
const receiveSizes = new Map<string, number>();

// Signaling callback — set by the vault store
let signalCallback: ((targetUserId: string, signal: unknown, transferId: string) => void) | null =
  null;

function getWebRtcConstructors(): {
  RTCPeerConnectionCtor: typeof RTCPeerConnection | null;
  RTCIceCandidateCtor: typeof RTCIceCandidate | null;
} {
  const g = globalThis as typeof globalThis & {
    RTCPeerConnection?: typeof RTCPeerConnection;
    RTCIceCandidate?: typeof RTCIceCandidate;
  };
  return {
    RTCPeerConnectionCtor: g.RTCPeerConnection ?? null,
    RTCIceCandidateCtor: g.RTCIceCandidate ?? null,
  };
}

export function isWebRTCSupported(): boolean {
  const { RTCPeerConnectionCtor } = getWebRtcConstructors();
  return RTCPeerConnectionCtor !== null;
}

export function setSignalCallback(cb: typeof signalCallback) {
  signalCallback = cb;
}

function sendSignal(targetUserId: string, signal: unknown, transferId: string) {
  if (!signalCallback) {
    console.error('[FileTransfer] No signal callback registered');
    return;
  }
  signalCallback(targetUserId, signal, transferId);
}

function genTransferId(): string {
  return `ft_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Offer a file to send to a peer.
 * Returns the transfer metadata to embed in the message envelope.
 */
export async function offerFile(
  file: File,
  targetUserId: string,
  linkId: string,
  senderId: string,
): Promise<FileTransferMeta> {
  const { RTCPeerConnectionCtor } = getWebRtcConstructors();
  if (!RTCPeerConnectionCtor) {
    throw new Error('WEBRTC_UNSUPPORTED');
  }

  if (peerConnections.size >= MAX_ACTIVE_TRANSFERS) throw new Error('TOO_MANY_TRANSFERS');
  if (!targetUserId || !senderId || !linkId) throw new Error('INVALID_TRANSFER_PEER');
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE_SIZE) {
    throw new Error('FILE_TOO_LARGE');
  }

  const transferId = genTransferId();
  transferPeers.set(transferId, targetUserId);

  transfers[transferId] = {
    transferId,
    filename: file.name,
    size: file.size,
    mimetype: file.type || 'application/octet-stream',
    direction: 'send',
    progress: 0,
    state: 'connecting',
  };

  const pc = new RTCPeerConnectionCtor({ iceServers: ICE_SERVERS });
  peerConnections.set(transferId, pc);

  const dc = pc.createDataChannel('file', { ordered: true });
  dataChannels.set(transferId, dc);

  dc.binaryType = 'arraybuffer';

  dc.onopen = () => {
    const t = transfers[transferId];
    if (t) t.state = 'transferring';
    void streamFile(transferId, file, dc);
  };

  dc.onerror = (e) => {
    const t = transfers[transferId];
    if (t) {
      t.state = 'failed';
      t.error = 'Data channel error';
    }
    console.error('[FileTransfer] DC error', e);
    cleanup(transferId);
  };

  dc.onclose = () => {
    if (transfers[transferId]?.state === 'transferring') {
      transfers[transferId].state = 'failed';
      transfers[transferId].error = 'Connection closed prematurely';
    }
    cleanup(transferId);
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendSignal(targetUserId, { type: 'ice', candidate: e.candidate }, transferId);
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
      const t = transfers[transferId];
      if (t) {
        t.state = 'failed';
        t.error = 'ICE connection failed';
      }
      cleanup(transferId);
    }
  };

  try {
    const offer = await pc.createOffer();
    if (peerConnections.get(transferId) !== pc) throw new Error('Transfer cancelled');
    await pc.setLocalDescription(offer);
    if (peerConnections.get(transferId) !== pc) throw new Error('Transfer cancelled');
    sendSignal(targetUserId, { type: 'offer', sdp: offer }, transferId);
  } catch (error) { failTransfer(transferId, 'Offer failed'); throw error; }

  return {
    transferId,
    filename: file.name,
    size: file.size,
    mimetype: file.type || 'application/octet-stream',
    senderId,
    linkId,
  };
}

/**
 * Accept an incoming file transfer (called when receiver gets the offer).
 */
export async function acceptTransfer(
  transferId: string,
  meta: FileTransferMeta,
  offerSdp: RTCSessionDescriptionInit,
  senderUserId: string,
) {
  const { RTCPeerConnectionCtor } = getWebRtcConstructors();
  if (!RTCPeerConnectionCtor) {
    throw new Error('WEBRTC_UNSUPPORTED');
  }

  if (!meta || meta.transferId !== transferId || meta.senderId !== senderUserId ||
      ![transferId, senderUserId, meta.linkId, meta.filename, meta.mimetype].every(
        (value) => typeof value === 'string' && value.length > 0 && value.length <= 1024,
      ) || !Number.isSafeInteger(meta.size) || meta.size < 0 || meta.size > MAX_FILE_SIZE ||
      offerSdp?.type !== 'offer') throw new Error('INVALID_TRANSFER_OFFER');
  if (transfers[transferId] || peerConnections.size >= MAX_ACTIVE_TRANSFERS) throw new Error('TRANSFER_ALREADY_EXISTS_OR_LIMIT');
  const reserved = [...receiveSizes.keys()].reduce((sum, id) => sum + (transfers[id]?.size ?? 0), 0);
  if (reserved + meta.size > MAX_FILE_SIZE) throw new Error('RECEIVE_BUDGET_EXCEEDED');
  // Keep an immutable metadata snapshot across SDP awaits and incoming callbacks.
  meta = { ...meta };
  transferPeers.set(transferId, senderUserId);
  transfers[transferId] = {
    transferId,
    filename: meta.filename,
    size: meta.size,
    mimetype: meta.mimetype,
    direction: 'receive',
    progress: 0,
    state: 'connecting',
  };

  const pc = new RTCPeerConnectionCtor({ iceServers: ICE_SERVERS });
  peerConnections.set(transferId, pc);

  receiveBuffers.set(transferId, []);
  receiveSizes.set(transferId, 0);

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendSignal(senderUserId, { type: 'ice', candidate: e.candidate }, transferId);
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
      failTransfer(transferId, 'ICE connection failed');
    }
  };
  pc.ondatachannel = (e) => {
    const dc = e.channel;
    if (peerConnections.get(transferId) !== pc || dataChannels.has(transferId) || dc.label !== 'file' || !dc.ordered) {
      dc.close();
      return;
    }
    dataChannels.set(transferId, dc);
    dc.binaryType = 'arraybuffer';

    dc.onmessage = (evt) => {
      if (dataChannels.get(transferId) !== dc) return;
      const data: unknown = evt.data;
      if (!(data instanceof ArrayBuffer) || data.byteLength > CHUNK_SIZE) {
        failTransfer(transferId, 'Invalid binary file chunk');
        return;
      }
      // Existing wire protocol: empty binary frame marks completion.
      if (data.byteLength === 0) {
        finishReceive(transferId, meta);
        return;
      }
      const buf = receiveBuffers.get(transferId);
      const sz = (receiveSizes.get(transferId) ?? 0) + data.byteLength;
      if (!buf || sz > meta.size || sz > MAX_FILE_SIZE) {
        failTransfer(transferId, 'File exceeds advertised size');
        return;
      }
      receiveSizes.set(transferId, sz);
      buf.push(new Uint8Array(data));

      if (transfers[transferId]) {
        transfers[transferId].state = 'transferring';
        transfers[transferId].progress = Math.min(100, Math.round((sz / meta.size) * 100));
      }
    };

    dc.onerror = () => {
      if (transfers[transferId]) {
        transfers[transferId].state = 'failed';
        transfers[transferId].error = 'Data channel error';
      }
      cleanup(transferId);
    };

    dc.onclose = () => {
      if (dataChannels.get(transferId) !== dc) return;
      finishReceive(transferId, meta);
    };
  };

  try {
    await pc.setRemoteDescription(offerSdp);
    if (peerConnections.get(transferId) !== pc) throw new Error('Transfer cancelled');
    const answer = await pc.createAnswer();
    if (peerConnections.get(transferId) !== pc) throw new Error('Transfer cancelled');
    await pc.setLocalDescription(answer);
    if (peerConnections.get(transferId) !== pc) throw new Error('Transfer cancelled');
    sendSignal(senderUserId, { type: 'answer', sdp: answer }, transferId);
  } catch (error) { failTransfer(transferId, 'Accept failed'); throw error; }
}

/**
 * Handle an incoming RTC signal (SDP answer or ICE candidate).
 */
export async function handleSignal(
  transferId: string,
  signal: { type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit },
  senderUserId: string,
  meta?: FileTransferMeta,
) {
  const { RTCIceCandidateCtor } = getWebRtcConstructors();
  const pc = peerConnections.get(transferId);

  if (signal.type === 'offer' && meta) {
    // New transfer offer — accept it
    try {
      await acceptTransfer(transferId, meta, signal.sdp!, senderUserId);
    } catch (err) {
      console.warn('[FileTransfer] Failed to accept transfer offer', err);
    }
    return;
  }

  if (!pc || transferPeers.get(transferId) !== senderUserId) return;
  if (signal.type === 'cancel') { cancelTransfer(transferId); return; }

  if (signal.type === 'answer' && signal.sdp?.type === 'answer' && transfers[transferId]?.direction === 'send') {
    await pc.setRemoteDescription(signal.sdp);
  } else if (signal.type === 'ice' && signal.candidate) {
    if (!RTCIceCandidateCtor) {
      console.warn('[FileTransfer] RTCIceCandidate unavailable; dropping ICE candidate');
      return;
    }
    await pc.addIceCandidate(new RTCIceCandidateCtor(signal.candidate));
  }
}

async function streamFile(transferId: string, file: File, dc: RTCDataChannel) {
  const reader = file.stream().getReader();
  readers.set(transferId, reader);
  const active = () => dataChannels.get(transferId) === dc && dc.readyState === 'open';
  let sent = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (!active()) throw new Error('Transfer cancelled');
      if (done) break;

      // Split into CHUNK_SIZE pieces if the stream gives us larger buffers
      let offset = 0;
      while (offset < value.byteLength) {
        const chunk = value.slice(offset, offset + CHUNK_SIZE);
        offset += chunk.byteLength;

        // Wait for buffer to drain if needed (backpressure)
        while (dc.bufferedAmount > CHUNK_SIZE * 8) {
          if (!active()) throw new Error('Transfer cancelled');
          await new Promise((r) => setTimeout(r, 10));
        }

        dc.send(chunk);
        sent += chunk.byteLength;

        if (transfers[transferId]) {
          transfers[transferId].progress = Math.min(100, Math.round((sent / file.size) * 100));
        }
      }
    }

    // Send empty buffer = completion signal
    dc.send(new ArrayBuffer(0));
    if (transfers[transferId]) {
      transfers[transferId].state = 'complete';
      transfers[transferId].progress = 100;
    }
  } catch (err) {
    if (transfers[transferId]) {
      transfers[transferId].state = 'failed';
      transfers[transferId].error = 'Stream read error';
    }
    console.error('[FileTransfer] Stream error', err);
    cleanup(transferId);
  } finally {
    readers.delete(transferId);
    reader.releaseLock();
  }

  // Close after a brief delay to let the final signal through
  setTimeout(() => cleanup(transferId), 2000);
}

function finishReceive(transferId: string, meta: FileTransferMeta) {
  const chunks = receiveBuffers.get(transferId);
  if (!chunks) return;

  const totalSize = chunks.reduce((s, c) => s + c.byteLength, 0);
  if (totalSize !== meta.size || totalSize !== receiveSizes.get(transferId)) {
    failTransfer(transferId, 'File ended before the exact advertised size');
    return;
  }
  const merged = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const blob = new Blob([merged], { type: meta.mimetype });
  const blobUrl = URL.createObjectURL(blob);

  if (transfers[transferId]) {
    transfers[transferId].state = 'complete';
    transfers[transferId].progress = 100;
    transfers[transferId].blobUrl = blobUrl;
  }

  merged.fill(0);
  cleanup(transferId);
}

function failTransfer(transferId: string, error: string) {
  const transfer = transfers[transferId];
  if (transfer && transfer.state !== 'complete') {
    transfer.state = 'failed';
    transfer.error = error;
  }
  cleanup(transferId);
}

export function cancelTransfer(transferId: string): void {
  const transfer = transfers[transferId];
  if (transfer?.blobUrl) { URL.revokeObjectURL(transfer.blobUrl); delete transfer.blobUrl; }
  failTransfer(transferId, 'Transfer cancelled');
}

function cleanup(transferId: string) {
  const reader = readers.get(transferId);
  if (reader) { void reader.cancel().catch(() => {}); readers.delete(transferId); }
  for (const chunk of receiveBuffers.get(transferId) ?? []) chunk.fill(0);
  receiveBuffers.delete(transferId);
  receiveSizes.delete(transferId);
  transferPeers.delete(transferId);
  const dc = dataChannels.get(transferId);
  if (dc) { dc.onopen = dc.onmessage = dc.onerror = dc.onclose = null; }
  if (dc && dc.readyState !== 'closed') {
    try {
      dc.close();
    } catch {
      /* ignore */
    }
  }
  dataChannels.delete(transferId);

  const pc = peerConnections.get(transferId);
  if (pc) {
    pc.onicecandidate = pc.oniceconnectionstatechange = pc.ondatachannel = null;
    try {
      pc.close();
    } catch {
      /* ignore */
    }
  }
  peerConnections.delete(transferId);
}

/**
 * Format file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
