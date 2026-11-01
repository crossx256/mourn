// src/boot/axios.ts
import { defineBoot } from '#q-app';
import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import {
  clearMobileSession,
  getMobileSession,
  isMobileAuthRuntime,
  scheduleMobileSessionRefresh,
  storeMobileAuthCredentials,
} from 'src/services/mobileAuth';
import type { MobileLoginResponsePayload } from 'src/types/api';
import { isMobileBuild, isNativeBuild } from 'src/utils/platform';
import { isSessionAuthFailure } from 'src/utils/apiAuthFailure';

const isServer = import.meta.env.QUASAR_SERVER;
const isDev = import.meta.env.DEV;

// In development, keep browser requests relative so Quasar's /api proxy can
// forward them to the local backend on port 3000 without CORS. Production
// NATIVE builds (Tauri asset server / Capacitor's local server) serve the
// bundle from their own origin, so relative /api requests return the SPA HTML
// unless they are pointed at the real backend origin.
const configuredApiBase =
  (import.meta.env.VITE_API_BASE as string | undefined) ||
  (isNativeBuild ? 'https://mourn.bio' : '');
const clientBaseURL = isDev ? '' : configuredApiBase;

const baseURL = isServer ? 'http://127.0.0.1:3000' : clientBaseURL;

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function resolveApiUrl(path: string): string {
  if (!baseURL) {
    return path;
  }

  return `${trimTrailingSlash(baseURL)}${path}`;
}

// Safety check: specific to this issue.
// If code is running on client (browser) and we are properly compiled for prod,
// we generally expect a real URL or relative URL, not localhost (unless dev).
if (import.meta.env.PROD && !isServer && baseURL.includes('localhost')) {
  console.warn(
    'Client baseURL is localhost in production. This usually means a build misconfiguration.',
  );
}

const api = axios.create({
  baseURL,
  // Bounded on purpose. Without a timeout a stalled request never settles, and
  // anything awaiting it waits forever — the router guard awaits checkSession(),
  // so a phone that wakes up with no usable network sat on a black screen with no
  // error and no recovery until the app was killed. A timeout turns that into a
  // normal failed request, which the auth store already treats as transient.
  // 30s (not 15s): the API sits behind Cloudflare and slow mobile/VPN links
  // routinely take 10-18s for a cold request; 15s was turning those into
  // spurious "offline mode" and aborted vault init.
  timeout: 30000,
  // Authenticated mobile traffic is bearer-only. Cookies are disabled so an
  // old WebView session can never shadow the intended bearer identity.
  withCredentials: !isMobileBuild,
});

// Registration and registration-application submission happen before a mobile
// bearer exists, while the existing backend still protects those public writes
// with session-bound CSRF. This isolated client keeps that temporary cookie out
// of every authenticated mobile request; successful registration immediately
// transitions through /auth/mobile/login to establish bearer authentication.
const mobilePreAuthApi = axios.create({ baseURL, withCredentials: true, timeout: 30000 });

interface MobileAxiosConfig extends InternalAxiosRequestConfig {
  _mobileAuthRetried?: boolean;
  _skipMobileAuthRecovery?: boolean;
}

const MOBILE_LOGIN_PATH = '/api/v1/auth/mobile/login';
const MOBILE_REFRESH_PATH = '/api/v1/auth/mobile/refresh';
let mobileRecoveryPromise: Promise<boolean> | null = null;

function isMutation(method?: string): boolean {
  return !['get', 'head', 'options'].includes((method || 'get').toLowerCase());
}

function isMobileLogin(url?: string): boolean {
  return Boolean(url?.includes(MOBILE_LOGIN_PATH));
}

api.interceptors.request.use(async (request) => {
  if (!isMobileAuthRuntime()) return request;

  request.withCredentials = false;
  if (isMobileLogin(request.url)) return request;

  const session = await getMobileSession();
  if (!session) return request;
  request.headers.set('Authorization', `Bearer ${session.token}`);
  if (isMutation(request.method)) {
    request.headers.set('X-CSRF-Token', session.csrfToken);
  }
  return request;
});

/** In-flight guard: concurrent refreshes would race over a rotating refresh token,
 *  and the loser's 401 was being read as "session dead" (spurious logouts). */
let mobileRefreshInFlight: Promise<boolean> | null = null;

export async function refreshMobileSession(): Promise<boolean> {
  if (!isMobileAuthRuntime()) return false;
  if (mobileRefreshInFlight) return mobileRefreshInFlight;

  mobileRefreshInFlight = (async () => {
    try {
      const current = await getMobileSession();
      if (!current) return false;

      const response = await api.post<MobileLoginResponsePayload>(MOBILE_REFRESH_PATH, {}, {
        _skipMobileAuthRecovery: true,
        withCredentials: false,
      } as MobileAxiosConfig);
      if (!response.data?.success) return false;

      const session = await storeMobileAuthCredentials(response.data, current.username);
      scheduleMobileSessionRefresh(session, refreshMobileSession);
      return true;
    } catch (err) {
      // A refresh that lost the race (another account signed in, or the store
      // was cleared mid-flight) must not be read as "this session is dead": the
      // account-scoped write refused it on purpose. Nothing else to do — the
      // winner owns the stored session.
      if (String((err as Error)?.message ?? '').match(/superseded|different account/i)) {
        console.warn('[Auth] Mobile refresh discarded: the account changed while it was in flight');
        return false;
      }
      throw err;
    } finally {
      mobileRefreshInFlight = null;
    }
  })();

  return mobileRefreshInFlight;
}

async function recoverMobileAuthentication(): Promise<boolean> {
  if (mobileRecoveryPromise) return mobileRecoveryPromise;

  mobileRecoveryPromise = (async () => {
    try {
      if (await refreshMobileSession()) return true;
    } catch {
      // An expired/revoked bearer cannot refresh. Continue to the one allowed
      // password reauthentication attempt, but only from opt-in secure creds.
    }

    try {
      const session = await getMobileSession();
      const { useAuthStore } = await import('src/stores/auth');
      if (await useAuthStore().silentMobileReauthenticate(session?.username)) return true;
    } catch {
      // Fall through to fail-closed cleanup.
    }

    await clearMobileSession();
    const { useAuthStore } = await import('src/stores/auth');
    useAuthStore().clearMobileAuthState();
    return false;
  })().finally(() => {
    mobileRecoveryPromise = null;
  });

  return mobileRecoveryPromise;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default defineBoot(({ router, ssrContext }: any) => {
  // Never mutate the module-global Axios defaults with per-request SSR cookies.
  // Authenticated SSR calls must use a request-scoped Axios instance instead.
  // Only register 401 redirect on the client — SSR should not redirect on auth failures
  if (!ssrContext) {
    api.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error.config as MobileAxiosConfig | undefined;
        const url = config?.url || '';
        // Only a 401 the SERVER labels as an authentication failure may tear the
        // session down or bounce the user to /login. A 401 that really means
        // "no enrolled device" / "wrong current password" / "bad enrollment
        // signature" is an authorization answer and must leave the session alone.
        const isUnauthorized = isSessionAuthFailure(
          url,
          error.response?.status,
          error.response?.data,
        );

        if (
          isUnauthorized &&
          isMobileAuthRuntime() &&
          config &&
          !config._skipMobileAuthRecovery &&
          !config._mobileAuthRetried &&
          !isMobileLogin(url)
        ) {
          config._mobileAuthRetried = true;
          if (await recoverMobileAuthentication()) {
            return api.request(config);
          }
        }

        // Recovery-internal requests reject back to the serialized recovery
        // flow. The original request alone owns existing login redirection.
        if (config?._skipMobileAuthRecovery) {
          return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }

        // Don't redirect for /auth/me — it's expected to return 401 for unauthenticated users
        if (isUnauthorized && !url.includes('/auth/me')) {
          void router.push('/login');
        }
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  }
});

export { api, mobilePreAuthApi };
