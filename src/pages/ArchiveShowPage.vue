<template>
  <q-page class="arc-page">
    <!-- Reading progress bar -->
    <div
      class="fixed top-0 left-0 h-px bg-[#ff0000] z-[100] transition-all duration-100"
      :style="{ width: `${scrollProgress}%` }"
    />

    <!-- Back arrow: fixed left edge on desktop, inline with text on mobile -->
    <router-link to="/archives" class="arc-back-arrow" aria-label="Back to archives">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      </svg>
      <span class="arc-back-text">back to the archives</span>
    </router-link>

    <!-- Loading -->
    <div v-if="archivesStore.archiveLoading" class="flex items-center justify-center min-h-[60vh]">
      <span class="text-xs tracking-[0.3em] uppercase font-light text-[#555] font-mono">
        decrypting record...
      </span>
    </div>

    <!-- Forbidden -->
    <div
      v-else-if="forbidden"
      class="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-6"
    >
      <span class="text-[#ff3333] text-[10px] font-mono tracking-[0.3em] uppercase">
        403 — ACCESS DENIED
      </span>
      <p class="font-mono text-xs text-[#555] max-w-[400px]">
        {{ errorMsg }}
      </p>
      <router-link
        to="/archives"
        class="text-[10px] font-mono tracking-[0.2em] uppercase text-[#555] hover:text-[#ff0000] transition-colors decoration-none mt-6"
      >
        return
      </router-link>
    </div>

    <!-- Not found -->
    <div
      v-else-if="notFound"
      class="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-6"
    >
      <span class="text-[#555] text-[10px] font-mono tracking-[0.3em] uppercase">
        404 — NOT FOUND
      </span>
      <p class="font-mono text-xs text-[#555]">this record does not exist, or has been erased.</p>
      <router-link
        to="/archives"
        class="text-[10px] font-mono tracking-[0.2em] uppercase text-[#555] hover:text-[#ff0000] transition-colors decoration-none mt-6"
      >
        return
      </router-link>
    </div>

    <!-- Archive content -->
    <article
      v-else-if="archivesStore.currentArchive"
      ref="articleRef"
      class="w-full max-w-[720px] mx-auto px-6 py-20"
    >
      <!-- Archive header -->
      <header class="mb-14">
        <time class="text-[10px] font-mono text-[#555] tracking-[0.15em] block mb-4">
          {{ formatDate(archivesStore.currentArchive.createdAt) }}
        </time>
        <h1 class="text-2xl md:text-3xl font-thin tracking-tighter uppercase m-0 text-[#E0E0E0]">
          {{ archivesStore.currentArchive.title }}
        </h1>
        <hr class="border-none h-px bg-[rgba(255,255,255,0.1)] mt-4 mb-4" />
        <p
          v-if="archivesStore.currentArchive.description"
          class="font-mono text-xs text-[#555] tracking-[0.1em] m-0"
        >
          {{ archivesStore.currentArchive.description }}
        </p>
      </header>

      <!-- Rendered markdown content -->
      <div class="archive-content" v-html="renderedContent" />

      <!-- Footer -->
      <footer class="mt-20 pt-6">
        <span class="text-[10px] font-mono text-[#555] tracking-[0.15em]">
          last updated {{ formatDate(archivesStore.currentArchive.updatedAt) }}
        </span>

        <!-- Offline indicator + save/remove (desktop only + authorized) -->
        <div v-if="offlineSurfaceVisible" class="mt-6 flex items-center gap-4">
          <span
            v-if="archivesStore.currentFromOffline"
            class="text-[10px] font-mono tracking-[0.2em] uppercase text-[#ff0000]"
          >
            [ OFFLINE COPY — no connection ]
          </span>
          <button
            v-else-if="!isOfflineAvailableNow"
            type="button"
            class="text-[10px] font-mono tracking-[0.2em] uppercase text-[#555] hover:text-[#ff0000] transition-colors bg-transparent border-none cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            :disabled="archivesStore.saving"
            @click="saveOffline"
          >
            {{ archivesStore.saving ? 'encrypting...' : '↓ save for offline reading' }}
          </button>
          <button
            v-else
            type="button"
            class="text-[10px] font-mono tracking-[0.2em] uppercase text-[#ff3333] hover:text-[#ff0000] transition-colors bg-transparent border-none cursor-pointer"
            @click="discardOffline"
          >
            ✕ remove offline copy from this device
          </button>
        </div>
        <span
          v-else-if="!isDesktopVault"
          class="block mt-6 text-[10px] font-mono text-[#333] tracking-[0.15em]"
        >
          offline reading is desktop-only.
        </span>
      </footer>
    </article>
  </q-page>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useQuasar } from 'quasar';
import { useArchivesStore } from 'src/stores/archives';
import { isOfflineVaultEnabled } from 'src/crypto/offlineVault';
import { renderArchiveMarkdown } from 'src/utils/archiveMarkdown';
import { resolveOfflineAuthorizedSafely } from 'src/utils/offlineAuthorization';

const route = useRoute();
const $q = useQuasar();
const archivesStore = useArchivesStore();
const scrollProgress = ref(0);
const forbidden = ref(false);
const notFound = ref(false);
const errorMsg = ref('');
const isOfflineAvailableNow = ref(false);

/** Offline vault is only offered on the desktop (Tauri) runtime — zero web surface. */
const isDesktopVault = computed(() => isOfflineVaultEnabled());

/**
 * Authorized offline mode (krul 2026-08): desktop + authenticated on this
 * device + "stay logged in". Without it the save/remove-offline controls and
 * the offline badge disappear (the app just shows offline + retry).
 */
const offlineAuthorized = ref(false);
function resolveOfflineAuthorized() {
  // L18: keychain/probe failures are a denial, never an unhandled rejection.
  return resolveOfflineAuthorizedSafely(async () => {
    const m = await import('src/crypto/offlineVault');
    return m.isOfflineModeAuthorized();
  }, (authorized) => {
    offlineAuthorized.value = authorized;
  });
}
/** All offline archive controls gate here. */
const offlineSurfaceVisible = computed(() => isDesktopVault.value && offlineAuthorized.value);

/**
 * Archive bodies are editorial markdown rendered with v-html. All parsing,
 * link-scheme filtering and sanitising lives in src/utils/archiveMarkdown.ts
 * (tested in tests/archiveMarkdown.test.ts); never assemble HTML here.
 */
const renderedContent = computed(() => {
  if (!archivesStore.currentArchive?.content) return '';
  return renderArchiveMarkdown(archivesStore.currentArchive.content);
});

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function handleScroll() {
  const el = document.documentElement;
  const scrollTop = el.scrollTop || document.body.scrollTop;
  const scrollHeight = el.scrollHeight - el.clientHeight;
  scrollProgress.value = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
}

async function loadArchive() {
  const slug = route.params.slug as string;
  if (!slug) return;

  forbidden.value = false;
  notFound.value = false;
  errorMsg.value = '';

  // Mark whether a cached offline copy exists, so the footer can offer
  // "remove offline copy" instead of "save for offline".
  isOfflineAvailableNow.value =
    isOfflineVaultEnabled() && (await archivesStore.isOfflineAvailable(slug));

  const result = await archivesStore.fetchArchive(slug);
  if (!result.success) {
    if ((result as { forbidden?: boolean }).forbidden) {
      forbidden.value = true;
      errorMsg.value = result.error || 'Unauthorized: Your presence is not recorded here.';
    } else {
      notFound.value = true;
    }
  }
}

async function saveOffline() {
  const slug = route.params.slug as string;
  if (!slug) return;
  const result = await archivesStore.saveArchiveOffline(slug);
  if (result.success) {
    isOfflineAvailableNow.value = true;
    $q.notify({
      type: 'positive',
      message: 'saved. readable offline via the encrypted vault.',
      position: 'bottom',
      timeout: 2500,
    });
  } else if (!(result as { disabled?: boolean }).disabled) {
    $q.notify({
      type: 'negative',
      message: result.error || 'failed to save offline copy.',
      position: 'bottom',
      timeout: 4000,
    });
  }
}

async function discardOffline() {
  const slug = route.params.slug as string;
  if (!slug) return;
  const result = await archivesStore.discardArchiveOffline(slug);
  if (result.success) {
    isOfflineAvailableNow.value = false;
    $q.notify({
      type: 'info',
      message: 'offline copy erased from this device.',
      position: 'bottom',
      timeout: 2500,
    });
  } else if (!(result as { disabled?: boolean }).disabled) {
    $q.notify({
      type: 'negative',
      message: result.error || 'failed to remove offline copy.',
      position: 'bottom',
      timeout: 4000,
    });
  }
}

onMounted(() => {
  void loadArchive();
  void resolveOfflineAuthorized();
  window.addEventListener('scroll', handleScroll, { passive: true });
});

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll);
  archivesStore.currentArchive = null;
});

watch(
  () => route.params.slug,
  () => {
    void loadArchive();
  },
);
</script>

<style>
/* Back arrow — fixed left edge on desktop, inline on mobile */
.arc-back-arrow {
  position: fixed;
  top: 50%;
  left: 24px;
  transform: translateY(-50%);
  z-index: 50;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: rgb(var(--m-accent-rgb));
  text-decoration: none;
  transition: opacity 0.2s;
}

.arc-back-arrow:hover {
  opacity: 0.7;
}

.arc-back-text {
  display: none;
}

@media (max-width: 767px) {
  .arc-back-arrow {
    position: relative;
    top: auto;
    left: auto;
    transform: none;
    margin: 16px 0 0 24px;
  }

  .arc-back-text {
    display: inline;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 10px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }
}

/* Archive markdown content — monospace-first, terminal aesthetic */
.archive-content {
  font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.85;
  color: #999;
}

.archive-content .archive-h {
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: rgb(var(--m-arcText-rgb));
  letter-spacing: 0.15em;
  text-transform: uppercase;
  font-weight: 200;
  margin: 2.5em 0 1em;
}

.archive-content h1.archive-h {
  font-size: 1.3em;
}
.archive-content h2.archive-h {
  font-size: 1.15em;
}
.archive-content h3.archive-h {
  font-size: 1em;
}
.archive-content h4.archive-h,
.archive-content h5.archive-h,
.archive-content h6.archive-h {
  font-size: 0.9em;
  color: #999;
}

.archive-content .archive-p {
  margin: 1.5em 0;
}

.archive-content .archive-blockquote {
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  margin: 2em 0;
  padding: 0.8em 1.2em;
  background: transparent;
  color: rgb(var(--m-arcMuted-rgb));
  font-style: italic;
  font-size: 13px;
  letter-spacing: 0.03em;
  line-height: 1.7;
}

.archive-content .archive-codeblock {
  background: rgb(var(--m-elevated-rgb));
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0;
  padding: 1.25em 1.5em;
  margin: 2em 0;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.6;
  color: #00ff41;
  font-family: 'SF Mono', 'Fira Code', monospace;
  position: relative;
}

.archive-content .archive-codeblock::before {
  content: '>';
  position: absolute;
  top: 8px;
  right: 12px;
  font-size: 10px;
  color: rgba(0, 255, 65, 0.25);
}

.archive-content .archive-inline-code {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0;
  padding: 0.1em 0.4em;
  font-size: 0.9em;
  color: #bbb;
}

.archive-content .archive-hr {
  border: none;
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 3em 0;
}

.archive-content .archive-link {
  color: #999;
  text-decoration: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  transition:
    color 0.2s ease,
    border-color 0.2s ease;
}

.archive-content .archive-link:hover {
  color: rgb(var(--m-accent-rgb));
  border-color: rgb(var(--m-accent-rgb));
}

.archive-content .archive-img {
  max-width: 100%;
  height: auto;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0;
  margin: 2em 0;
  display: block;
}

.archive-content ol.archive-ol {
  list-style: decimal;
  padding-left: 1.75em;
  margin: 1.5em 0;
}

.archive-content ol.archive-ol .archive-li {
  padding-left: 0;
}

.archive-content ol.archive-ol .archive-li::before {
  content: none;
}

.archive-content .archive-ul {
  list-style: none;
  padding-left: 0;
  margin: 1.5em 0;
}

.archive-content .archive-li {
  position: relative;
  padding-left: 1.5em;
  margin: 0.5em 0;
}

.archive-content .archive-li::before {
  content: '—';
  position: absolute;
  left: 0;
  color: rgba(255, 255, 255, 0.15);
}
</style>
