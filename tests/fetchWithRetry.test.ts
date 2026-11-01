import { describe, expect, it, vi } from 'vitest';
import { fetchWithRetry } from '../src/utils/fetchWithRetry';

/**
 * Guards the bounded upload retry.
 *
 * The behaviour under test exists to convert the raw "Failed to fetch" a user
 * saw when a big attachment upload was dropped mid-flight into a retried request,
 * WITHOUT retrying requests the server actually answered.
 */
const ok = (status = 200) => new Response('{}', { status });

describe('fetchWithRetry', () => {
  it('returns the first successful response without retrying', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok());
    const res = await fetchWithRetry('/x', {}, { fetchImpl });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries network-level failures and then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(ok(201));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn();

    const res = await fetchWithRetry('/x', {}, { fetchImpl, sleep, onRetry });

    expect(res.status).toBe(201);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    // Exponential backoff: 400ms then 800ms.
    expect(sleep).toHaveBeenNthCalledWith(1, 400);
    expect(sleep).toHaveBeenNthCalledWith(2, 800);
  });

  it('rethrows the last network error after exhausting attempts', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(fetchWithRetry('/x', {}, { fetchImpl, sleep, attempts: 3 })).rejects.toThrow(
      'Failed to fetch',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2); // never sleeps after the final attempt
  });

  it('does NOT retry an HTTP error response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(403));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const res = await fetchWithRetry('/x', {}, { fetchImpl, sleep });

    expect(res.status).toBe(403); // the caller decides what a 403 means
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('clamps attempts to at least 1', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('nope'));
    await expect(fetchWithRetry('/x', {}, { fetchImpl, attempts: 0 })).rejects.toThrow('nope');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
