/**
 * The user's own "please recognise this domain" requests.
 *
 * A request is reviewed in the admin panel; approving it makes the domain recognised for
 * everyone (the server pushes the approved set into the recognition overlay). The dashboard
 * lists these so the user can see where their request stands, including the reviewer's note
 * when it was rejected.
 */

import { defineStore } from 'pinia';
import { api } from 'boot/axios';
import { useAuthStore } from 'stores/auth';

export type DomainRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface DomainRequest {
  id: string;
  domain: string;
  sampleUrl: string | null;
  reason: string | null;
  status: DomainRequestStatus;
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

interface DomainRequestsState {
  submissions: DomainRequest[];
  loading: boolean;
  submitting: boolean;
  error: string;
  notice: string;
}

function requestError(error: unknown, fallback: string): string {
  const response = (error as { response?: { data?: { error?: string } } }).response;
  return response?.data?.error || (error as Error)?.message || fallback;
}

export const useDomainRequestsStore = defineStore('domainRequests', {
  state: (): DomainRequestsState => ({
    submissions: [],
    loading: false,
    submitting: false,
    error: '',
    notice: '',
  }),

  getters: {
    pendingCount: (state) => state.submissions.filter((row) => row.status === 'PENDING').length,
    approvedDomains: (state) =>
      state.submissions.filter((row) => row.status === 'APPROVED').map((row) => row.domain),
    statusOf: (state) => (domain: string) =>
      state.submissions.find((row) => row.domain === domain)?.status ?? null,
  },

  actions: {
    async fetchMine(): Promise<void> {
      this.loading = true;
      this.error = '';
      try {
        const response = await api.get<Envelope<{ submissions: DomainRequest[] }>>(
          '/api/v1/domains/submissions',
        );
        this.submissions = response.data?.data?.submissions ?? [];
      } catch (error) {
        this.error = requestError(error, 'could not load your requests');
      } finally {
        this.loading = false;
      }
    },

    /** Submit (or re-open) a request. Returns the row, or null when it was refused. */
    async submit(input: string, reason?: string): Promise<DomainRequest | null> {
      const value = input.trim();
      if (!value) return null;
      this.submitting = true;
      this.error = '';
      this.notice = '';
      try {
        // A POST is CSRF-gated server-side: the token has to ride on the request as
        // X-CSRF-Token, and the raw axios client has no interceptor that adds it.
        // Going through the auth store's helper also re-fetches + retries once, and
        // switches to the bearer-token path on the mobile runtime.
        const authStore = useAuthStore();
        const response = await authStore.postWithFreshCsrf<
          Envelope<{
            submission: DomainRequest;
            alreadyPending?: boolean;
            reopened?: boolean;
            mine?: boolean;
          }>
        >('/api/v1/domains/submissions', {
          url: value,
          reason: reason?.trim() || undefined,
        });
        const payload = response.data?.data;
        if (!payload?.submission) throw new Error(response.data?.error || 'request failed');

        this.notice = payload.alreadyPending
          ? `${payload.submission.domain} is already waiting for review`
          : payload.reopened
            ? `re-sent ${payload.submission.domain} for review`
            : `requested ${payload.submission.domain}`;

        // Domains are globally unique, so an already-pending row may belong to someone
        // else — only the first requester gets the decision, and this list must never
        // show a request that isn't ours.
        if (payload.mine !== false) {
          const existing = this.submissions.findIndex((row) => row.id === payload.submission.id);
          if (existing === -1) this.submissions = [payload.submission, ...this.submissions];
          else this.submissions.splice(existing, 1, payload.submission);
        }
        return payload.submission;
      } catch (error) {
        this.error = requestError(error, 'could not send that request');
        return null;
      } finally {
        this.submitting = false;
      }
    },

    clearNotice() {
      this.notice = '';
      this.error = '';
    },
  },
});
