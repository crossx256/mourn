import { api } from 'boot/axios';
import { useAuthStore } from 'src/stores/auth';
import type { CallsApi } from './callManager';
import type { AnswerResult, CallPage, CreateResult, IceResult, ServerCall } from './types';
export interface CallsConfig {
  enabled: boolean;
  protocolVersion: number;
  signallingPolicy?: string;
  ringSeconds: number;
  relayPolicyOptions: string[];
}
async function write<T>(method: 'post' | 'delete', path: string, body?: unknown): Promise<T> {
  const auth = useAuthStore();
  await auth.fetchCsrfToken();
  return (
    await api.request<T>({
      method,
      url: `/api/v1${path}`,
      data: body,
      headers: { 'X-CSRF-Token': auth.csrfToken },
    })
  ).data;
}
export const callsApi: CallsApi & {
  config(): Promise<CallsConfig>;
  history(before?: string): Promise<CallPage<ServerCall>>;
  clearHistory(id?: string): Promise<void>;
} = {
  create: (linkId) =>
    write<CreateResult>('post', '/calls', { linkId, media: 'audio', protocolVersion: 1 }),
  ready: async (id) => { await write('post', `/calls/${id}/ready`, {}); },
  answer: (id) => write<AnswerResult>('post', `/calls/${id}/answer`, {}),
  get: async (id) => (await api.get<{ call: ServerCall }>(`/api/v1/calls/${id}`)).data.call,
  active: async () => (await api.get<{ calls: ServerCall[] }>('/api/v1/calls/active')).data.calls,
  ice: async (callId) =>
    (await api.get<IceResult>('/api/v1/calls/ice', { params: { callId } })).data,
  end: async (id, reason, report) => {
    await write('post', `/calls/${id}/end`, { reason, ...(report ? { relayed: report.relayed, qualityBucket: report.qualityBucket } : {}) });
  },
  decline: async (id) => {
    await write('post', `/calls/${id}/decline`, { reason: 'declined' });
  },
  config: async () => (await api.get<CallsConfig>('/api/v1/config/calls')).data,
  history: async (before) =>
    (
      await api.get<CallPage<ServerCall>>('/api/v1/calls/history', {
        params: before ? { before, limit: '50' } : { limit: '50' },
      })
    ).data,
  clearHistory: async (id) => {
    await write('delete', `/calls/history${id ? `/${id}` : ''}`);
  },
};
