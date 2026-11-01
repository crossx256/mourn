/**
 * Registered-devices / sessions snapshot loader for the dashboard security tab.
 *
 * WHY THIS IS A MODULE, NOT PART OF THE COMPONENT
 * The dashboard page renders each tab as a `defineAsyncComponent` behind a
 * `<transition>` keyed on the active tab, so the security tab is torn down and
 * rebuilt every time the user moves between tabs (or when the page is
 * re-created while the session refreshes). Fetching from `onMounted` meant one
 * GET /api/v1/security/devices-and-sessions *plus* one GET /api/v1/auth/csrf
 * per mount, and a mount storm turned into a request storm: the spinner came
 * back, the rows went away, and the panel looked like it was refreshing itself
 * forever without ever showing anything.
 *
 * This module is the single owner of that data, with three guarantees:
 *   1. ONE in-flight request. Concurrent callers join the request already
 *      running instead of each firing their own.
 *   2. A 60s cache per account. Re-mounting the tab can never hit the network
 *      again inside the TTL, so even a pathological remount loop produces at
 *      most one request per minute.
 *   3. A hard deadline on the WHOLE load. `fetchCsrfToken()` reads the native
 *      secure store before any HTTP call is made, and that read has no timeout
 *      of its own — if it never settles, the component's `finally` never runs
 *      and the panel spins forever. The deadline converts that into a normal,
 *      renderable error.
 */

import { api } from 'src/boot/axios';
import { useAuthStore } from 'src/stores/auth';

export interface SecurityDevice {
  id: string;
  deviceName: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  isTrusted: boolean;
  isCurrent: boolean;
  deviceHashPreview: string | null;
  publicKeyPreview: string | null;
  riskFingerprintPreview: string | null;
  suspicious: boolean;
  suspicionScore: number | null;
  suspicionReasons: string[];
}

export interface SecuritySession {
  id: string;
  deviceName: string | null;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  ipSubnetHashPreview: string | null;
  userAgent: string | null;
  isActive: boolean;
  isTrusted: boolean;
  isCurrent: boolean;
  isRegisteredDevice: boolean;
  deviceHashPreview: string | null;
  credentialVersion: number;
  riskFingerprintPreview: string | null;
  suspicious: boolean;
  suspicionScore: number | null;
  suspicionReasons: string[];
}

export interface SessionCounts {
  total: number;
  active: number;
  showing: number;
  hidden: number;
}

export interface SecuritySnapshot {
  uid: string;
  fetchedAt: number;
  devices: SecurityDevice[];
  sessions: SecuritySession[];
  sessionCounts: SessionCounts;
}

interface SecurityResponse {
  success: boolean;
  data?: {
    devices?: SecurityDevice[];
    sessions?: SecuritySession[];
    sessionCounts?: SessionCounts;
  };
  error?: string;
}

const SECURITY_ENDPOINT = '/api/v1/security/devices-and-sessions';
const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** Covers csrf/secure-storage latency as well as the HTTP call itself. */
const LOAD_DEADLINE_MS = 20_000;

let cache: SecuritySnapshot | null = null;
let inFlight: Promise<SecuritySnapshot> | null = null;
let inFlightUid: string | null = null;

export class SecurityLoadTimeoutError extends Error {
  constructor() {
    super('security load deadline exceeded');
    this.name = 'SecurityLoadTimeoutError';
  }
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SecurityLoadTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function toSnapshot(uid: string, payload: SecurityResponse): SecuritySnapshot {
  const data = payload.data;
  if (!payload.success || !data) {
    throw new Error(payload.error || 'failed to load security activity');
  }

  const devices = Array.isArray(data.devices) ? data.devices : [];
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];

  return {
    uid,
    fetchedAt: Date.now(),
    devices,
    sessions,
    sessionCounts: data.sessionCounts ?? {
      total: sessions.length,
      active: sessions.filter((session) => session.isActive).length,
      showing: sessions.length,
      hidden: 0,
    },
  };
}

async function requestSnapshot(uid: string): Promise<SecuritySnapshot> {
  const authStore = useAuthStore();

  await authStore.fetchCsrfToken();
  const response = await api.get<SecurityResponse>(SECURITY_ENDPOINT, {
    headers: authStore.csrfToken ? { 'X-CSRF-Token': authStore.csrfToken } : undefined,
    timeout: REQUEST_TIMEOUT_MS,
  });

  return toSnapshot(uid, response.data);
}

/** Cached snapshot for this account, if one is still warm. Never triggers I/O. */
export function peekSecuritySnapshot(uid: string): SecuritySnapshot | null {
  if (!cache || cache.uid !== uid) return null;
  if (Date.now() - cache.fetchedAt >= CACHE_TTL_MS) return null;
  return cache;
}

/** Drop the cache after a mutation (e.g. revoking a session) so the next read is fresh. */
export function invalidateSecuritySnapshot(): void {
  cache = null;
}

export async function loadSecuritySnapshot(
  options: { uid?: string; force?: boolean } = {},
): Promise<SecuritySnapshot> {
  const uid = options.uid ?? '';

  if (!options.force) {
    const warm = peekSecuritySnapshot(uid);
    if (warm) return warm;
  }

  // Join the request already running for THIS account; a request for another
  // account is never shared, so an account switch cannot paint the wrong rows.
  if (inFlight && inFlightUid === uid) return inFlight;

  const pending = withDeadline(requestSnapshot(uid), LOAD_DEADLINE_MS);
  inFlight = pending;
  inFlightUid = uid;

  try {
    const snapshot = await pending;
    // A response that arrives after the deadline already rejected the caller,
    // so it is never applied here — the cache only holds confirmed results.
    cache = snapshot;
    return snapshot;
  } finally {
    if (inFlight === pending) {
      inFlight = null;
      inFlightUid = null;
    }
  }
}

export interface SecurityLoadErrorInfo {
  message: string;
  /** True when only a new sign-in can fix it, so the UI can offer that instead of a retry loop. */
  needsSignIn: boolean;
}

/** Turns a failed load into something a person can act on. */
export function describeSecurityLoadError(error: unknown): SecurityLoadErrorInfo {
  if (error instanceof SecurityLoadTimeoutError) {
    return {
      message: 'the security service did not answer in time. check your connection, then retry.',
      needsSignIn: false,
    };
  }

  const response = (
    error as { response?: { status?: number; data?: { error?: string; code?: string } } }
  )?.response;
  const status = response?.status;

  if (status === 401 || status === 403) {
    return {
      message: 'this session is no longer allowed to list devices. sign in again to restore it.',
      needsSignIn: true,
    };
  }
  if (status === 429) {
    return {
      message: 'too many requests right now — wait a moment, then retry.',
      needsSignIn: false,
    };
  }
  if (typeof status === 'number' && status >= 500) {
    return {
      message: `the server could not list your devices (error ${status}). retry in a moment.`,
      needsSignIn: false,
    };
  }
  if (typeof status !== 'number') {
    return {
      message: 'no connection to the security service. check your network, then retry.',
      needsSignIn: false,
    };
  }

  const detail = response?.data?.error;
  return {
    message: detail
      ? `devices and sessions could not be loaded: ${detail}`
      : `devices and sessions could not be loaded (error ${status}). retry in a moment.`,
    needsSignIn: false,
  };
}
