/**
 * Classification of API failures that mean "this session is over".
 *
 * HTTP 401 is overloaded in this API: the auth middleware answers 401 when a
 * cookie/bearer is invalid, but several *authorization* failures were also
 * answered with 401 (a session with no enrolled Vault device talking to a
 * device-scoped group route, a wrong current password, a bad enrollment
 * signature). Treating every 401 as a dead session is what threw people out of
 * the messaging screen and onto the login page — the screen where all of those
 * non-auth 401s live.
 *
 * The server now tags real authentication failures with `code: "AUTH_REQUIRED"`
 * and answers the rest with their own status (403) and code. This helper is the
 * single client-side authority on the question, so the interceptor, the router
 * and any future caller agree.
 */

export interface ApiErrorBody {
  error?: string;
  code?: string;
}

/** Unauthenticated credential submissions: a 401 here is a wrong password, not
 *  an expired session, and must never trigger recovery or a redirect. */
const CREDENTIAL_ENDPOINTS = [
  '/api/v1/auth/login',
  '/api/v1/auth/mobile/login',
  '/api/v1/auth/register',
];

export function isSessionAuthFailure(
  url: string | undefined,
  status: number | undefined,
  body?: unknown,
): boolean {
  if (status !== 401) return false;

  const requestUrl = url || '';
  if (CREDENTIAL_ENDPOINTS.some((endpoint) => requestUrl.startsWith(endpoint))) {
    return false;
  }

  const code = (body as ApiErrorBody | undefined)?.code;
  if (typeof code === 'string' && code.length > 0) {
    return code === 'AUTH_REQUIRED';
  }

  // Legacy/uncoded responses (older backend): only the auth surface can mean the
  // session itself is gone. Everything else is left to the caller.
  return requestUrl.includes('/api/v1/auth/');
}

/** True when the request failed because this session has no Vault device bound
 *  yet — a transient enrollment state, never a logout. */
export function isDeviceBindingRequired(body?: unknown): boolean {
  return (body as ApiErrorBody | undefined)?.code === 'DEVICE_BINDING_REQUIRED';
}
