import { beforeEach, describe, expect, it, vi } from 'vitest';
const { request, get, auth } = vi.hoisted(() => ({
  request: vi.fn(async () => ({ data: {} })),
  get: vi.fn(async () => ({ data: {} })),
  auth: { csrfToken: 'csrf-test', fetchCsrfToken: vi.fn(async () => {}) },
}));
vi.mock('boot/axios', () => ({ api: { request, get } }));
vi.mock('src/stores/auth', () => ({ useAuthStore: () => auth }));
import { callsApi } from '../../src/calls/api';
beforeEach(() => { vi.clearAllMocks(); });
describe('voice REST contract', () => {
  it('publishes metadata-only readiness through the authenticated CSRF endpoint', async () => {
    await callsApi.ready('call-test');
    expect(request).toHaveBeenCalledWith({ method: 'post', url: '/api/v1/calls/call-test/ready', data: {}, headers: { 'X-CSRF-Token': 'csrf-test' } });
  });
  it('sends explicit per-device decline reason with CSRF protection', async () => {
    await callsApi.decline('call-test');
    expect(auth.fetchCsrfToken).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({ method: 'post', url: '/api/v1/calls/call-test/decline', data: { reason: 'declined' }, headers: { 'X-CSRF-Token': 'csrf-test' } });
  });
  it('requests TURN only for the current call', async () => {
    await callsApi.ice('call-test');
    expect(get).toHaveBeenCalledWith('/api/v1/calls/ice', { params: { callId: 'call-test' } });
  });
  it('passes opaque history cursors without interpreting them as dates', async () => {
    await callsApi.history('opaque-cursor');
    expect(get).toHaveBeenCalledWith('/api/v1/calls/history', { params: { before: 'opaque-cursor', limit: '50' } });
  });
});
