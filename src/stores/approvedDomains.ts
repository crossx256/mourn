/**
 * Admin-approved custom domains.
 *
 * A user can ask for a domain outside the built-in platform list to be recognised
 * (`POST /api/v1/domains/submissions`); once an admin approves it, the domain works for
 * everyone. The server is authoritative (it also marks each link `recognized` in the public
 * payload), but the editor needs the set before anything is saved — so it is fetched once
 * per session and registered into `utils/socialLinks`, where all recognition goes through.
 *
 * Failure is soft by design: if the list cannot be fetched the built-in table still works
 * and unknown hosts simply keep their warning.
 */

import { defineStore } from 'pinia';
import { api } from 'boot/axios';
import { registerApprovedDomains } from 'src/utils/socialLinks';

interface ApprovedDomainsState {
  domains: string[];
  loaded: boolean;
  loading: boolean;
  error: string;
}

let inflight: Promise<void> | null = null;

export const useApprovedDomainsStore = defineStore('approvedDomains', {
  state: (): ApprovedDomainsState => ({
    domains: [],
    loaded: false,
    loading: false,
    error: '',
  }),

  actions: {
    /** Fetch once per session (concurrent callers share the same request). */
    async ensureLoaded(): Promise<void> {
      if (this.loaded) return;
      if (inflight) return inflight;
      inflight = this.fetchDomains().finally(() => {
        inflight = null;
      });
      return inflight;
    },

    async fetchDomains(): Promise<void> {
      this.loading = true;
      this.error = '';
      try {
        const response = await api.get<{ success?: boolean; data?: { domains?: string[] } }>(
          '/api/v1/public/recognized-domains',
        );
        const domains = response.data?.data?.domains;
        this.domains = Array.isArray(domains) ? domains.filter((d) => typeof d === 'string') : [];
        registerApprovedDomains(this.domains);
        this.loaded = true;
      } catch (error) {
        // Keep whatever we had (usually nothing) — recognition falls back to the built-in
        // table and unknown hosts keep their warning.
        this.error = (error as Error)?.message || 'could not load approved domains';
      } finally {
        this.loading = false;
      }
    },

    /** Force a refetch, e.g. after the user's request was approved while they were online. */
    async refresh(): Promise<void> {
      this.loaded = false;
      await this.ensureLoaded();
    },
  },
});
