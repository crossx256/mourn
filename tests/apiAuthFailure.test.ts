// tests/apiAuthFailure.test.ts
// Guards the single client-side rule that decides whether a failed request means
// "your session is over". The bug this prevents: the messaging screen issues
// device-scoped calls that answered 401 when the session had no enrolled Vault
// device yet, and the axios interceptor read every 401 as a dead session and
// navigated to /login — i.e. "the app logs me out whenever I open messaging".
//
// Run: bunx vitest run tests/apiAuthFailure.test.ts

import { describe, it, expect } from 'vitest';
import { isSessionAuthFailure, isDeviceBindingRequired } from '../src/utils/apiAuthFailure';

describe('isSessionAuthFailure', () => {
  it('accepts an uncoded 401 from the auth surface (legacy backend)', () => {
    expect(isSessionAuthFailure('/api/v1/auth/me', 401, { error: 'authentication required' })).toBe(
      true,
    );
  });

  it('accepts an explicit AUTH_REQUIRED code from any endpoint', () => {
    expect(
      isSessionAuthFailure('/api/v1/vault/devices', 401, {
        error: 'session expired during device enrollment',
        code: 'AUTH_REQUIRED',
      }),
    ).toBe(true);
  });

  it('rejects a 401 that is an authorization answer, not an auth failure', () => {
    expect(
      isSessionAuthFailure('/api/v1/groups/abc/messages', 403, {
        error: 'device binding required',
        code: 'DEVICE_BINDING_REQUIRED',
      }),
    ).toBe(false);
    expect(
      isSessionAuthFailure('/api/v1/vault/ws-challenge', 403, {
        error: 'Device authorization is invalid',
        code: 'DEVICE_AUTH_INVALID',
      }),
    ).toBe(false);
  });

  it('rejects an uncoded 401 from a non-auth endpoint', () => {
    expect(isSessionAuthFailure('/api/v1/groups/abc/messages', 401, { code: 'X' })).toBe(false);
    expect(isSessionAuthFailure('/api/v1/groups/abc/messages', 401, {})).toBe(false);
    expect(isSessionAuthFailure('/api/v1/vault/ws-challenge', 401, undefined)).toBe(false);
  });

  it('never treats a credential submission rejection as a dead session', () => {
    expect(isSessionAuthFailure('/api/v1/auth/login', 401, { error: 'Invalid credentials' })).toBe(
      false,
    );
    expect(
      isSessionAuthFailure('/api/v1/auth/mobile/login', 401, { error: 'Invalid credentials' }),
    ).toBe(false);
    expect(isSessionAuthFailure('/api/v1/auth/register', 401, {})).toBe(false);
  });

  it('ignores non-401 statuses entirely', () => {
    expect(isSessionAuthFailure('/api/v1/auth/me', 200, undefined)).toBe(false);
    expect(isSessionAuthFailure('/api/v1/auth/me', 403, { code: 'AUTH_REQUIRED' })).toBe(false);
    expect(isSessionAuthFailure('/api/v1/auth/me', 500, {})).toBe(false);
    expect(isSessionAuthFailure('/api/v1/auth/me', undefined, undefined)).toBe(false);
  });
});

describe('isDeviceBindingRequired', () => {
  it('matches only the enrollment-state code', () => {
    expect(isDeviceBindingRequired({ code: 'DEVICE_BINDING_REQUIRED' })).toBe(true);
    expect(isDeviceBindingRequired({ code: 'AUTH_REQUIRED' })).toBe(false);
    expect(isDeviceBindingRequired({ error: 'device binding required' })).toBe(false);
    expect(isDeviceBindingRequired(undefined)).toBe(false);
  });
});
