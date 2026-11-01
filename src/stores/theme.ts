import { defineStore } from 'pinia';
import { api } from 'src/boot/axios';
import { useAuthStore } from './auth';
import { useDevicePreferencesStore } from './devicePreferences';
import { isDesktopBuild } from 'src/utils/platform';
import { applyTheme, clearTheme } from 'src/theme/apply';
import {
  defaults,
  clone,
  normalizePrefs,
  validatePrefs,
  type ThemePrefs,
} from 'src/theme/preferences';
export const THEME_ENABLED = import.meta.env.VITE_CLIENT_THEMES !== 'false';
const key = (id: string) => (id ? `mourn_theme_u1:${id}` : 'mourn_theme_guest_v1');
const SYNC_TIMEOUT = 5000;
async function bounded<T>(controller: AbortController, task: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Appearance sync timed out'));
        }, SYNC_TIMEOUT);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function read(id: string): { prefs: ThemePrefs; pending: boolean } | null {
  try {
    const x = JSON.parse(localStorage.getItem(key(id)) || 'null') as {
      prefs: unknown;
      pending: boolean;
    } | null;
    const prefs = x && normalizePrefs(x.prefs);
    return prefs ? { prefs, pending: x?.pending === true } : null;
  } catch {
    return null;
  }
}
function write(id: string, prefs: ThemePrefs, pending: boolean) {
  try {
    localStorage.setItem(key(id), JSON.stringify({ prefs, pending }));
    localStorage.setItem('mourn_theme_last', JSON.stringify({ v: 1, userId: id, prefs }));
  } catch {
    /* storage is optional */
  }
}
let zoomQueue = Promise.resolve();
export const useThemeStore = defineStore('theme', {
  state: () => ({
    prefs: defaults(),
    committed: defaults(),
    userId: '',
    epoch: 0,
    revision: 0,
    savedRevision: 0,
    loading: false,
    saving: false,
    pending: false,
    error: '',
    suspended: false,
  }),
  getters: { dirty: (s) => JSON.stringify(s.prefs) !== JSON.stringify(s.committed) },
  actions: {
    render() {
      if (!THEME_ENABLED) return;
      if (this.suspended) clearTheme();
      else applyTheme(this.prefs);
      useDevicePreferencesStore().setThemeReduceMotion(
        !this.suspended && this.prefs.extras.reduceMotion,
      );
      if (isDesktopBuild) {
        const scale = this.suspended ? 1 : this.prefs.scale;
        zoomQueue = zoomQueue
          .then(async () => {
            const { getCurrentWebview } = await import('@tauri-apps/api/webview');
            await getCurrentWebview().setZoom(scale);
          })
          .catch(() => {
            this.error = 'Desktop zoom could not be applied.';
          });
      }
    },
    preview(p: ThemePrefs) {
      if (!validatePrefs(p)) return;
      this.prefs = clone(p);
      this.revision++;
      this.render();
    },
    cancel() {
      this.preview(this.committed);
    },
    reset() {
      const p = defaults();
      p.saved = clone(this.prefs).saved;
      this.preview(p);
    },
    async setAccount(id: string) {
      const epoch = ++this.epoch;
      this.userId = id;
      this.loading = false;
      this.saving = false;
      this.error = '';
      this.pending = false;
      this.prefs = defaults();
      this.committed = defaults();
      this.revision++;
      const cache = read(id);
      if (cache) {
        this.prefs = clone(cache.prefs);
        this.committed = clone(cache.prefs);
        this.pending = cache.pending;
      }
      this.render();
      if (!id || !THEME_ENABLED) return;
      if (this.pending) {
        void this.sync();
        return;
      }
      this.loading = true;
      const revision = this.revision;
      const savedRevision = this.savedRevision;
      void this.loadAccount(id, epoch, revision, savedRevision);
    },
    async loadAccount(id: string, epoch: number, revision: number, savedRevision: number) {
      const controller = new AbortController();
      try {
        const { data } = await bounded(controller, () =>
          api.get<{ success: boolean; data: unknown }>('/api/v1/preferences/appearance', {
            signal: controller.signal,
          }),
        );
        if (epoch !== this.epoch || savedRevision !== this.savedRevision) return;
        const prefs = data.success ? normalizePrefs(data.data) : null;
        if (!prefs) throw new Error('Invalid appearance response');
        this.committed = clone(prefs);
        write(id, this.committed, false);
        if (revision === this.revision) {
          this.prefs = clone(prefs);
          this.render();
        }
      } catch {
        if (epoch === this.epoch && savedRevision === this.savedRevision)
          this.error = 'Account theme unavailable. Cached settings remain active.';
      } finally {
        if (epoch === this.epoch) this.loading = false;
      }
    },
    async save() {
      if (!THEME_ENABLED || !validatePrefs(this.prefs)) return;
      this.savedRevision++;
      this.pending = !!this.userId;
      this.committed = clone(this.prefs);
      write(this.userId, this.committed, this.pending);
      void this.sync();
    },
    async sync() {
      if (!this.userId || this.saving || !this.pending) return;
      const id = this.userId,
        epoch = this.epoch,
        savedRevision = this.savedRevision,
        payload = clone(this.committed);
      this.saving = true;
      const controller = new AbortController();
      try {
        const auth = useAuthStore();
        const { data } = await bounded(controller, async () => {
          await auth.fetchCsrfToken();
          if (controller.signal.aborted || epoch !== this.epoch)
            throw new Error('Appearance sync superseded');
          return api.put<{ success: boolean; data: unknown }>(
            '/api/v1/preferences/appearance',
            payload,
            { headers: { 'X-CSRF-Token': auth.csrfToken }, signal: controller.signal },
          );
        });
        if (epoch !== this.epoch || savedRevision !== this.savedRevision) return;
        if (!data.success || !normalizePrefs(data.data))
          throw new Error('Invalid appearance response');
        // The explicit local save is authoritative; sync only acknowledges it.
        this.pending = false;
        this.error = '';
        write(id, payload, false);
      } catch {
        if (epoch === this.epoch && savedRevision === this.savedRevision)
          this.error = 'Account theme unavailable. Saved locally; retry when online.';
      } finally {
        if (epoch === this.epoch) {
          this.saving = false;
          if (savedRevision !== this.savedRevision) void this.sync();
        }
      }
    },
  },
});
