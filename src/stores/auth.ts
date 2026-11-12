import { defineStore } from 'pinia';
import { Notify } from 'quasar';
import { api, mobilePreAuthApi, refreshMobileSession } from 'boot/axios';
import type {
  ActivationRegisterCredentials,
  AuthState,
  LoginCredentials,
  RegisterCredentials,
} from 'src/types/auth';
import { useSecureStore } from 'src/composables/useSecureStore';
import { isNativeShellActive } from 'src/utils/platform';
import type { AxiosResponse } from 'axios';
import type {
  ApiResponseEnvelope,
  CsrfResponsePayload,
  LoginResponsePayload,
  MobileLoginResponsePayload,
} from 'src/types/api';
import {
  clearMobileSession,
  getMobileDeviceBinding,
  getMobileSession,
  isMobileAuthRuntime,
  scheduleMobileSessionRefresh,
  storeMobileAuthCredentials,
} from 'src/services/mobileAuth';

import { isJsonContentType } from 'src/utils/http';
import { serializeAccountTransition, teardownPrivateStores } from '../utils/accountLifecycle';
import { collectClientFingerprint, hashClientFingerprint } from 'src/services/clientFingerprint';

function logBackendRoutingError(): void {
  console.error('Backend Routing Error: Received HTML instead of JSON');
}

function getCsrfFromCookie(): string {
  if (typeof document === 'undefined') return '';
  const cookie = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('csrfToken=') || c.startsWith('_csrf='));

  if (!cookie) return '';
  if (cookie.startsWith('csrfToken=')) return decodeURIComponent(cookie.slice('csrfToken='.length));
  if (cookie.startsWith('_csrf=')) return decodeURIComponent(cookie.slice('_csrf='.length));
  return '';
}

interface AuthResult { success: boolean; error?: string; verificationRequired?: boolean }

/**
 * How long a successful login waits for the Vault to enroll/bind this device
 * before returning. Device-scoped routes (groups, WS handshake) need the binding,
 * so waiting is useful — but only bounded: login must never depend on the Vault
 * finishing, and must never report a credential error because it did not.
 */
const VAULT_READY_AFTER_LOGIN_MS = 12_000;

/**
 * Native shell (Tauri desktop OR Capacitor mobile) with its bridge attached.
 * Everything Vault / credential / offline related hangs off this: both native
 * shells have a hardware-backed secret store, the website has none.
 */
function isNativeRuntime(): boolean {
  return isNativeShellActive();
}

async function initializeVaultIfNative(currentPassword?: string, isCurrent: () => boolean = () => true) {
  if (!isNativeRuntime()) return;
  const { useVaultStore } = await import('src/stores/vault');
  if (!isCurrent()) return;
  const vaultStore = useVaultStore();
  // A password reauthentication creates a new mobile bearer session. Re-run
  // device proof even when the prior session already initialized the Vault so
  // the replacement session is bound before protected requests resume.
  if (isMobileAuthRuntime() && vaultStore.isInitialized) await vaultStore.clearVaultState();
  if (!isCurrent()) return;
  await vaultStore.initialize({ currentPassword });
}

function isActivationRegistration(
  credentials: RegisterCredentials,
): credentials is ActivationRegisterCredentials {
  return typeof credentials.activationToken === 'string';
}

function isCsrfFailure(error: unknown): boolean {
  const resp = (
    error as { response?: { status?: number; data?: { code?: string; error?: string } } }
  )?.response;
  const code = resp?.data?.code;
  const message = String(resp?.data?.error || '').toLowerCase();

  return (
    resp?.status === 403 &&
    (code === 'CSRF_INVALID' || code === 'CSRF_MISSING' || message.includes('csrf'))
  );
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    isLoggedIn: false,
    csrfToken: '' as string,
    authOperationGeneration: 0,
  }),

  actions: {
    // 1. Get a fresh CSRF token before any sensitive action
    async fetchCsrfToken() {
      const generation = this.authOperationGeneration;
      try {
        const mobileSession = isMobileAuthRuntime() ? await getMobileSession() : null;
        if (generation !== this.authOperationGeneration) return;
        if (mobileSession) {
          this.csrfToken = mobileSession.csrfToken;
          return;
        }

        const csrfClient = isMobileAuthRuntime() ? mobilePreAuthApi : api;
        const response =
          await csrfClient.get<ApiResponseEnvelope<CsrfResponsePayload>>('/api/v1/auth/csrf');

        if (generation !== this.authOperationGeneration) return;

        // Tokens and response headers must not enter diagnostic logs.

        if (isJsonContentType(response.headers)) {
          const legacyBody = response?.data as ApiResponseEnvelope<CsrfResponsePayload> & {
            csrfToken?: string;
          };
          this.csrfToken = legacyBody?.data?.csrfToken ?? legacyBody?.csrfToken ?? '';

          if (!this.csrfToken) {
            this.csrfToken = getCsrfFromCookie();
          }
        } else {
          // Fallback: token may be set as a cookie by the backend
          this.csrfToken = getCsrfFromCookie();
          if (!this.csrfToken) logBackendRoutingError();
        }
        if (!this.csrfToken) throw new Error('CSRF token unavailable');
      } catch (error: unknown) {
        if (generation === this.authOperationGeneration) this.csrfToken = '';
        throw error;
      }
    },

    async postWithFreshCsrf<T = unknown>(
      url: string,
      payload: unknown,
      headers: Record<string, string> = {},
    ): Promise<AxiosResponse<T>> {
      const generation = this.authOperationGeneration;
      const assertCurrent = () => {
        if (generation !== this.authOperationGeneration) throw new Error('Authentication operation was superseded');
      };
      const mobileRuntime = isMobileAuthRuntime();
      const mobileSession = mobileRuntime ? await getMobileSession() : null;
      assertCurrent();
      if (mobileSession) {
        return api.post<T>(url, payload, { headers, withCredentials: false });
      }

      await this.fetchCsrfToken();
      assertCurrent();
      const requestClient = mobileRuntime ? mobilePreAuthApi : api;

      try {
        const csrfHeader = this.csrfToken || getCsrfFromCookie();
        return await requestClient.post<T>(url, payload, {
          headers: { ...headers, ...(csrfHeader ? { 'X-CSRF-Token': csrfHeader } : {}) },
        });
      } catch (error: unknown) {
        assertCurrent();
        if (!isCsrfFailure(error)) throw error;

        await this.fetchCsrfToken();
        assertCurrent();
        const retryCsrf = this.csrfToken || getCsrfFromCookie();
        return requestClient.post<T>(url, payload, {
          headers: { ...headers, ...(retryCsrf ? { 'X-CSRF-Token': retryCsrf } : {}) },
        });
      }
    },

    // 2. Secure Login with CSRF Token and Fingerprint
    login(credentials: LoginCredentials, fingerprint: string | null, stayLoggedIn = false) {
      const generation = ++this.authOperationGeneration;
      return serializeAccountTransition(this, () => this.performLogin(credentials, fingerprint, stayLoggedIn, generation));
    },

    async performLogin(credentials: LoginCredentials, fingerprint: string | null, stayLoggedIn: boolean, operationGeneration: number): Promise<AuthResult> {
      const isCurrent = () => operationGeneration === this.authOperationGeneration;
      const superseded = { success: false, error: 'Authentication operation was superseded' };
      if (!isCurrent()) return superseded;
      const mobileAuth = isMobileAuthRuntime();
      const hashedFingerprint = mobileAuth ? null : await hashClientFingerprint(fingerprint);
      if (!isCurrent()) return superseded;

      try {
        let response: AxiosResponse<ApiResponseEnvelope<LoginResponsePayload>>;
        if (mobileAuth) {
          const binding = await getMobileDeviceBinding(credentials.username);
          if (!isCurrent()) return superseded;
          response = await api.post<MobileLoginResponsePayload>(
            '/api/v1/auth/mobile/login',
            {
              username: credentials.username,
              password: credentials.password,
              // Before Vault enrollment there is no server-issued device hash,
              // so omit the fingerprint rather than inventing a weaker one.
              ...(binding?.deviceHash ? { deviceFingerprint: binding.deviceHash } : {}),
            },
            { headers: { 'Content-Type': 'application/json' }, withCredentials: false },
          );
        } else {
          response = await this.postWithFreshCsrf<ApiResponseEnvelope<LoginResponsePayload>>(
            '/api/v1/auth/login',
            {
              username: credentials.username,
              password: credentials.password,
              ...(hashedFingerprint ? { deviceFingerprint: hashedFingerprint } : {}),
            },
            { 'Content-Type': 'application/json' },
          );
        }

        if (!isJsonContentType(response.headers)) {
          logBackendRoutingError();
          return { success: false, error: 'Backend routing error. Please try again.' };
        }

        // Backend returns { success: true, data: { user: {...} } }
        if (response?.data?.success && response?.data?.data?.user) {
          if (operationGeneration !== this.authOperationGeneration) {
            return { success: false, error: 'Authentication operation was superseded' };
          }
          await teardownPrivateStores(isCurrent);
          if (!isCurrent()) return superseded;
          let mobileSession = null;
          if (mobileAuth) {
            // A successful login REPLACES whatever session the device held, but a
            // token for another account must never be layered over it: clear the
            // old one first so the write is account-scoped by construction.
            const previousSession = await getMobileSession();
            if (
              previousSession &&
              previousSession.username.trim().toLowerCase() !==
                credentials.username.trim().toLowerCase()
            ) {
              await clearMobileSession();
            }
            if (!isCurrent()) return superseded;
            mobileSession = await storeMobileAuthCredentials(
              response.data as MobileLoginResponsePayload,
              credentials.username,
            );
          }
          if (!isCurrent()) return superseded;
          this.user = {
            ...response.data.data.user,
            hasAcceptedTerms: !!response.data.data.user?.hasAcceptedTerms,
          };
          const verificationRequired = Boolean(response.data.data?.verificationRequired);
          if (this.user?.id)
            localStorage.setItem('user_cache', JSON.stringify({ id: this.user.id }));
          this.isLoggedIn = true;

          if (mobileSession) {
            this.csrfToken = mobileSession.csrfToken;
            scheduleMobileSessionRefresh(mobileSession, refreshMobileSession);
          }

          // Save credentials for native auto-login only when the user opts in.
          // Desktop uses the OS keychain; mobile uses Keystore/Keychain-backed
          // secure storage. Web remains a no-op and receives no password copy.
          if (credentials.password && stayLoggedIn) {
            try {
              const { saveCredentials } = useSecureStore();
              await saveCredentials({
                username: credentials.username,
                password: credentials.password,
                stayLoggedIn: true,
              });
            } catch (err) {
              if (import.meta.env.DEV) {
                console.warn('Secure credential save failed after login', err);
              }
            }
          } else if (credentials.password && !stayLoggedIn && isNativeRuntime()) {
            // User unchecked stay-logged-in: clear any previously stored creds.
            try {
              const { removeCredentials } = useSecureStore();
              await removeCredentials(credentials.username);
            } catch (err) {
              if (import.meta.env.DEV) {
                console.warn('Secure credential clear failed after login', err);
              }
              // Authentication already succeeded. Warn about the privacy action
              // separately; never invite another login or skip Vault setup.
              if (isCurrent()) Notify.create({
                type: 'warning',
                message: 'Signed in, but saved credentials could not be removed. Auto-login may still be enabled. Retry removing this saved account when secure storage is available.',
              });
            }
          }

          if (!isCurrent()) return superseded;
          if (mobileAuth) await this.establishVaultAfterLogin(credentials.password, isCurrent);
          else void initializeVaultIfNative(credentials.password, isCurrent).catch(() => {});
          if (!isCurrent()) return superseded;
          const accountUser = this.user;
          const { useAccountsStore } = await import('./accounts');
          if (!isCurrent()) return superseded;
          await useAccountsStore().saveAccount(accountUser, isCurrent);
          if (!isCurrent()) return superseded;
          return { success: true, verificationRequired };
        }
        return { success: false, error: 'Unexpected response from server' };
      } catch (error: unknown) {
        const resp = (error as { response?: { status?: number; data?: { error?: string } } })
          ?.response;
        const errorMessage = resp?.data?.error || 'Invalid credentials';

        if (import.meta.env.DEV) {
          console.error('Login failed', resp?.status, resp?.data ?? (error as Error).message);
        }
        return { success: false, error: errorMessage };
      }
    },

    /**
     * Vault setup that follows a successful mobile login.
     *
     * This used to be a bare `await initializeVaultIfNative(password)` *inside*
     * login's try block, which had two bad outcomes: a stalled secure-storage
     * bridge or a WebSocket that never finished threw, landed in the catch, and
     * reported "Invalid credentials" for a session that had already been created
     * — the user retried, each retry minted another session (and, at the cap,
     * revoked the oldest one), and after five attempts the login rate limiter
     * locked them out. Enrollment still gets its chance here, but the login
     * result is never decided by it.
     */
    async establishVaultAfterLogin(password?: string, isCurrent: () => boolean = () => true): Promise<void> {
      const establishment = initializeVaultIfNative(password, isCurrent).catch((err: unknown) => {
        if (import.meta.env.DEV) {
          console.warn('[Auth] Vault initialization after login failed', err);
        }
      });

      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          establishment,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, VAULT_READY_AFTER_LOGIN_MS);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },

    switchAccount(username: string, fingerprint: string) {
      const generation = ++this.authOperationGeneration;
      return serializeAccountTransition(this, async () => {
      const isCurrent = () => generation === this.authOperationGeneration;
      if (!isCurrent()) return { success: false, error: 'Authentication operation was superseded' };
      try {
        // 1. Read secure credentials first so we do not log out unnecessarily.
        const { getCredentials } = useSecureStore();
        const storedCreds = await getCredentials(username);
        if (!isCurrent()) return { success: false, error: 'Authentication operation was superseded' };

        if (storedCreds?.password) {
          // 2. End current session before switching identities.
          await this.performLogout(generation);
          if (!isCurrent()) return { success: false, error: 'Authentication operation was superseded' };

          // 3. Attempt to auto-login with encrypted stored credentials.
          const result = await this.performLogin(
            { username, password: storedCreds.password },
            fingerprint,
            storedCreds.stayLoggedIn === true,
            generation,
          );
          return result;
        }

        // 4. Fallback to manual login if no password is saved
        console.warn(`No stored password for ${username}, cannot auto-login.`);
        return { success: false, error: 'No stored password for this account.' };
      } catch (error: unknown) {
        if (import.meta.env.DEV) {
          console.error('Switch account failed', error);
        }
        return { success: false, error: 'Switch account failed. Please log in manually.' };
      }
      });
    },

    // 3. Register with CSRF Token, Fingerprint, and Captcha
    register(credentials: RegisterCredentials, fingerprint: string | null, captchaToken: string): Promise<AuthResult> {
      const generation = ++this.authOperationGeneration;
      return serializeAccountTransition(this, () => this.performRegister(credentials, fingerprint, captchaToken, generation));
    },

    async performRegister(
      credentials: RegisterCredentials,
      fingerprint: string | null,
      captchaToken: string,
      operationGeneration: number,
    ): Promise<AuthResult> {
      const isCurrent = () => operationGeneration === this.authOperationGeneration;
      const hashedFingerprint = await hashClientFingerprint(fingerprint);
      if (!isCurrent()) return { success: false, error: 'Authentication operation was superseded' };

      try {
        const registrationAccess = isActivationRegistration(credentials)
          ? { activationToken: credentials.activationToken }
          : { referralCode: credentials.referralCode };

        const response = await this.postWithFreshCsrf<ApiResponseEnvelope<LoginResponsePayload>>(
          '/api/v1/auth/register',
          {
            username: credentials.username,
            ...registrationAccess,
            email: credentials.email || null,
            password: credentials.password,
            ...(hashedFingerprint ? { deviceFingerprint: hashedFingerprint } : {}),
            captchaProvider: 'cap',
            captchaToken,
          },
          { 'Content-Type': 'application/json' },
        );

        if (!isJsonContentType(response.headers)) {
          logBackendRoutingError();
          return { success: false, error: 'Backend routing error. Please try again.' };
        }

        // Backend returns { success: true, data: { user: {...} }, verificationRequired?: boolean } on 201
        if (response?.data?.success && response?.data?.data?.user) {
          if (operationGeneration !== this.authOperationGeneration) {
            return { success: false, error: 'Authentication operation was superseded' };
          }
          if (isMobileAuthRuntime()) {
            // The public registration route uses a temporary cookie only for its
            // existing CSRF contract. Immediately exchange the known credentials
            // for the mobile bearer path; do not treat the cookie as mobile auth.
            if (response.data.data?.verificationRequired) {
              return { success: true, verificationRequired: true };
            }
            return this.performLogin(
              { username: credentials.username, password: credentials.password },
              null,
              false,
              operationGeneration,
            );
          }

          await teardownPrivateStores(isCurrent);
          if (!isCurrent()) return { success: false, error: 'Authentication operation was superseded' };
          this.user = {
            ...response.data.data.user,
            hasAcceptedTerms: !!response.data.data.user?.hasAcceptedTerms,
          };
          if (this.user?.id)
            localStorage.setItem('user_cache', JSON.stringify({ id: this.user.id }));
          this.isLoggedIn = true;

          void initializeVaultIfNative(credentials.password, isCurrent).catch(() => {});
          if (!isCurrent()) return { success: false, error: 'Authentication operation was superseded' };
          const accountUser = this.user;
          const { useAccountsStore } = await import('./accounts');
          if (!isCurrent()) return { success: false, error: 'Authentication operation was superseded' };
          await useAccountsStore().saveAccount(accountUser, isCurrent);
          return {
            success: true,
            verificationRequired: response.data.data?.verificationRequired ?? false,
          };
        }
        return { success: false, error: 'Unexpected response from server' };
      } catch (error: unknown) {
        const resp = (error as { response?: { status?: number; data?: { error?: string } } })
          ?.response;
        const errorMessage = resp?.data?.error || 'Registration failed';

        if (import.meta.env.DEV) {
          console.error(
            'Registration failed',
            resp?.status,
            resp?.data ?? (error as Error).message,
          );
        }

        return { success: false, error: errorMessage };
      }
    },

    // 4. Check if user has a valid session (call on app boot)
    async checkSession(): Promise<boolean> {
      const operationGeneration = this.authOperationGeneration;
      const isCurrent = () => operationGeneration === this.authOperationGeneration;
      try {
        const response =
          await api.get<ApiResponseEnvelope<LoginResponsePayload>>('/api/v1/auth/me');

        if (!isCurrent()) return false;

        if (!isJsonContentType(response.headers)) {
          // A non-JSON body means something IN FRONT of the API answered: a gateway
          // or proxy error page (Cloudflare 502/522, a rate-limit page), or the
          // backend mid-restart. That says NOTHING about whether this session is
          // valid — and tearing down here wiped every cached conversation, so on
          // device it presented as "all my chats are empty" (the SECURE CHANNEL
          // ACTIVE placeholder over chats that had messages), plus a mid-session
          // vault re-init that severed the realtime socket. The `catch` below was
          // already hardened for exactly this; the success-with-wrong-body path was
          // missed. Keep the session and let the next real API call decide.
          logBackendRoutingError();
          console.warn(
            '[Auth] Session check got a non-JSON response; keeping local session instead of signing out',
          );
          return this.isLoggedIn;
        }

        if (response?.data?.success && response?.data?.data?.user) {
          this.user = {
            ...response.data.data.user,
            hasAcceptedTerms: !!response.data.data.user?.hasAcceptedTerms,
          };
          if (this.user?.id)
            localStorage.setItem('user_cache', JSON.stringify({ id: this.user.id }));
          this.isLoggedIn = true;
          const accountUser = this.user;
          void initializeVaultIfNative(undefined, isCurrent).catch(() => {});
          if (!isCurrent()) return false;
          const { useAccountsStore } = await import('./accounts');
          if (!isCurrent()) return false;
          await useAccountsStore().saveAccount(accountUser, isCurrent);
          return true;
        }
        this.clearMobileAuthState();
        return false;
      } catch (error) {
        if (!isCurrent()) return false;

        // Distinguish "the server says this session is invalid" from "we could
        // not ask the server". Only 401/403 are authoritative: everything else
        // (5xx, gateway HTML, network drop, timeout) says nothing about the
        // session, and wiping here was expensive — a single transient blip
        // logged the user out AND tore down the native vault (clearVaultState),
        // so the vault re-initialized mid-session, severing the realtime socket
        // and re-syncing everything. On device that read as "it logged me out"
        // plus "syncing across devices takes forever". Keep the session; the
        // next real API call is the one that gets to decide.
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status !== 401 && status !== 403) {
          console.warn('[Auth] Session check failed with a non-auth error; keeping local session', {
            status,
          });
          return this.isLoggedIn;
        }

        this.clearMobileAuthState();
        return false;
      }
    },

    // 5. Logout: follow migration guidance - POST /api/v1/auth/logout
    //    - ensure CSRF token is present
    //    - POST to logout endpoint to clear server-side session
    //    - clear local auth state
    logout() {
      const generation = ++this.authOperationGeneration;
      return serializeAccountTransition(this, () => this.performLogout(generation));
    },

    async performLogout(operationGeneration: number) {
      const isCurrent = () => operationGeneration === this.authOperationGeneration;
      if (!isCurrent()) return false;
      const outgoingUid = this.user?.id;
      const mobileAuth = isMobileAuthRuntime();
      let serverRevocationConfirmed = true;

      if (mobileAuth) {
        try {
          const { unregisterMobilePushToken } = await import('src/services/mobilePush');
          await unregisterMobilePushToken();
        } catch (err) {
          serverRevocationConfirmed = false;
          console.warn('[Auth] Mobile push-token deletion failed:', err);
        }
        try {
          await api.post('/api/v1/auth/mobile/logout', {}, { withCredentials: false });
        } catch (err) {
          serverRevocationConfirmed = false;
          console.warn('[Auth] Mobile backend logout failed:', err);
        } finally {
          if (isCurrent()) await clearMobileSession();
        }
      }

      if (!isCurrent()) return false;
      this.user = null;
      this.isLoggedIn = false;
      this.csrfToken = '';
      localStorage.removeItem('user_cache');

      try {
        const cleanup = await teardownPrivateStores(isCurrent, outgoingUid);
        if (!isCurrent()) return false;
        serverRevocationConfirmed = serverRevocationConfirmed && cleanup.success;

        // Step 3: Send logout request to backend. Mobile revoked its push
        // token and bearer session before local teardown above; web/desktop keep
        // the existing cookie + fresh-CSRF flow unchanged.
        if (!mobileAuth) {
          try {
            await this.postWithFreshCsrf('/api/v1/auth/logout', {});
          } catch (err) {
            serverRevocationConfirmed = false;
            console.warn(
              '[Auth] Backend logout request failed; local state was still cleared:',
              err,
            );
          }

          // Refresh the anonymous CSRF token only if no newer authentication
          // operation started while logout was in flight.
          if (operationGeneration === this.authOperationGeneration) {
            await this.fetchCsrfToken();
          }
        }

        return serverRevocationConfirmed;
      } catch (error: unknown) {
        if (import.meta.env.DEV) {
          const resp = (error as { response?: { status?: number; data?: unknown } })?.response;
          console.error('Logout failed', resp?.status, resp?.data ?? (error as Error).message);
        } else {
          console.error('Logout failed');
        }
        return false;
      }
    },

    clearMobileAuthState() {
      const outgoingUid = this.user?.id;
      const generation = ++this.authOperationGeneration;
      this.user = null;
      this.isLoggedIn = false;
      this.csrfToken = '';
      localStorage.removeItem('user_cache');
      void teardownPrivateStores(() => generation === this.authOperationGeneration, outgoingUid).catch((error) => {
        console.warn('[Auth] Mobile invalidation teardown interrupted', error);
      });
    },

    async silentMobileReauthenticate(username?: string): Promise<boolean> {
      if (!isMobileAuthRuntime()) return false;
      try {
        const { getCredentials, listCredentials } = useSecureStore();
        const candidates = username
          ? [{ username, stayLoggedIn: true }]
          : (await listCredentials()).filter((credential) => credential.stayLoggedIn);

        for (const selected of candidates) {
          const credential = await getCredentials(selected.username);
          if (!credential?.password || credential.stayLoggedIn !== true) continue;
          const result = await this.login(
            { username: credential.username, password: credential.password },
            null,
            true,
          );
          if (result.success) return true;
        }
      } catch (error) {
        if (import.meta.env.DEV)
          console.warn('[Auth] Silent mobile reauthentication failed', error);
      }
      return false;
    },

    /**
     * Native-only silent auto-login. Reads credentials from the platform secret
     * store (desktop OS keychain / mobile Keystore+Keychain) and runs them
     * through the FULL login flow (CSRF, server argon2 verification, session
     * creation, audit log). No auth shortcut / backdoor. Returns true if a
     * session was restored. Fails silently to the login page.
     */
    async autoLogin(): Promise<boolean> {
      if (!isNativeRuntime()) return false;
      if (this.isLoggedIn) return true;

      try {
        if (isMobileAuthRuntime() && (await getMobileSession())) {
          if (await this.checkSession()) return true;
        }
        const { getCredentials, listCredentials } = useSecureStore();
        const stored = (await listCredentials()).filter((credential) => credential.stayLoggedIn);

        if (stored.length === 0) return false;

        const fingerprint = await collectClientFingerprint();

        for (const selected of stored) {
          const cred = await getCredentials(selected.username);
          if (!cred?.password) continue;

          const result = await this.login(
            { username: cred.username, password: cred.password },
            fingerprint,
            true,
          );
          if (result.success) return true;
        }
        return false;
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn('[Auth] autoLogin failed', error);
        }
        return false;
      }
    },
  },
});
