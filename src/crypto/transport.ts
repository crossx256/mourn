import type { InternalMessagePacket } from './types';

export interface VaultHandshakeProof {
  token: string;
  proof: string;
}

export type VaultDeviceProofProvider = () => Promise<VaultHandshakeProof>;

type DeleteNotice = {
  tombstoneId: string;
  linkId: string;
  targetMessageId: string;
};

// Example WebSocket Transport Wrapper
export class VaultTransport {
  private ws: WebSocket | null = null;
  private token: string;
  private deviceId: string;
  private deviceProofProvider: VaultDeviceProofProvider;

  private connectPromise: Promise<void> | null = null;
  private connectionSetupPromise: Promise<void> | null = null;
  private generation = 0;
  private setupAbort: AbortController | null = null;
  private rejectSocket: ((error: Error) => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private shouldReconnect = true;
  private pendingDeleteNotices: DeleteNotice[] = [];
  private static readonly MAX_PENDING_DELETE_NOTICES = 500;
  /** Bound on a single WebSocket handshake: a socket stuck in CONNECTING has no
   *  browser-side timeout, and everything in vault initialization awaits it. */
  static readonly WS_OPEN_TIMEOUT_MS = 15_000;
  private lastDomain: string | null = null;
  private lastSecure: boolean | null = null;
  private lastPath = '/ws/secure';

  // Handlers
  public onMessage?: (msg: InternalMessagePacket) => void;
  /** Fired when the socket transitions open/closed — lets the store re-run
   *  connection-dependent work (e.g. re-request history backfill) after a flap. */
  public onConnectionChange?: (open: boolean) => void;
  public onNotification?: (payload: unknown) => void;
  public onLinkEstablished?: (payload: unknown) => void;
  public onLinkSevered?: (payload: unknown) => void;
  public onVaultSyncRequest?: (payload: unknown) => void;
  /** Fired when another own-device asks this device to relay its local history. */
  public onVaultHistoryRequest?: (payload: unknown) => void;
  /**
   * Another device on this account marked a conversation read. Lets an open
   * phone clear its badge the moment the desktop reads the thread.
   */
  public onVaultReadSync?: (payload: { linkId: string; readAt?: string }) => void;
  public onRtcSignal?: (payload: {
    senderUserId: string;
    senderDeviceId: string;
    signal: unknown;
    transferId: string;
  }) => void;
  public onMessageNack?: (nack: { messageId: string; senderDeviceId?: string }) => void;
  /** Fired for each delete-for-everyone notice (both real-time and catch-up on reconnect). */
  public onDeleteNotice?: (notice: DeleteNotice) => void;
  public onAccountLogin?: (payload: unknown) => void;
  public onPartnerIdentityTrust?: (payload: unknown) => void;
  public onGroupMessage?: (payload: {
    messageId: string;
    groupId: string;
    ciphertextHex: string;
    epoch: number;
    senderId: string;
    senderDeviceId: string;
    createdAt: string;
  }) => void;
  public onGroupMlsCommit?: (payload: {
    groupId: string;
    commit: string;
    epoch: number;
    senderDeviceId: string;
  }) => void;
  public onGroupMlsWelcome?: (payload: { groupId: string; welcomeBlob: string; deviceId?: string }) => void;
  public onGroupEpochMismatch?: (payload: {
    groupId: string;
    expectedEpoch: number;
    receivedEpoch: number;
  }) => void;
  /** The server refused to persist a GROUP_MESSAGE_SUBMIT (Serializable conflict
   *  that outlived its retries). Carries the epoch the message was encrypted at
   *  because GROUP_MESSAGE_SUBMIT has no client id. */
  public onGroupMessageRejected?: (payload: {
    groupId: string;
    epoch?: number;
    reason?: string;
    retryable?: boolean;
  }) => void;
  public onGroupMemberLeft?: (payload: {
    groupId: string;
    leftUserId: string;
    leftDeviceIds: string[];
  }) => void;
  public onInviteAccepted?: (payload: {
    groupId: string;
    inviteeId: string;
    inviteeDeviceId: string;
    /** True when the invitee device already had a roster row and is being
     *  re-provisioned (its previous leaf must be Removed before the new Add). */
    reAdd?: boolean;
  }) => void;
  public onInviteReceived?: (payload: {
    inviteId: string;
    groupId: string;
    inviterId: string;
    groupName: string;
  }) => void;
  public onBroadcastMessage?: (payload: { channelId: string }) => void;

  constructor(deviceId: string, token: string, deviceProofProvider: VaultDeviceProofProvider) {
    this.deviceId = deviceId;
    this.token = token;
    this.deviceProofProvider = deviceProofProvider;
  }

  async connect(domain: string, secure?: boolean, path = '/ws/secure'): Promise<void> {
    this.shouldReconnect = true;
    if (this.connectionSetupPromise) return this.connectionSetupPromise;

    const generation = this.generation;
    const controller = new AbortController();
    this.setupAbort = controller;
    const cancelled = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('Vault connection cancelled')), { once: true });
    });
    const attempt = Promise.race([this.connectInternal(domain, secure, path, generation), cancelled]);
    this.connectionSetupPromise = attempt;
    try {
      await attempt;
    } finally {
      if (this.connectionSetupPromise === attempt) this.connectionSetupPromise = null;
      if (this.setupAbort === controller) this.setupAbort = null;
    }
  }

  private async connectInternal(
    domain: string,
    secure?: boolean,
    path = '/ws/secure',
    generation = this.generation,
  ): Promise<void> {
    if (!domain) {
      throw new Error('Missing websocket domain');
    }
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return this.connectPromise ?? Promise.resolve();
    }

    // Clean up any stale socket before creating a new one.
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }

    const useSecure =
      secure ??
      this.lastSecure ??
      (typeof window !== 'undefined' && window.location.protocol === 'https:');
    const protocol = useSecure ? 'wss:' : 'ws:';
    if (!this.token) {
      throw new Error('Missing device token for secure websocket authentication.');
    }
    // Every connection/reconnect gets a fresh one-time challenge and proves
    // possession of this device's registered Ed25519 identity private key.
    const handshake = await this.deviceProofProvider();
    if (generation !== this.generation || !this.shouldReconnect) {
      throw new Error('Vault connection cancelled');
    }
    if (!handshake.token || !handshake.proof) {
      throw new Error('Vault handshake proof is incomplete.');
    }
    this.token = handshake.token;

    // SECURITY: Do NOT include deviceId in query params (logged by proxies)
    // DeviceId should be sent in subprotocol or extracted from token instead
    const wsPath = path.startsWith('/') ? path : `/${path}`;
    const wsUrl = `${protocol}//${domain}${wsPath}`;
    this.lastDomain = domain;
    this.lastSecure = useSecure;
    this.lastPath = wsPath;
    console.log(
      '[Vault Transport] Attempting WebSocket connection to:',
      wsUrl.replace(/:\d+/, ':<port>'),
    );

    let opened = false;

    this.connectPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      let socket: WebSocket | null = null;
      let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
      const settleHandshake = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (handshakeTimer) {
          clearTimeout(handshakeTimer);
          handshakeTimer = null;
        }
        if (error) {
          // A half-open socket keeps firing onclose/onerror later; close it
          // explicitly so the reconnect scheduler starts from a clean state.
          try {
            socket?.close();
          } catch {
            /* ignore */
          }
          reject(error);
        }
      };

      // A WebSocket open has no built-in timeout: on a stalled mobile network
      // (captive portal, carrier NAT black hole, TLS handshake that neither
      // completes nor fails) the browser can leave the socket CONNECTING for
      // minutes. The vault's whole initialization awaits this promise, so the
      // messaging page sat on "SYNCING ACROSS DEVICES" indefinitely instead of
      // failing over to the normal "Vault connection failed" path. Bound it.
      handshakeTimer = setTimeout(() => {
        console.error('[Vault Transport] WebSocket handshake timed out');
        settleHandshake(new Error('WebSocket handshake timed out'));
      }, VaultTransport.WS_OPEN_TIMEOUT_MS);

      const subprotocols = ['vault-auth', this.token, handshake.proof];
      // SECURITY: Never log tokens/attestation to console - could leak to browser history
      console.log(
        '[Vault Transport] Opening WebSocket connection with auth protocols (protocols redacted)',
      );
      try {
        socket = new WebSocket(wsUrl, subprotocols);
      } catch (error) {
        settleHandshake(error instanceof Error ? error : new Error('WebSocket creation failed'));
        return;
      }
      this.ws = socket;
      this.rejectSocket = settleHandshake;
      const current = () => generation === this.generation && this.ws === socket;

      socket.onopen = () => {
        if (!current() || settled) return;
        opened = true;
        this.reconnectAttempts = 0;
        console.log('[Vault Transport] Connected securely to server routing node.');
        this.onConnectionChange?.(true);
        settleHandshake();
        resolve();
      };

      socket.onmessage = (event) => {
        if (!current()) return;
        try {
          console.log('[Vault Transport] WebSocket message received, parsing...');
          const payload = JSON.parse(event.data);
          console.log('[Vault Transport] Parsed payload type:', payload.type);
          if (payload.type === 'INCOMING_MESSAGE') {
            console.log('[Vault Transport] Got INCOMING_MESSAGE, calling onMessage handler', {
              messageId: payload.messageId,
              senderDeviceId: payload.senderDeviceId,
            });
            if (this.onMessage) {
              this.onMessage({
                id: payload.messageId,
                linkId: payload.linkId,
                suiteId: payload.suiteId,
                senderDeviceId: payload.senderDeviceId,
                ciphertextHex: payload.ciphertextHex,
                nonceHex: payload.nonceHex,
                createdAt: payload.createdAt,
                expiresAt: payload.expiresAt,
                messageIndex: payload.messageIndex ?? 0,
                senderDHRPubHex: payload.senderDHRPubHex,
                pn: payload.pn ?? 0,
                outgoing: payload.outgoing === true,
              });
            } else {
              console.warn('[Vault Transport] No onMessage handler registered!');
            }
            return;
          }

          if (payload.type === 'NOTIFICATION' && this.onNotification) {
            console.log('[Vault Transport] Dispatching NOTIFICATION payload');
            this.onNotification(payload.data ?? payload);
            return;
          }

          if (payload.type === 'LINK_ESTABLISHED' && this.onLinkEstablished) {
            console.log('[Vault Transport] Dispatching LINK_ESTABLISHED payload');
            this.onLinkEstablished(payload.data ?? payload);
            return;
          }

          if (payload.type === 'LINK_SEVERED' && this.onLinkSevered) {
            console.log('[Vault Transport] Dispatching LINK_SEVERED payload');
            this.onLinkSevered(payload.data ?? payload);
            return;
          }

          if (payload.type === 'VAULT_SYNC_REQUEST' && this.onVaultSyncRequest) {
            console.log('[Vault Transport] Dispatching VAULT_SYNC_REQUEST payload');
            this.onVaultSyncRequest(payload.data ?? payload);
            return;
          }

          if (payload.type === 'VAULT_HISTORY_REQUEST' && this.onVaultHistoryRequest) {
            console.log('[Vault Transport] Dispatching VAULT_HISTORY_REQUEST payload');
            this.onVaultHistoryRequest(payload.data ?? payload);
            return;
          }

          if (payload.type === 'VAULT_READ_SYNC' && this.onVaultReadSync) {
            const data = (payload.data ?? payload) as { linkId?: unknown; readAt?: unknown };
            if (typeof data?.linkId === 'string' && data.linkId) {
              this.onVaultReadSync({
                linkId: data.linkId,
                readAt: typeof data.readAt === 'string' ? data.readAt : undefined,
              });
            }
            return;
          }

          if (payload.type === 'RTC_SIGNAL' && this.onRtcSignal) {
            this.onRtcSignal({
              senderUserId: payload.senderUserId,
              senderDeviceId: payload.senderDeviceId,
              signal: payload.signal,
              transferId: payload.transferId,
            });
            return;
          }

          if (payload.type === 'MESSAGE_NACK' && this.onMessageNack) {
            if (typeof payload.messageId !== 'string' || payload.messageId.trim() === '') {
              console.warn('[Vault Transport] Ignoring malformed MESSAGE_NACK payload');
              return;
            }

            console.log('[Vault Transport] Dispatching MESSAGE_NACK payload', {
              messageId: payload.messageId,
              senderDeviceId: payload.senderDeviceId,
            });
            this.onMessageNack({
              messageId: payload.messageId,
              senderDeviceId:
                typeof payload.senderDeviceId === 'string' ? payload.senderDeviceId : undefined,
            });
            return;
          }

          if (payload.type === 'DELETE_NOTICE') {
            const notice: DeleteNotice = {
              tombstoneId: payload.tombstoneId,
              linkId: payload.linkId,
              targetMessageId: payload.targetMessageId,
            };
            if (this.onDeleteNotice) this.onDeleteNotice(notice);
            else {
              this.pendingDeleteNotices.push(notice);
              if (
                this.pendingDeleteNotices.length > VaultTransport.MAX_PENDING_DELETE_NOTICES
              ) {
                this.pendingDeleteNotices.splice(
                  0,
                  this.pendingDeleteNotices.length - VaultTransport.MAX_PENDING_DELETE_NOTICES,
                );
              }
            }
            return;
          }

          if (payload.type === 'ACCOUNT_LOGIN' && this.onAccountLogin) {
            this.onAccountLogin(payload.data ?? payload);
            return;
          }

          if (payload.type === 'PARTNER_IDENTITY_TRUST' && this.onPartnerIdentityTrust) {
            this.onPartnerIdentityTrust(payload.data ?? payload);
            return;
          }

          if (payload.type === 'BROADCAST_NEW_MESSAGE' && this.onBroadcastMessage) {
            if (typeof payload.channelId === 'string' && payload.channelId) {
              this.onBroadcastMessage({ channelId: payload.channelId });
            }
            return;
          }

          if (payload.type === 'GROUP_MESSAGE_RECEIVED' && this.onGroupMessage) {
            this.onGroupMessage({
              messageId: payload.messageId,
              groupId: payload.groupId,
              ciphertextHex: payload.ciphertextHex,
              epoch: payload.epoch,
              senderId: payload.senderId,
              senderDeviceId: payload.senderDeviceId,
              createdAt: payload.createdAt,
            });
            return;
          }

          if (payload.type === 'GROUP_MLS_COMMIT' && this.onGroupMlsCommit) {
            const commitPayload = payload.data ?? payload;
            if (
              typeof commitPayload.groupId !== 'string' ||
              !commitPayload.groupId ||
              typeof commitPayload.commit !== 'string' ||
              !commitPayload.commit
            ) {
              console.warn('[Vault Transport] Ignoring malformed GROUP_MLS_COMMIT payload');
              return;
            }
            this.onGroupMlsCommit({
              groupId: commitPayload.groupId,
              commit: commitPayload.commit,
              epoch: commitPayload.epoch,
              senderDeviceId: commitPayload.senderDeviceId,
            });
            return;
          }

          if (payload.type === 'GROUP_MLS_WELCOME' && this.onGroupMlsWelcome) {
            this.onGroupMlsWelcome({
              groupId: payload.data?.groupId ?? payload.groupId,
              welcomeBlob: payload.data?.welcomeBlob ?? payload.welcomeBlob,
                            deviceId: payload.data?.deviceId ?? payload.deviceId,
            });
            return;
          }

          if (payload.type === 'GROUP_EPOCH_MISMATCH' && this.onGroupEpochMismatch) {
            this.onGroupEpochMismatch({
              groupId: payload.groupId,
              expectedEpoch: payload.expectedEpoch,
              receivedEpoch: payload.receivedEpoch,
            });
            return;
          }

          if (payload.type === 'GROUP_MESSAGE_REJECTED') {
            if (!this.onGroupMessageRejected) return;
            if (typeof payload.groupId !== 'string' || !payload.groupId) return;
            this.onGroupMessageRejected({
              groupId: payload.groupId,
              epoch: typeof payload.epoch === 'number' ? payload.epoch : undefined,
              reason: typeof payload.reason === 'string' ? payload.reason : undefined,
              retryable: payload.retryable === true,
            });
            return;
          }

          if (payload.type === 'GROUP_MEMBER_LEFT' && this.onGroupMemberLeft) {
            this.onGroupMemberLeft({
              groupId: payload.groupId,
              leftUserId: payload.leftUserId,
              leftDeviceIds: Array.isArray(payload.leftDeviceIds) ? payload.leftDeviceIds : [],
            });
            return;
          }

          if (payload.type === 'INVITE_ACCEPTED' && this.onInviteAccepted) {
            this.onInviteAccepted({
              groupId: payload.data?.groupId ?? payload.groupId,
              inviteeId: payload.data?.inviteeId ?? payload.inviteeId,
              inviteeDeviceId: payload.data?.inviteeDeviceId ?? payload.inviteeDeviceId,
              reAdd: payload.data?.reAdd === true,
            });
            return;
          }

          if (payload.type === 'INVITE_RECEIVED' && this.onInviteReceived) {
            this.onInviteReceived({
              inviteId: payload.data?.inviteId ?? payload.inviteId,
              groupId: payload.data?.groupId ?? payload.groupId,
              inviterId: payload.data?.inviterId ?? payload.inviterId,
              groupName:
                payload.data?.group?.name ??
                payload.data?.groupName ??
                payload.groupName ??
                'a group',
            });
            return;
          }
        } catch (err) {
          console.error('[Vault Transport] Error processing inbound frame:', err);
        }
      };

      socket.onerror = (err) => {
        if (!current()) return;
        if (!opened) {
          console.error('[Vault Transport] WebSocket error during handshake:', err);
          settleHandshake(err instanceof Error ? err : new Error('WebSocket error'));
        } else {
          console.error('[Vault Transport] Socket error:', err);
        }
      };

      socket.onclose = (event) => {
        if (!current()) return;
        if (!opened) {
          console.error(
            '[Vault Transport] Connection closed before handshake completed. Backend may have rejected the connection.',
          );
          console.error(
            '[Vault Transport] Check that the backend is reachable and the device session is still authorized.',
          );
          settleHandshake(new Error('WebSocket closed before opening.'));
        } else {
          console.warn(
            '[Vault Transport] Connection closed. Severed from routing node.',
            { code: event?.code, reason: event?.reason, wasClean: event?.wasClean },
          );
          this.onConnectionChange?.(false);
        }
        this.ws = null;
        this.rejectSocket = null;
        if (opened) this.scheduleReconnect();
      };
    })
      .catch((err) => {
        console.error('[Vault Transport] Failed to open websocket', err);
        throw err;
      })
      .finally(() => {
        if (generation === this.generation) this.connectPromise = null;
      });

    return this.connectPromise;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.shouldReconnect || !this.lastDomain) return;
    const baseDelay = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempts, 5));
    // Jitter prevents reconnect storms when many clients recover together.
    const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.shouldReconnect || !this.lastDomain) return;
      void this.connect(this.lastDomain, this.lastSecure ?? undefined, this.lastPath).catch(
        (error: unknown) => {
          const status = (error as { response?: { status?: number } })?.response?.status;
          if (status === 401 || status === 403) {
            this.shouldReconnect = false;
            console.warn('[Vault Transport] Reconnect stopped: authorization is no longer valid.');
            return;
          }
          this.scheduleReconnect();
        },
      );
    }, delay);
  }

  flushPendingEvents(): void {
    if (!this.onDeleteNotice || this.pendingDeleteNotices.length === 0) return;
    const notices = this.pendingDeleteNotices.splice(0);
    for (const notice of notices) this.onDeleteNotice(notice);
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async ensureConnected(): Promise<void> {
    if (this.isOpen()) return;
    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }
    if (!this.lastDomain) {
      throw new Error('No known domain for reconnect.');
    }
    await this.connect(this.lastDomain, this.lastSecure ?? undefined, this.lastPath);
  }

  sendEncryptedPayload(
    targetDeviceId: string,
    ciphertextHex: string,
    nonceHex: string,
    senderDHRPubHex: string,
    pn: number,
    suiteId?: string,
    messageIndex?: number,
  ) {
    if (this.connectPromise) {
      if (!this.isOpen()) {
        throw new Error('WSS transport is connecting.');
      }
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WSS transport is not connected.');
    }

    const packet = {
      type: 'ROUTED_MESSAGE',
      senderDeviceId: this.deviceId,
      targetDeviceId,
      suiteId,
      ciphertextHex,
      nonceHex,
      senderDHRPubHex,
      pn,
      messageIndex,
    };

    this.ws.send(JSON.stringify(packet));
  }

  sendEncryptedPayloadToUser(
    targetUserId: string,
    frames: Array<{
      targetDeviceId: string;
      ciphertextHex: string;
      nonceHex: string;
      senderDHRPubHex: string;
      pn: number;
      suiteId?: string;
      messageIndex?: number;
      clientMessageId?: string;
      /**
       * Marks a frame addressed to another device of the SENDER's own account
       * (multi-device fan-out / history backfill). The server persists it for
       * that own-device and delivers it with `outgoing: true`, with no push.
       */
      selfSync?: boolean;
      /** Link this frame belongs to (required for self-only backfill packets). */
      linkId?: string;
    }>,
    options?: { deleteTargetMessageId?: string },
  ) {
    if (this.connectPromise) {
      if (!this.isOpen()) {
        throw new Error('WSS transport is connecting.');
      }
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WSS transport is not connected.');
    }

    const packet = {
      type: 'ROUTED_MESSAGE_USER',
      senderDeviceId: this.deviceId,
      targetUserId,
      frames,
      deleteTargetMessageId: options?.deleteTargetMessageId,
    };

    this.ws.send(JSON.stringify(packet));
  }

  requestVaultSync() {
    if (this.connectPromise) {
      if (!this.isOpen()) {
        throw new Error('WSS transport is connecting.');
      }
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WSS transport is not connected.');
    }

    this.ws.send(
      JSON.stringify({
        type: 'VAULT_SYNC_REQUEST',
        senderDeviceId: this.deviceId,
      }),
    );
  }

  /**
   * Ask the user's OTHER connected devices to relay their locally-persisted
   * history to THIS device. The desktop answers by re-encrypting its stored
   * message log to `requesterDevicePub` using a self-session engine.
   *
   * This is a control frame (exempt from the strict 10/3s message limiter).
   */
  requestVaultHistory(requesterDevicePub: string, requesterPlatform?: string, requestId?: string) {
    if (this.connectPromise) {
      if (!this.isOpen()) {
        throw new Error('WSS transport is connecting.');
      }
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WSS transport is not connected.');
    }

    this.ws.send(
      JSON.stringify({
        type: 'VAULT_HISTORY_REQUEST',
        senderDeviceId: this.deviceId,
        requestId: requestId || `hist_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        requesterDevicePub,
        requesterPlatform,
      }),
    );
  }

  ackMessage(messageId: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: 'MESSAGE_ACK',
        senderDeviceId: this.deviceId,
        messageId,
      }),
    );
  }

  nackMessage(messageId: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: 'MESSAGE_NACK',
        senderDeviceId: this.deviceId,
        messageId,
      }),
    );
  }

  syncKeyRotation(newDevicePub: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: 'RATCHET_KEY_EXCHANGE',
        newDevicePub,
      }),
    );
  }

  sendRtcSignal(targetUserId: string, signal: unknown, transferId: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WSS transport is not connected.');
    }
    this.ws.send(
      JSON.stringify({
        type: 'RTC_SIGNAL',
        targetUserId,
        signal,
        transferId,
      }),
    );
  }

  /**
   * Submit an MLS/TreesKEM ciphertext to a group. This is the REAL group
   * ingress — the server only stores ciphertext + epoch and broadcasts to
   * member devices (zero-trust). The caller is responsible for producing the
   * ciphertext via the MLS crypto layer; this wrapper just frames + sends it
   * over the authenticated vault socket.
   */
  sendGroupMessage(groupId: string, ciphertextHex: string, epoch: number) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WSS transport is not connected.');
    }
    this.ws.send(
      JSON.stringify({
        type: 'GROUP_MESSAGE_SUBMIT',
        senderDeviceId: this.deviceId,
        groupId,
        ciphertextHex,
        epoch,
      }),
    );
  }

  disconnect() {
    this.shouldReconnect = false;
    this.generation += 1;
    this.setupAbort?.abort();
    this.setupAbort = null;
    this.rejectSocket?.(new Error('Vault connection cancelled'));
    this.rejectSocket = null;
    this.connectionSetupPromise = null;
    this.connectPromise = null;
    this.pendingDeleteNotices = [];
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.ws;
    this.ws = null;
    if (socket) socket.close();
  }
}
