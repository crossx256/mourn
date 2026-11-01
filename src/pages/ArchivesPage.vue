<template>
  <q-page class="archives-index">
    <Transition name="archive-loader">
      <div v-if="showArchiveLoader" class="archive-loading" role="status" aria-label="Loading archives">
        <div class="archive-loading__scanlines" aria-hidden="true" />
        <div v-if="archiveEffectsEnabled" class="archive-loading__chromatic archive-loading__chromatic--red" aria-hidden="true" />
        <div v-if="archiveEffectsEnabled" class="archive-loading__chromatic archive-loading__chromatic--cyan" aria-hidden="true" />
        <div v-if="archiveGlitchFlash" class="archive-loading__glitch" aria-hidden="true" />
        <div v-if="archiveEffectsEnabled" class="archive-loading__noise archive-loading__noise--top" aria-hidden="true">
          <span v-for="(chunk, index) in archiveHexTop" :key="index" :style="{ opacity: 0.15 + (index % 4) * 0.07 }">{{ chunk }}</span>
        </div>
        <div class="archive-loading__content">
          <div class="archive-loading__signal">
            <span>[</span> ARCHIVE CHANNEL DETECTED <span>]</span>
          </div>
          <p class="archive-loading__message" aria-hidden="true">
            <span class="archive-loading__prompt">&gt;_</span>
            <span>{{ archiveLoaderText }}</span><span class="archive-loading__cursor">█</span>
          </p>
          <div class="archive-loading__progress">
            <div class="archive-loading__progress-head">
              <span>INDEXING CATALOG</span>
              <span>{{ archiveLoaderReady ? 'COMPLETE' : 'ACTIVE' }}</span>
            </div>
            <div class="archive-loading__track" aria-hidden="true">
              <span :class="{ 'is-ready': archiveLoaderReady }" />
            </div>
          </div>
          <div class="archive-loading__status" aria-hidden="true">
            <div
              v-for="(status, index) in archiveLoaderStatuses"
              :key="status"
              :class="{
                'is-done': archiveLoaderReady || index < archiveLoaderStage,
                'is-active': !archiveLoaderReady && index === archiveLoaderStage,
              }"
            >
              <span>{{ archiveLoaderReady || index <= archiveLoaderStage ? '█' : '░' }}</span>
              {{ status }}
            </div>
          </div>
        </div>
        <div v-if="archiveEffectsEnabled" class="archive-loading__noise archive-loading__noise--bottom" aria-hidden="true">
          <span v-for="(chunk, index) in archiveHexBottom" :key="index" :style="{ opacity: 0.1 + (index % 4) * 0.07 }">{{ chunk }}</span>
        </div>
        <div class="archive-loading__tip" aria-hidden="true">
          NOTHING DELETED // NOTHING FORGOTTEN // EVERYTHING LEAVES A TRACE
        </div>
      </div>
    </Transition>

    <nav class="archive-nav" aria-label="Archive navigation">
      <router-link to="/" class="archive-nav__back" aria-label="Back to home">
        <q-icon name="mdi-arrow-left" size="18px" />
        <span>mourn.bio</span>
      </router-link>
    </nav>

    <main class="archive-shell">
      <header class="archive-masthead">
        <div class="archive-masthead__copy">
          <h1>Archives</h1>
          <p>Essays, guides, and research published by Mourn.</p>
        </div>

        <div class="archive-masthead__meta">
          <div class="archive-record-count">
            <strong>{{ archiveCount }}</strong>
            <span>{{ archiveCount === 1 ? 'record indexed' : 'records indexed' }}</span>
          </div>
          <button
            v-if="offlineSurfaceVisible"
            type="button"
            class="archive-manage"
            @click="showDownloads = true"
          >
            <q-icon name="mdi-download" size="16px" />
            manage downloads
          </button>
        </div>
      </header>

      <section v-if="featuredArchive" class="archive-feature" aria-labelledby="featured-heading">
        <button
          type="button"
          class="archive-feature__cover archive-cover"
          :class="{ 'is-encrypted': featuredArchive.encrypted }"
          :style="archiveCoverStyle(featuredArchive, 0)"
          :disabled="featuredArchive.encrypted"
          :aria-label="featuredArchive.encrypted ? 'Featured archive is restricted' : `Read ${featuredArchive.title}`"
          @click="openArchive(featuredArchive)"
        >
          <span class="archive-cover__diagonals" aria-hidden="true" />
          <span class="archive-cover__brand">Mourn Archives</span>
          <span class="archive-cover__title">
            {{ featuredArchive.encrypted ? 'Restricted archive' : featuredArchive.title }}
          </span>
          <span class="archive-cover__footer">
            <span>{{ formatYear(featuredArchive.createdAt) }}</span>
            <span>{{ featuredArchive.isPublic ? 'Public' : 'Restricted' }}</span>
          </span>
        </button>

        <div class="archive-feature__content">
          <p class="archive-feature__date">{{ formatDate(featuredArchive.createdAt) }}</p>
          <h2 id="featured-heading">
            {{ featuredArchive.encrypted ? 'Restricted archive' : featuredArchive.title }}
          </h2>
          <p class="archive-feature__description">
            {{ archiveDescription(featuredArchive) }}
          </p>
          <div class="archive-feature__meta">
            <span>{{ featuredArchive.isPublic ? 'Public' : 'Restricted' }}</span>
            <span v-if="isOfflineSlug(featuredArchive.slug)">Available offline</span>
          </div>
          <button
            type="button"
            class="archive-open"
            :disabled="featuredArchive.encrypted"
            @click="openArchive(featuredArchive)"
          >
            <span>{{ featuredArchive.encrypted ? 'Access required' : 'Read archive' }}</span>
            <q-icon :name="featuredArchive.encrypted ? 'mdi-lock-outline' : 'mdi-arrow-right'" size="17px" />
          </button>
        </div>
      </section>

      <section class="archive-catalog" aria-labelledby="catalog-heading">
        <h2 id="catalog-heading">All archives</h2>

        <div class="archive-controls">
          <label class="archive-search">
            <q-icon name="mdi-magnify" size="19px" />
            <input
              v-model.trim="searchQuery"
              type="search"
              autocomplete="off"
              spellcheck="false"
              placeholder="Search archives"
              aria-label="Search archives"
            />
            <button
              v-if="searchQuery"
              type="button"
              aria-label="Clear archive search"
              @click="searchQuery = ''"
            >
              clear
            </button>
          </label>

          <div class="archive-filters" role="group" aria-label="Filter archives">
            <button
              v-for="filter in availableFilters"
              :key="filter.value"
              type="button"
              :class="{ 'is-active': activeFilter === filter.value }"
              @click="activeFilter = filter.value"
            >
              {{ filter.label }}
            </button>
          </div>
        </div>

        <div v-if="visibleArchives.length" class="archive-grid">
          <button
            v-for="(archive, index) in visibleArchives"
            :key="archive.id"
            type="button"
            class="archive-card"
            :class="{ 'is-encrypted': archive.encrypted }"
            :disabled="archive.encrypted"
            :aria-label="archive.encrypted ? `${archive.title} is restricted` : `Read ${archive.title}`"
            @click="openArchive(archive)"
          >
            <div class="archive-card__poster archive-cover" :style="archiveCoverStyle(archive, index + 1)">
              <span class="archive-cover__diagonals" aria-hidden="true" />
              <span class="archive-cover__brand">Mourn Archives</span>
              <span class="archive-cover__title">
                {{ archive.encrypted ? 'Restricted archive' : archive.title }}
              </span>
              <span v-if="archive.encrypted" class="archive-card__lock">
                <q-icon name="mdi-lock-outline" size="21px" />
              </span>
              <span class="archive-cover__footer">
                <span>{{ formatYear(archive.createdAt) }}</span>
                <span>{{ archive.isPublic && !archive.encrypted ? 'Public' : 'Restricted' }}</span>
              </span>
              <span v-if="isOfflineSlug(archive.slug)" class="archive-card__offline">
                <q-icon name="mdi-download" size="12px" /> offline
              </span>
            </div>

            <div class="archive-card__body">
              <div class="archive-card__meta">
                <time :datetime="archive.createdAt">{{ formatDate(archive.createdAt) }}</time>
                <span>{{ archive.isPublic && !archive.encrypted ? 'Public' : 'Restricted' }}</span>
              </div>
              <h3>{{ archive.encrypted ? 'Restricted archive' : archive.title }}</h3>
              <p>{{ archiveDescription(archive) }}</p>
              <div class="archive-card__action">
                <span>{{ archive.encrypted ? 'Access required' : 'Read archive' }}</span>
                <q-icon :name="archive.encrypted ? 'mdi-lock-outline' : 'mdi-arrow-top-right'" size="15px" />
              </div>
            </div>
          </button>
        </div>

        <div v-else class="archive-empty">
          <h3>No archives found</h3>
          <p>
            {{
              offlineList && !searchQuery
                ? 'No archives are saved on this device.'
                : 'Try a different search or filter.'
            }}
          </p>
          <button
            v-if="searchQuery || activeFilter !== 'all'"
            type="button"
            @click="resetFilters"
          >
            clear filters
          </button>
        </div>

        <div v-if="!offlineList && totalPages > 1" class="archive-pagination">
          <button
            type="button"
            :disabled="archivesStore.page <= 1 || showArchiveLoader"
            @click="goPage(archivesStore.page - 1)"
          >
            <q-icon name="mdi-arrow-left" size="15px" /> previous
          </button>
          <span>{{ archivesStore.page }} of {{ totalPages }}</span>
          <button
            type="button"
            :disabled="archivesStore.page >= totalPages || showArchiveLoader"
            @click="goPage(archivesStore.page + 1)"
          >
            next <q-icon name="mdi-arrow-right" size="15px" />
          </button>
        </div>
      </section>
    </main>

    <ManageDownloadsDialog v-model="showDownloads" />
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useArchivesStore } from 'src/stores/archives';
import { useDevicePreferencesStore } from 'src/stores/devicePreferences';
import { isOfflineVaultEnabled } from 'src/crypto/offlineVault';
import type { ArchiveListItem } from 'src/types/archives';
import ManageDownloadsDialog from 'src/components/archives/ManageDownloadsDialog.vue';
import { resolveOfflineAuthorizedSafely } from 'src/utils/offlineAuthorization';

const archivesStore = useArchivesStore();
const devicePreferencesStore = useDevicePreferencesStore();
const router = useRouter();
const showDownloads = ref(false);
const showArchiveLoader = ref(true);
const archiveLoaderReady = ref(false);
const archiveLoaderText = ref('');
const archiveLoaderStage = ref(0);
const archiveEffectsEnabled = ref(false);
const archiveGlitchFlash = ref(false);
const archiveHexTop = ref<string[]>([]);
const archiveHexBottom = ref<string[]>([]);
const archiveLoaderStatuses = [
  'ESTABLISHING CONNECTION',
  'INDEXING DISCLOSURES',
  'VERIFYING ACCESS KEYS',
  'CATALOG READY',
] as const;
const offlineList = ref(false);
const offlineAuthorized = ref(false);
const searchQuery = ref('');
const activeFilter = ref<'all' | 'public' | 'restricted' | 'offline'>('all');

const isDesktopVault = computed(() => isOfflineVaultEnabled());
const offlineSurfaceVisible = computed(() => isDesktopVault.value && offlineAuthorized.value);
const totalPages = computed(() =>
  Math.max(1, Math.ceil(archivesStore.total / archivesStore.limit)),
);
const archiveCount = computed(() =>
  offlineList.value
    ? archivesStore.archives.length
    : archivesStore.total || archivesStore.archives.length,
);
const featuredArchive = computed(
  () =>
    archivesStore.archives.find((archive) => !archive.encrypted) ??
    archivesStore.archives[0] ??
    null,
);

const availableFilters = computed(() => {
  const filters: Array<{
    value: 'all' | 'public' | 'restricted' | 'offline';
    label: string;
  }> = [
    { value: 'all', label: 'all' },
    { value: 'public', label: 'public' },
    { value: 'restricted', label: 'restricted' },
  ];
  if (offlineSurfaceVisible.value) filters.push({ value: 'offline', label: 'downloaded' });
  return filters;
});

const ARCHIVE_SUMMARIES: Readonly<Record<string, string>> = {
  'not-a-playground':
    'An examination of industrial damage to wildlife, habitat loss, factory farming, and traditions that normalize animal suffering.',
  'covid-19-a-ruined-generation':
    'How pandemic isolation, remote learning, and screen dependence reshaped adolescent attention, education, and social development.',
  'a-perfect-slave':
    'An essay on work, obedience, productivity, and the habits that make exploitation appear normal.',
  'scam-of-the-century':
    'A critique of hustle culture, online wealth courses, and the claim that economic precarity can be solved through individual grind.',
  capitalism:
    'An argument against profit-driven systems, tracing their effects on labor, inequality, public life, and the environment.',
  'fight-club':
    'A reading of Fight Club as a critique of consumer identity, alienated labor, masculinity, and false rebellion.',
  'weather-modification':
    'A sourced overview of cloud seeding and atmospheric intervention, separating documented techniques from unsupported claims.',
  'people-you-should-know':
    'Short profiles of anti-imperialists, revolutionaries, organizers, and whistleblowers, with prompts for further reading.',
  'opsec-how-to-stay-safe-on-the-internet':
    'A practical introduction to online privacy: account separation, metadata, phishing, passwords, device security, and safer habits.',
  'nestl-crimes-against-humanity':
    'A documented review of Nestlé’s record on infant-formula marketing, child labor, water extraction, and product safety.',
  'how-to-fix-your-attention-span':
    'A practical guide to rebuilding concentration by reducing short-form stimulation, managing devices, and practicing sustained focus.',
  consumerism:
    'How advertising, credit, planned obsolescence, and status consumption shape spending and personal identity.',
  'dead-internet':
    'An overview of bot traffic, synthetic content, algorithmic amplification, and the decline of human participation online.',
  'memetic-warfare':
    'How memes and irony can carry propaganda, normalize extremist ideas, and turn public scandals into disposable entertainment.',
  'psyops-and-propaganda':
    'A guide to emotional priming, artificial consensus, repeated narratives, and other techniques used to influence public judgment.',
  'algorithm-of-decay':
    'How engagement-driven social platforms affect attention, creativity, mental health, and passive consumption.',
  'bread-and-circuses':
    'From Roman spectacle to social media outrage: an essay on entertainment as a distraction from political and economic power.',
  osint:
    'An introduction to lawful open-source intelligence, source verification, public records, metadata, and ethical boundaries.',
};

const visibleArchives = computed(() => {
  const query = searchQuery.value.toLocaleLowerCase();
  return archivesStore.archives.filter((archive) => {
    const matchesFilter =
      activeFilter.value === 'all' ||
      (activeFilter.value === 'public' && archive.isPublic && !archive.encrypted) ||
      (activeFilter.value === 'restricted' && (!archive.isPublic || Boolean(archive.encrypted))) ||
      (activeFilter.value === 'offline' && isOfflineSlug(archive.slug));
    if (!matchesFilter) return false;
    if (!query) return true;

    return [archive.title, archiveDescription(archive), archive.slug]
      .join(' ')
      .toLocaleLowerCase()
      .includes(query);
  });
});

const COVER_PALETTES = [
  { accent: '#d82323', background: '#190808' },
  { accent: '#bb4a35', background: '#1b0e0b' },
  { accent: '#a82845', background: '#18090e' },
  { accent: '#c7c3bd', background: '#141414' },
  { accent: '#d35b2d', background: '#1c100b' },
  { accent: '#8d2931', background: '#14090a' },
] as const;

function archiveHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function archiveCoverStyle(archive: ArchiveListItem, index: number): Record<string, string> {
  const seed = archiveHash(`${archive.slug}:${index}`);
  const palette = COVER_PALETTES[seed % COVER_PALETTES.length] ?? COVER_PALETTES[0];
  return {
    '--cover-accent': palette.accent,
    '--cover-background': palette.background,
  };
}

function decodeDescription(value: string): string {
  return value
    .replace(/&#x27;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function archiveDescription(archive: ArchiveListItem): string {
  if (archive.encrypted) return 'This archive is restricted.';
  const curated = ARCHIVE_SUMMARIES[archive.slug];
  if (curated) return curated;
  if (archive.description?.trim()) return decodeDescription(archive.description.trim());
  return 'No summary is available for this archive.';
}

function isOfflineSlug(slug: string): boolean {
  return archivesStore.offlineSlugs.includes(slug);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

function formatYear(dateStr: string): string {
  return String(new Date(dateStr).getFullYear());
}

function openArchive(archive: ArchiveListItem) {
  if (archive.encrypted) return;
  void router.push(`/archives/${archive.slug}`);
}

function resetFilters() {
  searchQuery.value = '';
  activeFilter.value = 'all';
}

function resolveOfflineAuthorized(): Promise<boolean> {
  // L18: a probe rejection used to abort onMounted before the archive list
  // loaded. A failed probe is "not authorized"; the list still loads.
  return resolveOfflineAuthorizedSafely(async () => {
    const module = await import('src/crypto/offlineVault');
    return module.isOfflineModeAuthorized();
  }, (authorized) => {
    offlineAuthorized.value = authorized;
  });
}

const archiveLoaderLines = [
  'retrieving records from the dead index.',
  'indexing disclosures against erasure.',
  'verifying access to the archive.',
  'nothing deleted. nothing forgotten.',
] as const;
let archiveTypeTimer: ReturnType<typeof setTimeout> | null = null;
let archiveHexTimer: ReturnType<typeof setInterval> | null = null;
let archiveGlitchTimer: ReturnType<typeof setInterval> | null = null;
let archiveGlitchTimeout: ReturnType<typeof setTimeout> | null = null;
let archiveLoadGeneration = 0;

function stopArchiveAnimations() {
  if (archiveTypeTimer) clearTimeout(archiveTypeTimer);
  if (archiveHexTimer) clearInterval(archiveHexTimer);
  if (archiveGlitchTimer) clearInterval(archiveGlitchTimer);
  if (archiveGlitchTimeout) clearTimeout(archiveGlitchTimeout);
  archiveTypeTimer = null;
  archiveHexTimer = null;
  archiveGlitchTimer = null;
  archiveGlitchTimeout = null;
  archiveGlitchFlash.value = false;
}

function startArchiveTypewriter() {
  archiveLoaderText.value = '';
  archiveLoaderStage.value = 0;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    archiveLoaderText.value = archiveLoaderLines[0] ?? '';
    return;
  }
  let lineIndex = 0;
  let charIndex = 0;
  function typeNext() {
    if (!showArchiveLoader.value) return;
    const line = archiveLoaderLines[lineIndex] ?? '';
    if (charIndex <= line.length) {
      archiveLoaderText.value = line.slice(0, charIndex);
      if (lineIndex === 0 && charIndex >= 13) archiveLoaderStage.value = 1;
      if (lineIndex === 0 && charIndex >= 27) archiveLoaderStage.value = 2;
      charIndex += 1;
      archiveTypeTimer = setTimeout(typeNext, 55);
    } else {
      archiveTypeTimer = setTimeout(() => {
        lineIndex = (lineIndex + 1) % archiveLoaderLines.length;
        charIndex = 0;
        typeNext();
      }, 1200);
    }
  }
  typeNext();
}

function refreshArchiveHex() {
  const chars = '0123456789ABCDEF';
  const generate = () => Array.from({ length: 40 }, () => {
    const size = Math.random() > 0.7 ? 4 : 2;
    return Array.from({ length: size }, () => chars[Math.floor(Math.random() * 16)]).join('');
  });
  archiveHexTop.value = generate();
  archiveHexBottom.value = generate();
}

function startArchiveEffects() {
  archiveEffectsEnabled.value = !devicePreferencesStore.performanceMode &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!archiveEffectsEnabled.value) return;
  refreshArchiveHex();
  archiveHexTimer = setInterval(refreshArchiveHex, 600);
  archiveGlitchTimer = setInterval(() => {
    if (Math.random() <= 0.6) return;
    archiveGlitchFlash.value = true;
    if (archiveGlitchTimeout) clearTimeout(archiveGlitchTimeout);
    archiveGlitchTimeout = setTimeout(() => { archiveGlitchFlash.value = false; }, 120);
  }, 1500);
}

function handleArchiveVisibility() {
  if (!showArchiveLoader.value) return;
  stopArchiveAnimations();
  if (document.hidden) {
    archiveEffectsEnabled.value = false;
    return;
  }
  startArchiveTypewriter();
  startArchiveEffects();
}

async function withLoadingScreen(task: () => Promise<void>, minimumMs = 700) {
  const generation = ++archiveLoadGeneration;
  showArchiveLoader.value = true;
  archiveLoaderReady.value = false;
  stopArchiveAnimations();
  if (!document.hidden) {
    startArchiveTypewriter();
    startArchiveEffects();
  }
  const startedAt = Date.now();
  try {
    await task();
  } finally {
    if (generation === archiveLoadGeneration) {
      const remaining = minimumMs - (Date.now() - startedAt);
      if (remaining > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, remaining));
      if (generation === archiveLoadGeneration) {
        archiveLoaderReady.value = true;
        await new Promise<void>((resolve) => window.setTimeout(resolve, 240));
        if (generation === archiveLoadGeneration) {
          showArchiveLoader.value = false;
          stopArchiveAnimations();
        }
      }
    }
  }
}

async function load() {
  await archivesStore.syncOfflineSlugs();
  const result = await archivesStore.fetchArchives(1);
  if (!result.success && offlineSurfaceVisible.value) {
    archivesStore.archives = await archivesStore.loadOfflineArchiveList();
    offlineList.value = true;
    return;
  }
  offlineList.value = false;
}

function goPage(page: number) {
  void withLoadingScreen(async () => {
    await archivesStore.fetchArchives(page);
    resetFilters();
    document.querySelector<HTMLElement>('.archives-index')?.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }, 450);
}

function handleOnline() {
  offlineList.value = false;
  void withLoadingScreen(load, 500);
}

function handleOffline() {
  void (async () => {
    const authorized = offlineAuthorized.value || (await resolveOfflineAuthorized());
    if (!authorized || !isDesktopVault.value) return;
    await withLoadingScreen(async () => {
      archivesStore.archives = await archivesStore.loadOfflineArchiveList();
      offlineList.value = true;
      resetFilters();
    }, 500);
  })();
}

onMounted(async () => {
  document.addEventListener('visibilitychange', handleArchiveVisibility);
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  await withLoadingScreen(async () => {
    await resolveOfflineAuthorized();
    await load();
  }, 1800);
});

onUnmounted(() => {
  archiveLoadGeneration += 1;
  stopArchiveAnimations();
  document.removeEventListener('visibilitychange', handleArchiveVisibility);
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('offline', handleOffline);
});
</script>

<style scoped lang="scss">
.archives-index {
  --archive-red: #e32626;
  --archive-text: #ece9e4;
  --archive-muted: #9c9791;
  position: relative;
  min-height: 100%;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  color: var(--archive-text);
  background: #060606;
  font-family: inherit;
}

.archive-masthead h1,
.archive-feature h2,
.archive-catalog > h2,
.archive-cover__title,
.archive-card h3,
.archive-empty h3 {
  font-family: Arial, Helvetica, sans-serif;
}

.archive-feature h2,
.archive-cover__title,
.archive-card h3 {
  font-size: 14px;
}

.archives-index::selection,
.archives-index :deep(::selection) {
  color: #fff;
  background: rgb(var(--archive-ink-rgb, 227 38 38) / 0.7);
}

.archive-nav,
.archive-shell {
  width: min(1240px, calc(100% - 40px));
  margin: 0 auto;
}

.archive-nav {
  display: flex;
  min-height: 64px;
  align-items: center;
  border-bottom: 1px solid #222;
}

.archive-nav__back {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--archive-muted);
  font-family: 'Courier New', Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-decoration: none;
  text-transform: uppercase;
  transition: color 160ms ease;
}

.archive-nav__back:hover,
.archive-nav__back:focus-visible {
  color: var(--archive-red);
}

.archive-shell {
  padding: 76px 0 48px;
}

.archive-masthead {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 48px;
  margin-bottom: 64px;
}

.archive-masthead h1 {
  margin: 0;
  color: #f4f1ec;
  font-size: clamp(3.5rem, 8vw, 6rem);
  font-weight: 800;
  line-height: 0.9;
  letter-spacing: -0.04em;
}

.archive-masthead__copy p {
  max-width: 62ch;
  margin: 24px 0 0;
  color: var(--archive-muted);
  font-size: 14px;
  line-height: 1.6;
}

.archive-masthead__meta {
  display: flex;
  min-width: 270px;
  flex-direction: column;
  gap: 12px;
}

.archive-record-count {
  display: flex;
  min-height: 82px;
  align-items: center;
  gap: 16px;
  padding: 14px 18px;
  border: 1px solid #292929;
  background: rgb(var(--m-elevated-rgb));
}

.archive-record-count strong {
  color: #f3f0eb;
  font-size: 30px;
  font-weight: 500;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.archive-record-count span {
  color: var(--archive-muted);
  font-family: 'Courier New', Consolas, monospace;
  font-size: 9px;
  line-height: 1.4;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.archive-manage {
  display: inline-flex;
  align-self: flex-end;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border: 0;
  color: var(--archive-muted);
  background: transparent;
  font: 9px/1.4 'Courier New', Consolas, monospace;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
}

.archive-manage:hover,
.archive-manage:focus-visible {
  color: var(--archive-red);
}

.archive-feature {
  display: grid;
  grid-template-columns: minmax(250px, 0.72fr) minmax(0, 1.6fr);
  min-height: 470px;
  margin-bottom: 88px;
  border: 1px solid #292929;
  background: #090909;
}

.archive-feature__cover {
  min-height: 470px;
  border: 0;
  border-right: 1px solid #292929;
  cursor: pointer;
}

.archive-feature__content {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  padding: clamp(32px, 5vw, 72px);
}

.archive-feature__date,
.archive-card__meta,
.archive-feature__meta,
.archive-card__action,
.archive-cover__brand,
.archive-cover__footer {
  font-family: 'Courier New', Consolas, monospace;
  font-variant-numeric: tabular-nums;
}

.archive-feature__description,
.archive-card__body p {
  font-family: Georgia, 'Times New Roman', serif;
}

.archive-feature__date {
  margin: 0 0 14px;
  color: var(--archive-muted);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.archive-feature h2 {
  max-width: 720px;
  margin: 0;
  color: #f3f0eb;
  font-weight: 750;
  line-height: 1.25;
  letter-spacing: -0.035em;
  text-transform: uppercase;
}

.archive-feature__description {
  max-width: 68ch;
  margin: 28px 0 0;
  color: #b4afa9;
  font-size: 14px;
  line-height: 1.7;
}

.archive-feature__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin-top: 24px;
  color: var(--archive-muted);
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.archive-open {
  display: inline-flex;
  width: max-content;
  align-items: center;
  gap: 28px;
  margin-top: 34px;
  padding: 12px 15px;
  border: 1px solid var(--archive-red);
  color: #fff;
  background: var(--archive-red);
  font: 9px/1.4 'Courier New', Consolas, monospace;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 160ms ease, background 160ms ease;
}

.archive-open:hover:not(:disabled),
.archive-open:focus-visible:not(:disabled) {
  color: var(--archive-red);
  background: transparent;
}

.archive-open:disabled {
  border-color: #3b3434;
  color: #8f8585;
  background: #161111;
  cursor: not-allowed;
}

.archive-cover {
  --cover-accent: #d82323;
  --cover-background: #190808;
  position: relative;
  display: flex;
  overflow: hidden;
  flex-direction: column;
  justify-content: space-between;
  padding: 22px;
  color: #f3f0eb;
  font-family: inherit;
  background:
    linear-gradient(180deg, transparent 48%, rgba(0, 0, 0, 0.5) 49%, transparent 52%),
    linear-gradient(145deg, var(--cover-background), #090909 72%);
  text-align: left;
}

.archive-cover::before,
.archive-cover::after {
  content: '';
  position: absolute;
  pointer-events: none;
}

.archive-cover__diagonals {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: repeating-linear-gradient(
    115deg,
    transparent 0 17px,
    rgba(255, 255, 255, 0.04) 18px,
    transparent 19px
  );
  -webkit-mask-image: linear-gradient(to bottom, #000 8%, rgba(0, 0, 0, 0.8) 30%, transparent 60%);
  mask-image: linear-gradient(to bottom, #000 8%, rgba(0, 0, 0, 0.8) 30%, transparent 60%);
}

.archive-cover::before {
  top: 14%;
  right: -22%;
  width: 90%;
  aspect-ratio: 1;
  border: 1px solid var(--cover-accent);
  border-radius: 50%;
  outline: 1px solid rgba(255, 255, 255, 0.09);
  outline-offset: 22px;
  opacity: 0.34;
}

.archive-cover::after {
  inset: 0;
  z-index: 1;
  opacity: 0.48;
  background:
    linear-gradient(transparent 28%, rgba(255, 255, 255, 0.055) 28.2%, transparent 28.6%),
    linear-gradient(transparent 72%, rgba(0, 0, 0, 0.28) 72.2%, transparent 74%),
    repeating-linear-gradient(
      0deg,
      transparent 0 3px,
      rgba(0, 0, 0, 0.24) 3px 4px
    );
}

.archive-feature__cover:hover::after,
.archive-feature__cover:focus-visible::after,
.archive-card:hover .archive-cover::after,
.archive-card:focus-visible .archive-cover::after {
  animation: archiveSignalFlicker 6.5s steps(1) infinite;
}

.archive-feature__cover:hover::before,
.archive-feature__cover:focus-visible::before,
.archive-card:hover .archive-cover::before,
.archive-card:focus-visible .archive-cover::before {
  animation: archiveRingFlicker 6.5s steps(1) infinite;
}

@keyframes archiveRingFlicker {
  0%, 14%, 19%, 25%, 59%, 65%, 72%, 100% { opacity: 0.34; }
  15%, 20%, 60%, 66% { opacity: 0.5; }
}

@keyframes archiveSignalFlicker {
  0%, 14%, 19%, 25%, 59%, 65%, 72%, 100% { opacity: 0.48; }
  15%, 20%, 60%, 66% { opacity: 0.64; }
}

.archive-cover__brand,
.archive-cover__title,
.archive-cover__footer,
.archive-card__offline,
.archive-card__lock {
  position: relative;
  z-index: 2;
}

.archive-cover__brand {
  color: rgba(255, 255, 255, 0.7);
  font-size: 8px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.archive-cover__title {
  max-width: 17ch;
  color: #fff;
  font-size: clamp(1.75rem, 3vw, 2.75rem);
  font-weight: 750;
  line-height: 1.08;
  overflow-wrap: anywhere;
  letter-spacing: -0.035em;
  text-transform: uppercase;
}

.archive-card__poster .archive-cover__title {
  font-size: clamp(1.25rem, 1.9vw, 1.85rem);
}

.archive-cover__footer {
  display: flex;
  justify-content: space-between;
  color: rgba(255, 255, 255, 0.72);
  font-size: 8px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.archive-card__lock {
  position: absolute;
  top: 50%;
  right: 20px;
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.35);
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  transform: translateY(-50%);
}

.archive-card__offline {
  position: absolute;
  right: 18px;
  bottom: 46px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 7px;
  color: #fff;
  background: #a81717;
  font: 8px/1 'Courier New', Consolas, monospace;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.archive-catalog > h2 {
  margin: 0;
  padding-bottom: 18px;
  border-bottom: 1px solid #292929;
  color: #efebe6;
  font-size: clamp(2rem, 4vw, 3.2rem);
  font-weight: 750;
  line-height: 1;
  letter-spacing: -0.035em;
  text-transform: uppercase;
}

.archive-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
  padding: 22px 0 32px;
}

.archive-search {
  display: flex;
  width: min(520px, 100%);
  align-items: center;
  gap: 11px;
  border-bottom: 1px solid #4a4642;
  color: var(--archive-muted);
  transition: border-color 160ms ease, color 160ms ease;
}

.archive-search:focus-within {
  border-color: var(--archive-red);
  color: var(--archive-red);
}

.archive-search input {
  min-width: 0;
  flex: 1;
  padding: 11px 0;
  border: 0;
  outline: 0;
  color: #e2dfda;
  background: transparent;
  font: 12px/1.4 Arial, Helvetica, sans-serif;
}

.archive-search input::placeholder {
  color: #817c76;
}

.archive-search input::-webkit-search-cancel-button {
  display: none;
}

.archive-search button,
.archive-filters button {
  border: 0;
  color: var(--archive-muted);
  background: transparent;
  font: 9px/1.4 'Courier New', Consolas, monospace;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
}

.archive-search button:hover,
.archive-search button:focus-visible,
.archive-filters button:hover,
.archive-filters button:focus-visible,
.archive-filters button.is-active {
  color: var(--archive-red);
}

.archive-filters {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}

.archive-filters button {
  padding: 8px 10px;
  border: 1px solid transparent;
}

.archive-filters button.is-active {
  border-color: #633;
}

.archive-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 36px 18px;
}

.archive-card {
  display: block;
  min-width: 0;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.archive-card__poster {
  aspect-ratio: 4 / 5;
  border: 1px solid #303030;
  transition: border-color 180ms ease, transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.archive-card:hover:not(:disabled) .archive-card__poster,
.archive-card:focus-visible:not(:disabled) .archive-card__poster {
  border-color: var(--cover-accent);
  transform: translateY(-5px);
}

.archive-card:focus-visible,
.archive-nav__back:focus-visible,
.archive-manage:focus-visible,
.archive-open:focus-visible,
.archive-search button:focus-visible,
.archive-filters button:focus-visible,
.archive-empty button:focus-visible,
.archive-pagination button:focus-visible {
  outline: 1px solid var(--archive-red);
  outline-offset: 4px;
}

.archive-card.is-encrypted {
  cursor: not-allowed;
}

.archive-card.is-encrypted .archive-card__poster {
  filter: grayscale(0.75) brightness(0.65);
}

.archive-card__body {
  padding: 16px 1px 0;
}

.archive-card__meta,
.archive-card__action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--archive-muted);
  font-size: 8px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.archive-card__meta span:last-child {
  color: var(--cover-accent);
}

.archive-card h3 {
  min-height: 2.45em;
  margin: 12px 0 8px;
  overflow: hidden;
  color: #e3dfda;
  font-weight: 700;
  line-height: 1.22;
  letter-spacing: -0.02em;
  text-transform: uppercase;
  transition: color 160ms ease;
}

.archive-card:hover:not(:disabled) h3 {
  color: var(--cover-accent);
}

.archive-card p {
  display: -webkit-box;
  min-height: 5.1em;
  margin: 0;
  overflow: hidden;
  color: #aba6a0;
  font-size: 11px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
}

.archive-card__action {
  margin-top: 16px;
  padding-top: 10px;
  border-top: 1px solid #242424;
}

.archive-empty {
  display: flex;
  min-height: 300px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  border-top: 1px solid #292929;
  border-bottom: 1px solid #292929;
  text-align: center;
}

.archive-empty h3 {
  margin: 0;
  color: #e1ddd8;
  font-size: 22px;
  text-transform: uppercase;
}

.archive-empty p {
  margin: 10px 0 0;
  color: var(--archive-muted);
  font-size: 12px;
}

.archive-empty button {
  margin-top: 22px;
  padding: 9px 12px;
  border: 1px solid #494541;
  color: #c2bdb7;
  background: transparent;
  font: 9px/1.4 'Courier New', Consolas, monospace;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
}

.archive-pagination {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 24px;
  margin-top: 64px;
  padding: 20px 0;
  border-top: 1px solid #292929;
  border-bottom: 1px solid #292929;
  font-family: 'Courier New', Consolas, monospace;
}

.archive-pagination button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 0;
  color: var(--archive-muted);
  background: transparent;
  font: 9px/1.4 inherit;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
}

.archive-pagination button:last-child {
  justify-self: end;
}

.archive-pagination button:hover:not(:disabled),
.archive-pagination button:focus-visible:not(:disabled) {
  color: var(--archive-red);
}

.archive-pagination button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.archive-pagination > span {
  color: var(--archive-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.archive-loading {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: #d6d2cd;
  background: #000;
  font-family: 'Courier New', Consolas, monospace;
}

.archive-loading__scanlines,
.archive-loading__chromatic {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.archive-loading__scanlines {
  z-index: 10;
  background: repeating-linear-gradient(
    0deg,
    transparent 0 2px,
    rgb(var(--m-bg-rgb, 0 0 0) / 0.15) 2px 4px
  );
  animation: archiveScanlineScroll 8s steps(4, end) infinite;
}

.archive-loading__chromatic {
  z-index: 15;
  mix-blend-mode: screen;
}

.archive-loading__chromatic--red {
  box-shadow: inset 2px 0 rgb(var(--archive-ink-rgb, 227 38 38) / 0.18);
  animation: archiveChromaticRed 4s ease-in-out infinite;
}

.archive-loading__chromatic--cyan {
  box-shadow: inset -2px 0 rgba(0, 210, 220, 0.12);
  animation: archiveChromaticCyan 4s ease-in-out infinite;
}

.archive-loading__glitch {
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  background: rgb(var(--archive-ink-rgb, 227 38 38) / 0.04);
  animation: archiveGlitch 120ms steps(2) forwards;
}

.archive-loading__noise {
  position: absolute;
  right: 0;
  left: 0;
  z-index: 1;
  display: flex;
  max-height: 60px;
  flex-wrap: wrap;
  gap: 6px 10px;
  overflow: hidden;
  padding: 8px 16px;
  color: var(--archive-red);
  font-size: 9px;
  letter-spacing: 0.1em;
}

.archive-loading__noise--top {
  top: 0;
}

.archive-loading__noise--bottom {
  bottom: 40px;
}

.archive-loading__tip {
  position: absolute;
  right: 16px;
  bottom: 12px;
  left: 16px;
  z-index: 5;
  overflow: hidden;
  color: #77716c;
  font-size: 10px;
  font-style: italic;
  letter-spacing: 0.08em;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.archive-loading__content {
  position: relative;
  z-index: 5;
  width: min(460px, calc(100% - 40px));
}

.archive-loading__signal {
  display: flex;
  justify-content: center;
  gap: 12px;
  color: #aaa5a0;
  font-size: 10px;
  letter-spacing: 0.3em;
  text-align: center;
  text-shadow: 1px 0 rgb(var(--archive-ink-rgb, 227 38 38) / 0.3), -1px 0 rgba(0, 210, 220, 0.16);
  animation: archiveSignalPulse 3s ease-in-out infinite;
}

.archive-loading__signal span,
.archive-loading__prompt,
.archive-loading__cursor {
  color: var(--archive-red);
}

.archive-loading__message {
  display: flex;
  min-height: 58px;
  align-items: baseline;
  gap: 7px;
  margin: 34px 0 24px;
  color: #e4e0db;
  font-size: 15px;
  line-height: 1.55;
  overflow-wrap: anywhere;
  text-shadow: 1px 0 rgb(var(--archive-ink-rgb, 227 38 38) / 0.16), -1px 0 rgba(0, 210, 220, 0.1);
}

.archive-loading__prompt,
.archive-loading__cursor {
  flex-shrink: 0;
}

.archive-loading__cursor {
  animation: cursorBlink 0.8s steps(1) infinite;
}

.archive-loading__progress-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: #a6a09b;
  font-size: 9px;
  letter-spacing: 0.2em;
}

.archive-loading__progress-head span:last-child {
  color: var(--archive-red);
}

.archive-loading__track {
  height: 3px;
  overflow: hidden;
  background: #242020;
}

.archive-loading__track span {
  display: block;
  width: 38%;
  height: 100%;
  background: var(--archive-red);
  animation: archiveLoad 1.35s ease-in-out infinite;
}

.archive-loading__track span.is-ready {
  width: 100%;
  transform: none;
  animation: none;
}

.archive-loading__status {
  display: grid;
  gap: 7px;
  margin-top: 26px;
  font-size: 10px;
  letter-spacing: 0.1em;
}

.archive-loading__status > div {
  display: flex;
  align-items: center;
  gap: 9px;
  color: #706b68;
  transition: color 400ms ease;
}

.archive-loading__status > div.is-done {
  color: #aaa5a0;
}

.archive-loading__status > div.is-active,
.archive-loading__status > div span {
  color: var(--archive-red);
}

@keyframes archiveScanlineScroll {
  to { transform: translate3d(0, 4px, 0); }
}

@keyframes archiveChromaticRed {
  0%, 100% { opacity: 0.6; transform: translate(1px, 0); }
  25% { opacity: 1; transform: translate(3px, -1px); }
  50% { opacity: 0.3; transform: translate(0, 1px); }
  75% { opacity: 0.8; transform: translate(2px, 0); }
}

@keyframes archiveChromaticCyan {
  0%, 100% { opacity: 0.5; transform: translate(-1px, 0); }
  25% { opacity: 0.8; transform: translate(-2px, 1px); }
  50% { opacity: 0.3; transform: translate(0, -1px); }
  75% { opacity: 0.7; transform: translate(-3px, 0); }
}

@keyframes archiveGlitch {
  0% { opacity: 1; transform: skewX(-1deg); }
  50% { opacity: 0.5; transform: skewX(0.5deg); }
  100% { opacity: 0; transform: none; }
}

@keyframes archiveSignalPulse {
  0%, 100% { opacity: 0.65; }
  50% { opacity: 1; }
}

.archive-loader-enter-active,
.archive-loader-leave-active {
  transition: opacity 280ms ease;
}

.archive-loader-enter-from,
.archive-loader-leave-to {
  opacity: 0;
}

@keyframes archiveLoad {
  0% {
    transform: translateX(-110%);
  }
  60% {
    transform: translateX(90%) scaleX(1.5);
  }
  100% {
    transform: translateX(270%);
  }
}

@keyframes cursorBlink {
  50% {
    opacity: 0;
  }
}

@media (max-width: 1040px) {
  .archive-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .archive-masthead {
    grid-template-columns: 1fr;
  }

  .archive-masthead__meta {
    width: min(100%, 360px);
  }
}

@media (max-width: 760px) {
  .archive-nav,
  .archive-shell {
    width: min(100% - 28px, 1240px);
  }

  .archive-shell {
    padding-top: 52px;
  }

  .archive-masthead {
    margin-bottom: 48px;
  }

  .archive-feature {
    grid-template-columns: 1fr;
    margin-bottom: 68px;
  }

  .archive-feature__cover {
    min-height: 360px;
    border-right: 0;
    border-bottom: 1px solid #292929;
  }

  .archive-feature__content {
    padding: 34px 24px 40px;
  }

  .archive-controls {
    align-items: stretch;
    flex-direction: column;
  }

  .archive-filters {
    justify-content: flex-start;
  }

  .archive-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 32px 12px;
  }


}

@media (max-width: 440px) {
  .archive-nav__back span {
    display: none;
  }

  .archive-masthead__meta {
    min-width: 0;
    width: 100%;
  }

  .archive-grid {
    grid-template-columns: 1fr;
    gap: 40px;
  }

  .archive-card__poster {
    aspect-ratio: 5 / 6;
  }
}

@media (prefers-reduced-motion: reduce) {
  .archive-loading__cursor,
  .archive-loading__scanlines,
  .archive-loading__chromatic,
  .archive-loading__glitch,
  .archive-loading__signal,
  .archive-loading__track span,
  .archive-cover::before,
  .archive-cover::after {
    animation: none;
  }

  .archive-card__poster {
    transition: border-color 160ms ease;
  }

  .archive-card:hover:not(:disabled) .archive-card__poster,
  .archive-card:focus-visible:not(:disabled) .archive-card__poster {
    transform: none;
  }
}
</style>
