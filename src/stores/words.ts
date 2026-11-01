import { defineStore } from 'pinia';
import { api } from 'boot/axios';
import { useAuthStore } from 'src/stores/auth';
import type { WordQuote, WordQuoteDraft } from 'src/types/words';

function buildAuthHeaders(csrfToken: string) {
  return {
    'X-CSRF-Token': csrfToken,
    'Content-Type': 'application/json',
  };
}

function normalizeWordQuote(payload: unknown): WordQuote | null {
  if (!payload || typeof payload !== 'object') return null;

  const quote = payload as Partial<WordQuote>;
  if (!quote.id || !quote.content || !quote.author) return null;

  return {
    id: String(quote.id),
    content: String(quote.content),
    author: String(quote.author),
    weight: Number(quote.weight ?? 1),
    isActive: Boolean(quote.isActive),
    createdAt: String(quote.createdAt ?? ''),
    updatedAt: String(quote.updatedAt ?? ''),
  };
}

export const useWordsStore = defineStore('words', {
  state: () => ({
    quotes: [] as WordQuote[],
    loading: false,
    saving: false,
    loaded: false,
    error: '' as string,
  }),

  actions: {
    async fetchWords(force = false) {
      if (this.loaded && !force) {
        return this.quotes;
      }

      this.loading = true;
      this.error = '';

      try {
        const response = await api.get('/api/admin/words');
        if (response.data?.success) {
          this.quotes = (response.data.data?.words || []) as WordQuote[];
          this.loaded = true;
          return this.quotes;
        }

        return this.quotes;
      } catch (error) {
        this.error = 'Failed to load words';
        if (import.meta.env.DEV) console.error('Words fetch failed', error);
        return this.quotes;
      } finally {
        this.loading = false;
      }
    },

    async createWord(draft: WordQuoteDraft) {
      const authStore = useAuthStore();
      this.saving = true;
      this.error = '';

      try {
        await authStore.fetchCsrfToken();
        const response = await api.post('/api/admin/words', draft, {
          headers: buildAuthHeaders(authStore.csrfToken),
        });

        const created = normalizeWordQuote(response.data?.data?.word);
        if (response.data?.success && created) {
          this.quotes = [created, ...this.quotes];
          this.loaded = true;
          return created;
        }
        return null;
      } catch (error) {
        this.error = 'Failed to create word';
        if (import.meta.env.DEV) console.error('Words create failed', error);
        return null;
      } finally {
        this.saving = false;
      }
    },

    async updateWord(id: string, draft: Partial<WordQuoteDraft>) {
      const authStore = useAuthStore();
      this.saving = true;
      this.error = '';

      try {
        await authStore.fetchCsrfToken();
        const response = await api.patch(`/api/admin/words/${encodeURIComponent(id)}`, draft, {
          headers: buildAuthHeaders(authStore.csrfToken),
        });

        const updated = normalizeWordQuote(response.data?.data?.word);
        if (response.data?.success && updated) {
          this.quotes = this.quotes.map((quote) => (quote.id === updated.id ? updated : quote));
          this.loaded = true;
          return updated;
        }
        return null;
      } catch (error) {
        this.error = 'Failed to update word';
        if (import.meta.env.DEV) console.error('Words update failed', error);
        return null;
      } finally {
        this.saving = false;
      }
    },

    async deleteWord(id: string) {
      const authStore = useAuthStore();
      this.saving = true;
      this.error = '';

      try {
        await authStore.fetchCsrfToken();
        const response = await api.delete(`/api/admin/words/${encodeURIComponent(id)}`, {
          headers: buildAuthHeaders(authStore.csrfToken),
        });

        if (response.data?.success) {
          this.quotes = this.quotes.filter((quote) => quote.id !== id);
          this.loaded = true;
          return true;
        }
        return false;
      } catch (error) {
        this.error = 'Failed to delete word';
        if (import.meta.env.DEV) console.error('Words delete failed', error);
        return false;
      } finally {
        this.saving = false;
      }
    },
  },
});
