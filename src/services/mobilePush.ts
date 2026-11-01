import type { Router } from 'vue-router';
import { showArrivalBanner } from 'src/composables/useArrivalBanner';
import { api } from 'boot/axios';
import { getSecureStorage } from 'src/services/nativeSecureStorage';
import { isMobileAuthRuntime } from 'src/services/mobileAuth';
import { mobilePlatform } from 'src/utils/platform';
import { ARRIVAL_TTL_MS, arrivalKeyFor, createTtlDedupe } from 'src/services/pushDedupe';

const PUSH_TOKEN_SLOT = 'mobile:push-token';
const PUSH_TOKEN_ENDPOINT = '/api/v1/auth/mobile/push-token';
let initialized = false;
let activeRouter: Router | null = null;
let registrationPromise: Promise<void> | null = null;

// FCM/APNs can deliver the same payload more than once (provider retry, or the
// arrival reaching both the foreground and action listeners). Remember what we
// have already reconciled/bannered for a few minutes so a duplicate does not
// re-run the heavy store reconciliation or post a second banner. The keys derive
// from the server's coalescing metadata (messageId / conversationKey+count).
const reconciledArrivals = createTtlDedupe(ARRIVAL_TTL_MS);
const banneredArrivals = createTtlDedupe(ARRIVAL_TTL_MS);

function metadata(data: unknown): Record<string, string> {
  if (!data || typeof data !== 'object') return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (typeof value === 'string' && value.length <= 256) result[key] = value;
  }
  return result;
}

async function processPush(data: unknown, navigate: boolean): Promise<void> {
  if (!isMobileAuthRuntime()) return;

  // Duplicate-delivery guard. Skip re-processing an arrival we have already
  // reconciled within the TTL window so a double delivery cannot storm
  // fetchPendingMessages / fetchNotifications / fetchLinks twice. An explicit
  // user tap (navigate) is never suppressed, so its deep link always lands.
  const duplicateArrival = reconciledArrivals.seen(arrivalKeyFor(data));
  if (duplicateArrival && !navigate) return;

  const authStore = (await import('src/stores/auth')).useAuthStore();
  if (!authStore.isLoggedIn) {
    const restored = (await authStore.checkSession()) || (await authStore.autoLogin());
    if (!restored) return;
  }

  const vaultStore = (await import('src/stores/vault')).useVaultStore();
  // Do NOT re-run a full vault init on every push/tap. init re-registers this
  // device and re-pulls pending frames, and doing it per push was one of the
  // paths that stormed the HTTP/WSS rate limiters. `initialize()` is already a
  // no-op once established, so gating on the flag removes the redundant work.
  if (!vaultStore.isInitialized) {
    await vaultStore.initialize();
  }
  await vaultStore.fetchPendingMessages({ forceRetry: true });

  // A push is authoritative "something changed", so reconcile the stores the UI
  // renders from. Without this a notification arriving while the app was open
  // stayed invisible until the next 5-minute poll — the "notifications are
  // delayed / only show when I open the app" report.
  const notificationsStore = (await import('src/stores/notifications')).useNotificationsStore();
  void notificationsStore.fetchNotifications();
  const linksStore = (await import('src/stores/links')).useLinksStore();
  void linksStore.fetchLinks({ silent: true });

  if (!navigate || !activeRouter) return;
  // Capture non-null for use inside the closure below (TS cannot narrow a
  // mutable module-level binding across a function boundary).
  const router = activeRouter;
  const pushMetadata = metadata(data);
  const linkId = pushMetadata.linkId;
  const groupId = pushMetadata.groupId;

  // Every tap must LAND somewhere. Previously a push with no link/group id
  // (link requests, watcher alerts, group-join events, or a stale message whose
  // row is already gone) fell into `return` — the app opened and nothing
  // happened, which is the reported "ghost notification". Fall back to the
  // messages surface so a tap always shows the list (with its unread badges).
  const landOnMessages = async () => {
    try {
      await router.push({ name: 'chains' });
    } catch {
      /* route may be unavailable — nothing else to do */
    }
  };

  if (!linkId && !groupId) {
    await landOnMessages();
    return;
  }

  if (linkId) {
    await linksStore.fetchLinks({ silent: true });
    if (!linksStore.links.some((link) => link.id === linkId)) {
      // Link is gone (severed / deleted, or the fetch failed) — still land on the
      // chat list rather than doing nothing.
      await landOnMessages();
      return;
    }
    vaultStore.setActiveLink(linkId);
    await activeRouter.push({ name: 'chains' });
    return;
  }

  // Suite push. The group store owns which chat is open (MessagingPage renders
  // GroupChatWindow off groupStore.activeGroupId), so setting it and landing on
  // the messaging route opens the right thread. Same membership guard the page's
  // own openGroupChat uses, so a stale push cannot open a group we left.
  if (!groupId) return;
  const groupStore = (await import('src/stores/groupStore')).useGroupStore();
  const group = groupStore.groups.get(groupId);
  if (!group || group.isLeft) {
    await landOnMessages();
    return;
  }
  groupStore.setActiveGroup(groupId);
  await activeRouter.push({ name: 'chains' });
}

function backendPlatform(): 'ANDROID' | 'IOS' | null {
  const platform = mobilePlatform();
  if (platform === 'android') return 'ANDROID';
  if (platform === 'ios') return 'IOS';
  return null;
}

/** Generic, content-free copy by event — the fallback used when no actor is known.
 *  Mirrors services/fcmProvider.js GENERIC_BODY_BY_EVENT. */
const GENERIC_BODY_BY_EVENT: Record<string, string> = {
  INCOMING_MESSAGE: 'You have a new message.',
  GROUP_MESSAGE_RECEIVED: 'You have a new message.',
  WATCHER_ALERT: 'A security event needs your attention.',
  GROUP_JOIN_REQUEST: 'You have a new Suite request.',
  // Recognised-domain (link verification) decision. Mirrors services/fcmProvider.js.
  DOMAIN_DECISION: 'A link you asked us to verify was reviewed.',
  LINK_REQUEST: 'Someone wants to establish a link with you.',
  NOTIFICATION: 'You have a new notification.',
  // A Suite invitation arrives as `INVITE_RECEIVED`; with no entry it fell through
  // to "You have a new message." for every invitation.
  GROUP_INVITE: 'You have a new Suite invitation.',
  INVITE_RECEIVED: 'You have a new Suite invitation.',
};

/** Events whose banner names the actor when the server supplied a senderLabel.
 *  Mirrors services/fcmProvider.js EVENT_BODY_WITH_LABEL so the in-app banner and
 *  the tray entry read identically (e.g. "Suite invitation from ana"). Both the
 *  new `GROUP_INVITE` event name and the older `INVITE_RECEIVED` frame type are
 *  mapped so this is correct whether or not the backend has been redeployed. */
const EVENT_BODY_WITH_LABEL: Record<string, (label: string) => string> = {
  LINK_REQUEST: (label) => `Link request from ${label}`,
  GROUP_INVITE: (label) => `Suite invitation from ${label}`,
  INVITE_RECEIVED: (label) => `Suite invitation from ${label}`,
  GROUP_JOIN_REQUEST: (label) => `Suite request from ${label}`,
  GROUP_JOIN_ACCEPTED: (label) => `You were accepted into a Suite by ${label}`,
};

function genericNotificationBody(data: unknown): string {
  const meta = metadata(data);
  const event = meta.event ?? '';
  const label = typeof meta.senderLabel === 'string' ? meta.senderLabel.trim() : '';
  const namedBody = label ? EVENT_BODY_WITH_LABEL[event] : undefined;
  if (namedBody) return namedBody(label);
  return GENERIC_BODY_BY_EVENT[event] ?? 'You have a new message.';
}

/**
 * Arrival notice while the app is in the foreground.
 *
 * When Mourn is not in front of the user the provider's notification block is what
 * Android displays — with sound — so the foreground case must NOT post anything to the
 * tray. Doing so was the duplicate notification seen while sitting inside a
 * conversation. Inside the app the arrival is announced the way Telegram does it: a
 * transient banner, no sound, no tray entry.
 *
 * Idempotent: the banner is keyed by the arrival identity (`messageId` /
 * `conversationKey` + `conversationCount`) so a duplicate delivery shows one
 * banner, never two. No tray notification is posted from JS — the provider owns
 * the tray entry, keyed by its own stable per-conversation `tag`.
 */
async function showForegroundArrivalBanner(data: unknown): Promise<void> {
  if (!isMobileAuthRuntime()) return;
  // Visible means the app is in front of the user. When it is hidden or backgrounded
  // the tray notification already covers this, sound included.
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
  if (banneredArrivals.seen(arrivalKeyFor(data))) return;

  // Honour the user's preference (settings -> app -> in-app message banner). Silence
  // is worse than an unwanted banner, so a settings failure still announces.
  try {
    const settings = (await import('src/stores/appSettings')).useAppSettingsStore();
    settings.hydrate();
    if (!settings.inAppMessageBanner) return;
  } catch (error) {
    console.warn('[Push] Could not read the in-app banner setting; showing it anyway', error);
  }

  const meta = metadata(data);
  const linkId = meta.linkId || null;
  const groupId = meta.groupId || null;

  // A normal message is announced by the vault's ingest path instead: that is where
  // the DECRYPTED text and the real sender exist, and it runs whichever way the
  // message actually arrives (socket, pending fetch, or this push triggering that
  // fetch). Announcing here too would double up, so this path keeps to non-message
  // arrivals — link requests, Suite invitations, watcher alerts — which never
  // produce a vault message.
  if (linkId) return;

  const body = genericNotificationBody(data);

  // Replaces the old Quasar toast. The toast was also the surface that silently threw
  // in the production bundle (`Notify.create` was not callable through the dynamic
  // import interop), which is why a live arrival showed nothing at all.
  // STATIC import for the same reason as the preview above: the banner module holds
  // singleton state, and a dynamic import can instantiate a second copy of it.
  showArrivalBanner({
    id: arrivalKeyFor(data),
    title: meta.senderLabel || 'Mourn',
    body,
    linkId,
    groupId,
  });
}

async function registerTokenWithBackend(token: string): Promise<void> {
  const authStore = (await import('src/stores/auth')).useAuthStore();
  const vaultStore = (await import('src/stores/vault')).useVaultStore();
  const platform = backendPlatform();
  if (!authStore.isLoggedIn || !vaultStore.deviceId || !platform) return;

  // A cold start can reach this BEFORE the server knows this device is bound: the
  // vault device registration completes a moment later, and until it does the
  // endpoint answers 403 "A bound mobile Vault device is required" (observed on a
  // real device at boot). Giving up there left the push token unregistered for the
  // whole session — notifications silently never arrive. Retry the transient
  // statuses briefly; a genuine 401/404 still fails fast.
  const maxAttempts = 4;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await api.post(PUSH_TOKEN_ENDPOINT, { token, platform });
      return;
    } catch (error) {
      lastError = error;
      const status = (error as { response?: { status?: number } })?.response?.status;
      const transient = status === 403 || status === 429 || status === 503;
      if (!transient || attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw lastError;
}

async function handleRegistrationToken(token: string): Promise<void> {
  if (!token) return;
  const storage = getSecureStorage();
  if (!storage) throw new Error('Mobile secure storage is unavailable');
  await storage.set(PUSH_TOKEN_SLOT, token);
  await registerTokenWithBackend(token);
}

/**
 * Android notification channel id. Must stay in sync with
 * `com.google.firebase.messaging.default_notification_channel_id` in
 * src-capacitor/android/app/src/main/AndroidManifest.xml, and with the
 * `android.notification.channel_id` the backend sends.
 */
const ANDROID_CHANNEL_ID = 'mourn_default';

export async function initializeMobilePush(router: Router): Promise<void> {
  if (!isMobileAuthRuntime()) return;
  activeRouter = router;
  if (initialized) return;

  const { PushNotifications } = await import('@capacitor/push-notifications');

  // Android 8+ requires an explicit channel; without it notifications land in an
  // auto-generated "Miscellaneous" channel the user cannot tune. Re-creating an
  // existing channel is a no-op. iOS (and Android < 8) have no channels at all,
  // so a failure here is not fatal. visibility 0 = PRIVATE (kept off the lock
  // screen) to match this app's privacy posture — set to 1 for PUBLIC.
  await PushNotifications.createChannel({
    id: ANDROID_CHANNEL_ID,
    name: 'Mourn',
    description: 'Messages, security alerts and account activity',
    importance: 4,
    visibility: 0,
  }).catch((error) => {
    console.warn('[Push] Channel setup skipped', error);
  });

  await PushNotifications.addListener('registration', (registration) => {
    void handleRegistrationToken(registration.value).catch((error) => {
      console.warn('[Push] Failed to register rotated token', error);
    });
  });
  await PushNotifications.addListener('registrationError', (error) => {
    console.warn('[Push] Native registration failed', error);
  });
  await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    // Metadata-only reconciliation: never display provider-controlled title/body.
    void processPush(notification.data, false).catch((error) => {
      console.warn('[Push] Foreground reconciliation failed', error);
    });
    void showForegroundArrivalBanner(notification.data).catch((error) => {
      console.warn('[Push] Foreground arrival banner failed', error);
    });
  });
  await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    void processPush(action.notification.data, true).catch((error) => {
      console.warn('[Push] Notification action reconciliation failed', error);
    });
  });
  initialized = true;

  // JavaScript listeners are not sufficient for killed-app delivery. FCM/APNs
  // credentials, Android manifest/services, iOS capabilities/entitlements, and
  // provider payload configuration must be completed in the native projects.
}

export async function syncMobilePushRegistration(): Promise<void> {
  if (!isMobileAuthRuntime()) return;
  if (registrationPromise) return registrationPromise;

  registrationPromise = (async () => {
    const authStore = (await import('src/stores/auth')).useAuthStore();
    const vaultStore = (await import('src/stores/vault')).useVaultStore();
    if (!authStore.isLoggedIn || !vaultStore.deviceId) return;

    const { PushNotifications } = await import('@capacitor/push-notifications');
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      permission = await PushNotifications.requestPermissions();
    }
    if (permission.receive !== 'granted') return;

    const storedToken = await getSecureStorage()?.get(PUSH_TOKEN_SLOT);
    if (storedToken) await registerTokenWithBackend(storedToken);
    await PushNotifications.register();
  })().finally(() => {
    registrationPromise = null;
  });

  return registrationPromise;
}

export async function onMobileDeviceRegistered(): Promise<void> {
  await syncMobilePushRegistration();
}

export async function unregisterMobilePushToken(): Promise<void> {
  if (!isMobileAuthRuntime()) return;
  const storage = getSecureStorage();
  const token = await storage?.get(PUSH_TOKEN_SLOT);
  const platform = backendPlatform();
  if (token && platform) {
    await api.delete(PUSH_TOKEN_ENDPOINT, {
      data: { token, platform },
      withCredentials: false,
    });
    await storage?.remove(PUSH_TOKEN_SLOT);
  }
}
