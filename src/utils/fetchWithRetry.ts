/**
 * `fetch` with bounded retries for NETWORK-level failures only.
 *
 * The encrypted-attachment upload surfaced the browser's raw `TypeError: Failed
 * to fetch` to the user (`"Yeh failed to fetch"`) whenever a request was dropped
 * mid-flight — most often a large video on an unstable mobile link. A dropped
 * request is transient and worth another attempt; a 4xx/5xx is NOT (the server
 * answered, so the body/payload is the problem and retrying only wastes data).
 *
 * So: retry only when `fetch` itself rejects (no HTTP response at all), with
 * exponential backoff. An HTTP response of any status is returned immediately
 * and left for the caller to interpret.
 *
 * The request body must be re-sendable. `FormData` and `Blob` are, so the blob
 * upload path is safe; a one-shot ReadableStream stream would not be.
 *
 * Kept dependency-free so it is trivially unit testable.
 */
export interface FetchWithRetryOptions {
  /** Total attempts, including the first. Clamped to >= 1. */
  attempts?: number;
  /** Backoff base in ms. Attempt n waits base * 2^(n-1). */
  baseDelayMs?: number;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Called before each retry (attempt index is 1-based). */
  onRetry?: (attempt: number, error: unknown) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 3));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 400);
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // Any HTTP response (even 500) is a real answer — return it, no retry.
      return await doFetch(input, init);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      options.onRetry?.(attempt, error);
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}
