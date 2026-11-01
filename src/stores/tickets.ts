import { defineStore } from 'pinia';
import { api } from 'boot/axios';
import { useAuthStore } from './auth';
import {
  MAX_TICKET_ATTACHMENTS,
  MAX_TICKET_ATTACHMENT_BYTES,
  type Ticket,
  type TicketCreatePayload,
  type TicketListPayload,
  type TicketPaginationMeta,
  type TicketReportSearchUser,
  type TicketTargetPrefill,
} from 'src/types/ticket';

interface TicketEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
  message?: string;
  meta?: TicketPaginationMeta;
}

interface TicketsState {
  /** The caller's OWN tickets. */
  myTickets: Ticket[];
  loading: boolean;
  error: string;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  submitting: boolean;
  uploadProgress: number;
  /** Composer modal state — hosted once in MainLayout, opened from anywhere. */
  composerOpen: boolean;
  composerPrefill: TicketTargetPrefill | null;
}

function requestError(error: unknown, fallback: string): string {
  const response = (error as { response?: { data?: { error?: string; message?: string } } })
    .response;
  return response?.data?.error || response?.data?.message || (error as Error)?.message || fallback;
}

export const useTicketsStore = defineStore('tickets', {
  state: (): TicketsState => ({
    myTickets: [],
    loading: false,
    error: '',
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
    submitting: false,
    uploadProgress: 0,
    composerOpen: false,
    composerPrefill: null,
  }),

  getters: {
    pendingCount: (state) => state.myTickets.filter((t) => t.status === 'pending').length,
    openCount: (state) =>
      state.myTickets.filter((t) => t.status === 'pending' || t.status === 'in_progress').length,
  },

  actions: {
    /**
     * Open the shared ticket composer, optionally pre-set to a target. Every
     * report entry point in the app funnels through this so the surfaces never
     * build their own submission flow.
     */
    openComposer(prefill: TicketTargetPrefill | null = null) {
      this.composerPrefill = prefill;
      this.composerOpen = true;
    },

    closeComposer() {
      this.composerOpen = false;
      this.composerPrefill = null;
    },

    /**
     * Upload screenshots. Enforced client-side too (count/size/type) so the
     * user gets an immediate message instead of a 413/415 round-trip; the
     * server re-validates everything (magic numbers, size, re-encode).
     */
    async uploadAttachments(files: File[]): Promise<string[]> {
      if (files.length === 0) return [];
      if (files.length > MAX_TICKET_ATTACHMENTS) {
        throw new Error(`a maximum of ${MAX_TICKET_ATTACHMENTS} screenshots is allowed`);
      }
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          throw new Error('only image screenshots can be attached');
        }
        if (file.size > MAX_TICKET_ATTACHMENT_BYTES) {
          throw new Error('each screenshot must be 5MB or smaller');
        }
      }

      const authStore = useAuthStore();
      await authStore.fetchCsrfToken();

      const form = new FormData();
      for (const file of files) form.append('files', file);

      const response = await api.post<TicketEnvelope<{ paths: string[] }>>(
        '/api/v1/tickets/attachments',
        form,
        {
          headers: { 'X-CSRF-Token': authStore.csrfToken },
          onUploadProgress: (event) => {
            const total = event.total || 0;
            this.uploadProgress = total > 0 ? Math.round((event.loaded / total) * 100) : 0;
          },
        },
      );

      this.uploadProgress = 0;

      if (!response.data?.success || !response.data.data?.paths) {
        throw new Error(response.data?.error || 'screenshot upload failed');
      }
      return response.data.data.paths;
    },

    async submitTicket(payload: TicketCreatePayload): Promise<Ticket> {
      const authStore = useAuthStore();
      this.submitting = true;
      this.error = '';
      try {
        await authStore.fetchCsrfToken();
        const response = await api.post<TicketEnvelope<{ ticket: Ticket }>>(
          '/api/v1/tickets',
          payload,
          { headers: { 'X-CSRF-Token': authStore.csrfToken } },
        );

        if (!response.data?.success || !response.data.data?.ticket) {
          throw new Error(response.data?.error || 'ticket submission failed');
        }

        // Reflect the new ticket in the user's own list immediately.
        this.myTickets = [response.data.data.ticket, ...this.myTickets];
        this.total += 1;
        return response.data.data.ticket;
      } catch (error) {
        const message = requestError(error, 'ticket submission failed');
        this.error = message;
        throw new Error(message);
      } finally {
        this.submitting = false;
      }
    },

    async fetchMyTickets(page?: number) {
      const targetPage = page ?? this.page;
      this.loading = true;
      this.error = '';
      try {
        const response = await api.get<TicketEnvelope<TicketListPayload>>('/api/v1/tickets', {
          params: { page: targetPage, limit: this.limit },
        });

        if (!response.data?.success || !response.data.data) {
          throw new Error(response.data?.error || 'failed to load your tickets');
        }

        const meta = response.data.meta;
        this.myTickets = response.data.data.tickets || [];
        this.page = meta?.page ?? targetPage;
        this.limit = meta?.limit ?? this.limit;
        this.total = meta?.total ?? this.myTickets.length;
        this.totalPages = Math.max(1, meta?.totalPages ?? 1);
      } catch (error) {
        this.myTickets = [];
        this.error = requestError(error, 'failed to load your tickets');
      } finally {
        this.loading = false;
      }
    },

    async fetchTicket(ticketId: string): Promise<Ticket> {
      const response = await api.get<TicketEnvelope<{ ticket: Ticket }>>(
        `/api/v1/tickets/${encodeURIComponent(ticketId)}`,
      );
      if (!response.data?.success || !response.data.data?.ticket) {
        throw new Error(response.data?.error || 'failed to load ticket');
      }
      return response.data.data.ticket;
    },

    /** Username search for the "report a profile" picker. */
    async searchUsers(query: string): Promise<TicketReportSearchUser[]> {
      const trimmed = query.trim();
      // 1-character usernames exist, and the backend resolves a <3-char query
      // by exact match, so a single character is valid here too.
      if (trimmed.length < 1) return [];
      // GET /api/v1/search/users returns { success, data: <User[]|null> } — the
      // payload is the ARRAY, not an object wrapper.
      const response = await api.get<{
        success?: boolean;
        data?: Array<{ id: string; username: string }> | null;
        error?: string;
      }>('/api/v1/search/users', { params: { q: trimmed } });

      if (response.data?.success === false) {
        throw new Error(response.data.error || 'user lookup failed');
      }

      const users = response.data?.data ?? [];
      return users.map((user) => ({ id: user.id, username: user.username }));
    },
  },
});
