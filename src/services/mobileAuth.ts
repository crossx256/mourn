import { getSecureStorage } from 'src/services/nativeSecureStorage';
import type {
  MobileAuthCredentialsPayload,
  MobileDeviceBindingRecord,
  MobileDeviceRegistrationPayload,
  MobileSessionRecord,
} from 'src/types/api';
import { isCapacitorRuntime, isMobileBuild } from 'src/utils/platform';

const MOBILE_SESSION_SLOT = 'mobile:auth-session';
const MOBILE_DEVICE_SLOT_PREFIX = 'mobile:device-binding:';
const MIN_REFRESH_DELAY_MS = 1_000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;

let cachedSession: MobileSessionRecord | null | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function isMobileAuthRuntime(): boolean {
  return isMobileBuild && isCapacitorRuntime();
}

function secureStorage() {
  if (!isMobileAuthRuntime()) return null;
  return getSecureStorage();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseSession(raw: string | null): MobileSessionRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<MobileSessionRecord>;
    if (
      typeof value.token !== 'string' ||
      !value.token ||
      typeof value.csrfToken !== 'string' ||
      !value.csrfToken ||
      typeof value.issuedAt !== 'number' ||
      !Number.isFinite(value.issuedAt) ||
      typeof value.expiresAt !== 'number' ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= value.issuedAt ||
      typeof value.username !== 'string' ||
      !value.username
    ) {
      return null;
    }
    return {
      token: value.token,
      csrfToken: value.csrfToken,
      issuedAt: value.issuedAt,
      expiresAt: value.expiresAt,
      username: value.username,
      deviceHash: optionalString(value.deviceHash),
      deviceId: optionalString(value.deviceId),
    };
  } catch {
    return null;
  }
}

function parseDeviceBinding(raw: string | null): MobileDeviceBindingRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<MobileDeviceBindingRecord>;
    if (
      typeof value.username !== 'string' ||
      !value.username ||
      typeof value.deviceHash !== 'string' ||
      !value.deviceHash
    ) {
      return null;
    }
    return {
      username: value.username,
      deviceHash: value.deviceHash,
      deviceId: optionalString(value.deviceId),
    };
  } catch {
    return null;
  }
}

export async function getMobileSession(): Promise<MobileSessionRecord | null> {
  if (!isMobileAuthRuntime()) return null;
  if (cachedSession !== undefined) return cachedSession;

  const storage = secureStorage();
  if (!storage) return null;
  cachedSession = parseSession(await storage.get(MOBILE_SESSION_SLOT));
  return cachedSession;
}

export async function saveMobileSession(session: MobileSessionRecord): Promise<void> {
  const storage = secureStorage();
  if (!storage) throw new Error('Mobile secure storage is unavailable');
  cachedSession = session;
  await storage.set(MOBILE_SESSION_SLOT, JSON.stringify(session));
}

export async function clearMobileSession(): Promise<void> {
  cachedSession = null;
  cancelScheduledMobileRefresh();
  const storage = secureStorage();
  if (!storage) return;
  await storage.remove(MOBILE_SESSION_SLOT);
}

function deviceBindingSlot(username: string): string {
  return `${MOBILE_DEVICE_SLOT_PREFIX}${username.trim().toLowerCase()}`;
}

export async function getMobileDeviceBinding(
  username?: string,
): Promise<MobileDeviceBindingRecord | null> {
  if (!username) return null;
  const storage = secureStorage();
  if (!storage) return null;
  const binding = parseDeviceBinding(await storage.get(deviceBindingSlot(username)));
  if (binding?.username.toLowerCase() !== username.toLowerCase()) return null;
  return binding;
}

async function saveMobileDeviceBinding(binding: MobileDeviceBindingRecord): Promise<void> {
  const storage = secureStorage();
  if (!storage) throw new Error('Mobile secure storage is unavailable');
  await storage.set(deviceBindingSlot(binding.username), JSON.stringify(binding));
}

function sessionFromCredentials(
  credentials: MobileAuthCredentialsPayload,
  username: string,
  previous?: Pick<MobileSessionRecord, 'deviceHash' | 'deviceId'> | null,
): MobileSessionRecord {
  if (
    !credentials.token ||
    !credentials.csrfToken ||
    !Number.isFinite(credentials.tokenExpiresIn) ||
    credentials.tokenExpiresIn <= 0
  ) {
    throw new Error('Mobile authentication response is incomplete');
  }
  const issuedAt = Date.now();
  return {
    token: credentials.token,
    csrfToken: credentials.csrfToken,
    issuedAt,
    expiresAt: issuedAt + credentials.tokenExpiresIn * 1_000,
    username,
    deviceHash: previous?.deviceHash,
    deviceId: previous?.deviceId,
  };
}

export async function storeMobileAuthCredentials(
  credentials: MobileAuthCredentialsPayload,
  username: string,
): Promise<MobileSessionRecord> {
  const previous = await getMobileSession();
  // ACCOUNT-SCOPED WRITE: the secure store holds exactly ONE session, so a write
  // for a different account would silently replace someone else's token. That
  // happened when a slow refresh or reauth resolved after the account switched.
  // The caller (login flow) is responsible for clearing the old session first.
  if (previous && previous.username.toLowerCase() !== username.trim().toLowerCase()) {
    throw new Error(
      `Refusing to store a mobile session for a different account (${username}) over ${previous.username}`,
    );
  }
  const sameAccountSession =
    previous?.username.toLowerCase() === username.toLowerCase() ? previous : null;
  const binding = await getMobileDeviceBinding(username);
  const session = sessionFromCredentials(credentials, username, {
    deviceHash: binding?.deviceHash ?? sameAccountSession?.deviceHash,
    deviceId: binding?.deviceId ?? sameAccountSession?.deviceId,
  });
  await saveMobileSession(session);
  return session;
}

/** The account generation a mobile operation started under. */
export interface MobileSessionRefreshedTicket {
  username: string;
  generation: number;
}

/**
 * Persist a refreshed token, but ONLY for the account + auth generation the
 * refresh was started for.
 *
 * `refreshMobileSession()` reads the session, awaits the network, then writes.
 * In between, another account can log in (or a mobile invalidation/teardown can
 * run) and bump `authOperationGeneration`. Writing the rotated token then either
 * replaced the new account's session or resurrected a session the store had
 * just cleared. Both throw `MobileSessionSuperseded`, and the caller treats it
 * as "this refresh lost" rather than as a dead session.
 */
export async function storeRefreshedMobileSession(
  credentials: MobileAuthCredentialsPayload,
  ticket: MobileSessionRefreshedTicket,
): Promise<MobileSessionRecord> {
  const { useAuthStore } = await import('src/stores/auth');
  const auth = useAuthStore();
  const currentUsername = auth.user?.username;
  if (
    auth.authOperationGeneration !== ticket.generation ||
    (currentUsername &&
      currentUsername.trim().toLowerCase() !== ticket.username.trim().toLowerCase())
  ) {
    throw new Error(
      `Mobile session refresh superseded: the account changed while it was in flight (${ticket.username})`,
    );
  }
  return storeMobileAuthCredentials(credentials, ticket.username);
}

export async function applyMobileDeviceRegistration(
  payload: MobileDeviceRegistrationPayload,
): Promise<MobileSessionRecord | null> {
  if (!isMobileAuthRuntime()) return null;
  const current = await getMobileSession();
  if (!current) throw new Error('Cannot bind a mobile device without an authenticated session');

  const deviceId = optionalString(payload.device?.id) ?? optionalString(payload.deviceId);
  const deviceHash = optionalString(payload.device?.deviceHash);
  if (!deviceId || !deviceHash) throw new Error('Device registration response is incomplete');

  await saveMobileDeviceBinding({ username: current.username, deviceHash, deviceId });

  let next: MobileSessionRecord = { ...current, deviceHash, deviceId };
  if (payload.token && payload.csrfToken && payload.authTokenExpiresIn) {
    next = sessionFromCredentials(
      {
        token: payload.token,
        csrfToken: payload.csrfToken,
        tokenExpiresIn: payload.authTokenExpiresIn,
      },
      current.username,
      next,
    );
  }
  await saveMobileSession(next);
  return next;
}

export function cancelScheduledMobileRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
}

export async function refreshMobileSessionIfDue(refresh: () => Promise<unknown>): Promise<void> {
  const session = await getMobileSession();
  if (!session) return;
  const ttl = session.expiresAt - session.issuedAt;
  if (!Number.isFinite(ttl) || ttl <= 0) return;
  if (Date.now() >= session.issuedAt + ttl * 0.8) await refresh();
  else scheduleMobileSessionRefresh(session, refresh);
}

export function scheduleMobileSessionRefresh(
  session: MobileSessionRecord,
  refresh: () => Promise<unknown>,
): void {
  cancelScheduledMobileRefresh();
  if (!isMobileAuthRuntime()) return;

  const ttl = session.expiresAt - session.issuedAt;
  if (!Number.isFinite(ttl) || ttl <= 0) return;
  const target = session.issuedAt + ttl * 0.8;
  const delay = Math.min(MAX_TIMER_DELAY_MS, Math.max(MIN_REFRESH_DELAY_MS, target - Date.now()));
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refresh().catch(() => {
      // Request-time 401 recovery remains authoritative. A background refresh
      // failure must not create a timer loop or clear a still-usable session.
    });
  }, delay);
}
