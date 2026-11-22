import { defineBoot } from '#q-app';
import { watch } from 'vue';
import { isNativeBuild } from 'src/utils/platform';
import { useAuthStore } from 'src/stores/auth';
import { useVaultStore } from 'src/stores/vault';
import { useLinksStore } from 'src/stores/links';
import { useCallsStore, setCallTransport } from 'src/stores/calls';
import { callsApi } from 'src/calls/api';
import { isUUID } from 'src/calls/codec';
import { AndroidCalls, isAndroidCallsPlatform } from 'src/calls/android';

export function installCalls() {
  const auth = useAuthStore();
  const vault = useVaultStore();
  const links = useLinksStore();
  const calls = useCallsStore();
  const subscriptions: (() => void)[] = [];
  let revision = 0;
  let nativeReady = false;
  let drainingNative = false;
  let nativeHint = false;
  let managerReady: Promise<void> = Promise.resolve();
  let previousAccount: string | null = null;
  let previousDevice: string | null = null;
  async function drainNative() {
    nativeHint = true;
    if (!nativeReady || drainingNative || !isAndroidCallsPlatform()) return;
    drainingNative = true;
    const current = revision;
    try {
      while (nativeHint && nativeReady && current === revision) {
        nativeHint = false;
        const { actions } = await AndroidCalls.getPendingActions();
        for (const action of actions) {
          if (current !== revision || !nativeReady) return;
          if (!isUUID(action.callId)) continue;
          await calls.receiveState(action.callId);
          if (current !== revision || !nativeReady) return;
          if (calls.call?.id !== action.callId || !calls.busy) continue;
          if (action.action === 'answer') await calls.accept();
          else if (action.action === 'decline') await calls.decline();
          else if (action.action === 'end') await calls.hangup();
          calls.minimized = false;
        }
      }
    } catch {
      /* Native actions are untrusted hints; no unauthenticated capture. */
    } finally {
      drainingNative = false;
    }
  }
  const nativeListeners = isAndroidCallsPlatform()
    ? Promise.all([
        AndroidCalls.addListener('callActionAvailable', () => {
          void drainNative();
        }),
        AndroidCalls.addListener('callServiceState', (event) => {
          void calls.nativeServiceChanged(event.callId, event.state);
        }),
        AndroidCalls.addListener('audioFocusChanged', (event) => {
          if (event.callId === calls.call?.id) calls.audioFocusChanged(event.focus);
        }),
      ])
    : Promise.resolve([]);
  void nativeListeners.catch(() => {});
  const unbind = () => {
    subscriptions.splice(0).forEach((stop) => stop());
    setCallTransport(null);
  };
  const callId = (event: unknown) => {
    if (!event || typeof event !== 'object' || !('callId' in event)) return null;
    return isUUID(event.callId) ? event.callId : null;
  };
  async function reconcileOnline() {
    if (!auth.isLoggedIn || !vault.deviceId) return;
    const current = revision;
    const ready = managerReady;
    try {
      await ready;
      if (current !== revision) return;
      for (const call of await callsApi.active()) {
        if (current !== revision) return;
        await calls.receiveState(call.id);
        if (current !== revision) return;

      }
    } catch {
      /* Socket restoration or the next reconcile retries. */
    }
  }
  watch(
    () => [auth.user?.id, auth.isLoggedIn, vault.deviceId] as const,
    ([userId, loggedIn, deviceId]) => {
      const current = ++revision;
      const accountBoundary = previousAccount !== null && (
        !loggedIn || userId !== previousAccount || deviceId !== previousDevice
      );
      previousAccount = loggedIn && userId && deviceId ? userId : null;
      previousDevice = loggedIn && userId && deviceId ? deviceId : null;
      nativeReady = false;
      unbind();
      // Teardown starts synchronously; a queued initialization must not hold the mic across logout.
      const stopped = calls.destroy({ accountBoundary });
      if (!loggedIn || !userId || !deviceId) return;
      const assertCurrent = () => {
        if (current !== revision || !auth.isLoggedIn || auth.user?.id !== userId || vault.deviceId !== deviceId)
          throw new Error('CALL_ACCOUNT_CHANGED');
      };
      const ready = stopped.then(async () => {
        assertCurrent();
        await calls.initialize(userId, deviceId);
        assertCurrent();
        await calls.discardInterruptedCalls();
        assertCurrent();
      });
      managerReady = ready;
      void ready.catch(() => {});
      const controller = vault.getCallSignalTransport();
      setCallTransport({
        admit: async (id, created) => {
          assertCurrent();
          await vault.admitCallSignals(id, created);
          assertCurrent();
        },
        retire: (id) => controller.retireCall(id),
        send: async (linkId, target, body) => {
          assertCurrent();
          const call = calls.call?.id === body.cid ? calls.call : await callsApi.get(body.cid);
          assertCurrent();
          if (call.linkId !== linkId || ![call.callerId, call.calleeId].includes(userId))
            throw new Error('CALL_PEER_MISMATCH');
          const peer = call.callerId === userId ? call.calleeId : call.callerId;
          return controller.send(linkId, peer, [{ id: target }], body);
        },
      });
      subscriptions.push(
        controller.onSignal(async (event) => {
          await ready;
          assertCurrent();
          await calls.receiveSignal(event.body);
        }),
      );
      subscriptions.push(
        controller.onIncoming((event) => {
          const id = callId(event);
          if (id && current === revision) void ready.then(async () => {
            assertCurrent();
            await calls.receiveIncoming(id);
          }).catch(() => {});
        }),
      );
      subscriptions.push(controller.onReady((event) => {
        const id = callId(event);
        const peer = (event as { deviceId?: unknown } | null)?.deviceId;
        if (id && isUUID(peer) && current === revision) return ready.then(async () => {
          assertCurrent();
          await calls.peerReady(id, peer);
        }).catch(() => {});
        return Promise.resolve();
      }));
      subscriptions.push(
        controller.onState((event) => {
          const id = callId(event);
          if (id && current === revision) {
            const hint = event as { state?: unknown; answeredDeviceId?: unknown; reason?: unknown };
            void calls.receiveState(id, typeof hint.state === 'string' ? {
              state: hint.state,
              answeredDeviceId: typeof hint.answeredDeviceId === 'string' ? hint.answeredDeviceId : null,
              reason: typeof hint.reason === 'string' ? hint.reason : null,
            } : undefined);
          }
        }),
      );
      void ready
        .then(async () => {
          if (current !== revision) return;
          await reconcileOnline();
          await nativeListeners;
          if (current !== revision) return;
          nativeReady = true;
          await drainNative();
        })
        .catch(() => {});
    },
    { immediate: true, flush: 'sync' },
  );
  watch(
    () => vault.transportConnected,
    (connected) => {
      void calls.socketChanged(connected);
      if (connected) void reconcileOnline();
    },
  );
  watch(
    () => links.links,
    (rows) => {
      if (!calls.call || !calls.busy) return;
      const link = rows.find((row) => row.id === calls.call?.linkId);
      if (link && !['ESTABLISHED', 'ANCHORED'].includes(link.status)) void calls.linkSevered();
    },
    { deep: true },
  );
  // Config polling makes the server kill switch effective without a new release.
  const poll = setInterval(() => {
    if (auth.isLoggedIn && vault.deviceId) void calls.refreshConfig();
  }, 30_000);
  const focus = () => {
    if (auth.isLoggedIn && vault.deviceId) void calls.refreshConfig();
  };
  window.addEventListener('focus', focus);
  if (import.meta.hot)
    import.meta.hot.dispose(() => {
      revision++;
      nativeReady = false;
      unbind();
      clearInterval(poll);
      window.removeEventListener('focus', focus);
      void calls.destroy({ accountBoundary: true });
      void nativeListeners
        .then((handles) => Promise.all(handles.map((handle) => handle.remove())))
        .catch(() => {});
    });
}

export default defineBoot(() => {
  if (import.meta.env.QUASAR_SERVER || !isNativeBuild) return;
  installCalls();
});
