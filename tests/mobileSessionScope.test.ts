// tests/mobileSessionScope.test.ts
// CS-06: a mobile refresh / silent reauth must only ever write a token for the
// account it was started for. The failure this prevents: a refresh started while
// account A was signed in resolved after account B had taken over the stored
// session, and A's refreshed token was written over B's session — or a token was
// written at all after the account generation had moved.
//
// The REAL mobileAuth service and auth store are exercised; only the native
// secure store and the mobile-platform probes are mocked. Each test re-imports
// the service so its module-level session cache cannot leak between cases.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const secure = vi.hoisted(() => {
  const slots = new Map<string, string>();
  return {
    slots,
    reset() {
      slots.clear();
    },
  };
});
vi.mock('../src/services/nativeSecureStorage', () => ({
  getSecureStorage: () => ({
    get: async (key: string) => secure.slots.get(key) ?? null,
    set: async (key: string, value: string) => {
      secure.slots.set(key, value);
    },
    remove: async (key: string) => {
      secure.slots.delete(key);
    },
    keys: async () => [...secure.slots.keys()],
  }),
  mobileSlotName: (key: string) => key,
  MOBILE_KEY_PREFIX: 'mourn.',
}));
vi.mock('../src/utils/platform', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  isMobileBuild: true,
  isCapacitorRuntime: () => true,
  isNativeBuild: true,
}));

/** Fresh pinia + fresh service/auth modules; returns the freshly loaded services. */
async function services() {
  vi.resetModules();
  setActivePinia(createPinia());
  const mobileAuth = await import('../src/services/mobileAuth');
  const auth = await import('../src/stores/auth');
  return { ...mobileAuth, useAuthStore: auth.useAuthStore };
}

function credentialsFor(token: string) {
  return { token, csrfToken: `csrf-${token}`, tokenExpiresIn: 3600 };
}

function storedSession() {
  const raw = secure.slots.get('mobile:auth-session');
  return raw ? (JSON.parse(raw) as { token: string; username: string }) : null;
}

/** The device starts with ALICE signed in on the mobile runtime. */
async function aliceOnDevice() {
  const svc = await services();
  Object.assign(svc.useAuthStore(), {
    user: { id: 'alice-id', username: 'alice' },
    isLoggedIn: true,
  });
  await svc.storeMobileAuthCredentials(credentialsFor('token-a'), 'alice');
  expect(storedSession()).toMatchObject({ token: 'token-a', username: 'alice' });
  return svc;
}

beforeEach(() => {
  secure.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CS-06 mobile session writes are account-scoped', () => {
  it('refuses to overwrite another account’s stored session', async () => {
    const svc = await aliceOnDevice();

    // Account B takes over this device's stored session (login clears first).
    await svc.clearMobileSession();
    await svc.storeMobileAuthCredentials(credentialsFor('token-b'), 'bob');

    // A late write for alice (a refresh that resolved after the switch) must not
    // clobber bob's session.
    await expect(
      svc.storeMobileAuthCredentials(credentialsFor('token-a-refreshed'), 'alice'),
    ).rejects.toThrow(/different account/i);

    expect(storedSession()).toMatchObject({ token: 'token-b', username: 'bob' });
    expect((await svc.getMobileSession())?.token).toBe('token-b');
  });

  it('refuses a refresh whose account generation moved, and leaves the session alone', async () => {
    const svc = await aliceOnDevice();
    const auth = svc.useAuthStore();
    const generationAtStart = auth.authOperationGeneration;
    // Another account transition happened while the refresh was in flight.
    auth.authOperationGeneration += 1;

    await expect(
      svc.storeRefreshedMobileSession(credentialsFor('token-a-refreshed'), {
        username: 'alice',
        generation: generationAtStart,
      }),
    ).rejects.toThrow(/superseded/i);

    expect(storedSession()).toMatchObject({ token: 'token-a', username: 'alice' });
  });

  it('still stores a refresh for the same account on the same generation', async () => {
    const svc = await aliceOnDevice();
    const auth = svc.useAuthStore();

    const session = await svc.storeRefreshedMobileSession(credentialsFor('token-a-refreshed'), {
      username: 'alice',
      generation: auth.authOperationGeneration,
    });

    expect(session.token).toBe('token-a-refreshed');
    expect(storedSession()).toMatchObject({ token: 'token-a-refreshed', username: 'alice' });
  });

  it('does not write a refreshed token when the auth store was cleared mid-flight', async () => {
    const svc = await aliceOnDevice();
    const auth = svc.useAuthStore();
    const generationAtStart = auth.authOperationGeneration;
    // A mobile invalidation tears the account down while the refresh is in flight.
    auth.user = null;
    auth.isLoggedIn = false;
    auth.authOperationGeneration += 1;

    await expect(
      svc.storeRefreshedMobileSession(credentialsFor('token-a-refreshed'), {
        username: 'alice',
        generation: generationAtStart,
      }),
    ).rejects.toThrow(/superseded/i);

    expect(storedSession()).toMatchObject({ token: 'token-a', username: 'alice' });
  });
});
