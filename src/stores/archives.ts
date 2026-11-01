import { defineStore } from 'pinia';
import { captureAccountOperation, nextStoreRequest } from 'src/utils/accountLifecycle';
import { api } from 'boot/axios';
import type { Archive, ArchiveListItem } from 'src/types/archives';
import {
  storeOfflineBlob,
  readOfflineBlob,
  loadOfflineBlob,
  removeOfflineBlob,
  isOfflineVaultEnabled,
  isOfflineModeAuthorized,
} from 'src/crypto/offlineVault';
import { encodeArchivePayload, decodeArchivePayload } from 'src/utils/offlineArchiveCodec';

interface ArchivesState {
  archives: ArchiveListItem[];
  currentArchive: Archive | null;
  loading: boolean;
  archiveLoading: boolean;
  saving: boolean;
  page: number;
  total: number;
  limit: number;
  /** The offline bookmarked slugs currently saved to the encrypted vault (desktop only). */
  offlineSlugs: string[];
  /** True when the current archive was served from the offline vault (offline read). */
  currentFromOffline: boolean;
}

export const useArchivesStore = defineStore('archives', {
  state: (): ArchivesState => ({
    archives: [],
    currentArchive: null,
    loading: false,
    archiveLoading: false,
    saving: false,
    page: 1,
    total: 0,
    limit: 20,
    offlineSlugs: [],
    currentFromOffline: false,
  }),

  actions: {
    // ─── Public: fetch archive listing ───
    async fetchArchives(page = 1) {
      const operation = captureAccountOperation();
      this.loading = true;
      try {
        const response = await api.get('/api/v1/archives', {
          params: { page, limit: this.limit },
        });
        operation.assertCurrent();
        if (response.data.success) {
          this.archives = response.data.data.archives;
          this.page = response.data.meta.page;
          this.total = response.data.meta.total;
        }
        return { success: true };
      } catch (error: unknown) {
        operation.assertCurrent();
        const resp = (error as { response?: { data?: { error?: string } } })?.response;
        return { success: false, error: resp?.data?.error || 'Failed to fetch archives.' };
      } finally {
        if (operation.isCurrent()) this.loading = false;
      }
    },

    // ─── Public: fetch single archive by slug ───
    async fetchArchive(slug: string) {
      const operation = captureAccountOperation();
      const isLatest = nextStoreRequest(this, 'archive');
      const assertCurrent = () => { operation.assertCurrent(); if (!isLatest()) throw new Error('Archive request superseded'); };
      this.archiveLoading = true;
      this.currentArchive = null;
      this.currentFromOffline = false;
      try {
        // OFFLINE-FIRST (krul 2026-08): if the runtime already reports
        // disconnected, do NOT waste a doomed network request that returns a
        // 404. Go straight to the encrypted vault — but ONLY when offline mode
        // is authorized (desktop + authenticated + stay-logged-in).
        const definitelyOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (definitelyOffline) {
          const authed = await isOfflineModeAuthorized();
          if (authed.authorized && (await this.isOfflineAvailable(slug))) {
            const offlineBytes = await readOfflineBlob('archive', slug).catch(() => undefined);
            if (offlineBytes) {
              try {
                assertCurrent();
                this.currentArchive = decodeArchivePayload(offlineBytes);
                this.currentFromOffline = true;
                return { success: true, offline: true };
              } catch (decodeErr) {
                if (import.meta.env.DEV) {
                  console.warn('[archives] offline decode failed', decodeErr);
                }
              }
            }
          }
        }

        assertCurrent();
        const response = await api.get(`/api/v1/archives/${slug}`);
        assertCurrent();
        if (response.data.success) {
          this.currentArchive = response.data.data.archive;
        }
        return { success: true };
      } catch (error: unknown) {
        operation.assertCurrent();
        const resp = (error as { response?: { status?: number; data?: { error?: string } } })
          ?.response;
        // A genuine network failure (no HTTP status) → fall back to the
        // encrypted offline vault. 403/404 are NOT network errors — surface
        // them as-is (access control still binds offline).
        assertCurrent();
        if (resp?.status === 401 || resp?.status === 403 || resp?.status === 404) {
          return { success: false, error: resp.data?.error || 'Access denied.', forbidden: true };
        }
        if (resp) {
          // Authorization and not-found responses above never fall back. For
          // other HTTP failures, an explicitly authorized saved copy may be used.
          const authed = await isOfflineModeAuthorized();
          if (authed.authorized && (await this.isOfflineAvailable(slug))) {
            const offlineBytes = await readOfflineBlob('archive', slug).catch(() => undefined);
            if (offlineBytes) {
              try {
                assertCurrent();
                this.currentArchive = decodeArchivePayload(offlineBytes);
                this.currentFromOffline = true;
                return { success: true, offline: true };
              } catch (decodeErr) {
                if (import.meta.env.DEV) {
                  console.warn('[archives] offline decode failed', decodeErr);
                }
              }
            }
          }
          return { success: false, error: resp?.data?.error || 'Failed to fetch archive.' };
        }
        // Offline read path (desktop only + authorized).
        const state = await isOfflineModeAuthorized();
        if (state.authorized) {
          const bytes = await readOfflineBlob('archive', slug).catch(() => undefined);
          if (bytes) {
            try {
              assertCurrent();
              this.currentArchive = decodeArchivePayload(bytes);
              this.currentFromOffline = true;
              return { success: true, offline: true };
            } catch (decodeErr) {
              if (import.meta.env.DEV) {
                console.warn('[archives] offline decode failed', decodeErr);
              }
            }
          }
        }
        return {
          success: false,
          error: 'Failed to fetch archive, and no offline copy is stored on this device.',
        };
      } finally {
        if (operation.isCurrent() && isLatest()) this.archiveLoading = false;
      }
    },

    // ─── Offline vault: saved-slug registry ───
    // The registry itself is a thin IndexedDB entry (store the slug list, not
    // content) so the Archives list can show which records are readable offline.
    async _persistSlugRegistry() {
      const operation = captureAccountOperation();
      if (!operation.uid) throw new Error('Select an authenticated account before changing offline archives');
      const context = { kind: 'archive', id: '__slugs__', accountId: operation.uid };
      const slugs = [...new Set(this.offlineSlugs)];
      if (!isOfflineVaultEnabled() || slugs.length === 0) {
        await removeOfflineBlob('archive', '__slugs__', context);
        return;
      }
      await storeOfflineBlob('archive', '__slugs__', new Uint8Array(0), {
        list: slugs.join(','),
      }, context);
      operation.assertCurrent();
    },

    async syncOfflineSlugs() {
      const operation = captureAccountOperation();
      if (!isOfflineVaultEnabled()) {
        this.offlineSlugs = [];
        return;
      }
      try {
        const saved = (await loadOfflineBlob('archive', '__slugs__'))?.meta;
        operation.assertCurrent();
        if (saved && saved.list) {
          this.offlineSlugs = saved.list.split(',');
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[archives] syncOfflineSlugs failed', err);
        }
      }
    },

    // ─── Offline vault: is a given archive saved locally? ───
    async isOfflineAvailable(slug: string): Promise<boolean> {
      if (!isOfflineVaultEnabled()) return false;
      try {
        const blob = await loadOfflineBlob('archive', slug);
        return !!blob;
      } catch {
        return false;
      }
    },

    // ─── Offline vault: save archive for offline reading ───
    async saveArchiveOffline(slug: string) {
      const operation = captureAccountOperation();
      const accountId = operation.uid;
      if (!accountId) return { success: false, error: 'Authentication required' };
      if (!isOfflineVaultEnabled()) return { success: true, disabled: true };
      this.saving = true;
      try {
        // Re-fetch the archive if not already loaded so we always have fresh
        // content to encrypt (never encrypt a stale cached object).
        let archive = this.currentArchive;
        if (!archive || archive.slug !== slug) {
          const response = await api.get(`/api/v1/archives/${slug}`);
          if (!response.data.success) {
            return { success: false, error: response.data.error || 'Failed to load archive.' };
          }
          archive = response.data.data.archive as Archive;
        }
        operation.assertCurrent();
        await operation.wait(() => storeOfflineBlob('archive', slug, encodeArchivePayload(archive), {
          slug,
          title: archive.title,
        }, { kind: 'archive', id: slug, accountId }));
        this.offlineSlugs = [...new Set([...this.offlineSlugs, slug])];
        await operation.wait(() => this._persistSlugRegistry());
        await operation.wait(() => this.syncOfflineSlugs());
        return { success: true };
      } catch (error: unknown) {
        const resp = (error as { response?: { data?: { error?: string } } })?.response;
        return {
          success: false,
          error: resp?.data?.error || 'Failed to save archive for offline reading.',
        };
      } finally {
        if (operation.isCurrent()) this.saving = false;
      }
    },

    // ─── Offline vault: remove the encrypted copy from this device ───
    async discardArchiveOffline(slug: string) {
      const operation = captureAccountOperation();
      if (!isOfflineVaultEnabled()) return { success: true, disabled: true };
      try {
        await operation.wait(() => removeOfflineBlob('archive', slug));
        this.offlineSlugs = this.offlineSlugs.filter((s) => s !== slug);
        await operation.wait(() => this._persistSlugRegistry());
        await operation.wait(() => this.syncOfflineSlugs());
        return { success: true };
      } catch (error: unknown) {
        const resp = (error as { response?: { data?: { error?: string } } })?.response;
        return {
          success: false,
          error: resp?.data?.error || 'Failed to remove the offline copy.',
        };
      }
    },

    // ─── Offline vault: list which archive slugs are saved locally ───
    async listOfflineArchives(): Promise<string[]> {
      if (!isOfflineVaultEnabled()) return [];
      await this.syncOfflineSlugs();
      return [...this.offlineSlugs];
    },

    // ─── Offline vault: build a displayable ArchiveListItem[] of what's saved ───
    // Used by the Archives page when offline so the list reflects only the
    // records actually readable on this device (decrypted from the vault).
    async loadOfflineArchiveList(): Promise<ArchiveListItem[]> {
      if (!isOfflineVaultEnabled()) return [];
      await this.syncOfflineSlugs();
      const items: ArchiveListItem[] = [];
      for (const slug of this.offlineSlugs) {
        try {
          const bytes = await readOfflineBlob('archive', slug);
          if (!bytes) continue;
          const a = decodeArchivePayload(bytes);
          items.push({
            id: a.id,
            slug: a.slug,
            title: a.title,
            description: a.description,
            isPublic: a.isPublic,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt,
            encrypted: a.encrypted,
          });
        } catch {
          // Skip blobs that failed to decrypt or decode.
        }
      }
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return items;
    },

    // ─── Offline vault: approximate on-disk size (bytes) of a saved archive ───
    // The stored footprint is the encrypted ciphertext + nonce held in
    // IndexedDB. We measure the base64 payload length — deterministic, no
    // decryption needed — so the "manage downloads" list can show real size.
    async getOfflineArchiveSize(slug: string): Promise<number> {
      if (!isOfflineVaultEnabled()) return 0;
      try {
        const blob = await loadOfflineBlob('archive', slug);
        if (!blob) return 0;
        return (blob.ciphertextB64?.length || 0) + (blob.nonceB64?.length || 0);
      } catch {
        return 0;
      }
    },

    // ─── Offline vault: batch download a set of archives ───
    // Fetches each fresh over the network, encrypts, and persists to the vault.
    // Returns a summary of per-slug results for progress UI.
    async downloadArchivesOffline(slugs: string[]): Promise<{
      downloaded: string[];
      failed: string[];
      skipped: string[];
    }> {
      const operation = captureAccountOperation();
      const accountId = operation.uid;
      if (!accountId) throw new Error('Authentication required');
      const downloaded: string[] = [];
      const failed: string[] = [];
      const skipped: string[] = [];
      if (!isOfflineVaultEnabled()) return { downloaded, failed, skipped };

      for (const slug of slugs) {
        const already = await operation.wait(() => this.isOfflineAvailable(slug));
        if (already) {
          skipped.push(slug);
          continue;
        }
        try {
          const response = await api.get(`/api/v1/archives/${slug}`);
          if (!response.data.success || !response.data.data?.archive) {
            failed.push(slug);
            continue;
          }
          operation.assertCurrent();
          const archive = response.data.data.archive as Archive;
          await operation.wait(() => storeOfflineBlob('archive', slug, encodeArchivePayload(archive), {
            slug,
            title: archive.title,
          }, { kind: 'archive', id: slug, accountId }));
          if (!this.offlineSlugs.includes(slug)) {
            this.offlineSlugs.push(slug);
          }
          downloaded.push(slug);
        } catch (err) {
          const resp = (
            err as {
              response?: { status?: number; data?: { error?: string } };
            }
          )?.response;
          // A network-level failure (no HTTP status) means the batch can't
          // proceed (e.g. fully offline) — stop early and report.
          if (!resp) {
            failed.push(slug);
            break;
          }
          failed.push(slug);
        }
      }
      await operation.wait(() => this._persistSlugRegistry());
      await operation.wait(() => this.syncOfflineSlugs());
      return { downloaded, failed, skipped };
    },

    // ─── Offline vault: sync all (download everything missing) ───
    async syncAllOffline(): Promise<{ downloaded: string[]; failed: string[]; skipped: string[] }> {
      const operation = captureAccountOperation();
      // Refresh the visible listing first so we sync against current data.
      await operation.wait(() => this.fetchArchives(1));
      const slugs = this.archives.filter((a) => !a.encrypted).map((a) => a.slug);
      return this.downloadArchivesOffline(slugs);
    },
  },
});
