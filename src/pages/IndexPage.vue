<template>
  <PageConstruct @complete="onConstructComplete">
    <q-page class="relative overflow-hidden" :style="{ background: 'rgb(var(--m-bg-rgb, 0 0 0))' }">
      <!-- Subtle background effects -->
      <div class="index-bg-vignette" />
      <div class="index-bg-grid" />
      <div class="index-bg-chromatic index-bg-chromatic--red" />
      <div class="index-bg-chromatic index-bg-chromatic--cyan" />

      <!-- Transient loading state (replaced as soon as landing data resolves).
           NOT a blocker while offline — offline keeps the page accessible. -->
      <div v-if="showStatusScreen" class="index-status-screen">
        <div class="index-status-card">
          <div class="index-status-copy">{{ statusCopy }}</div>
        </div>
      </div>

      <!-- Offline mode: page stays accessible. Keep only the navigation the
           offline-capable surfaces provide; hide the data-dependent panels
           (leaderboard/profiles, notices, user count). -->
      <q-no-ssr v-if="store.offline">
        <div class="index-offline">
          <div class="index-offline-card">
            <div class="index-offline-kicker">OFFLINE</div>
            <div class="index-offline-title">Offline mode</div>
            <p class="index-offline-copy">you can still access the offline vault surface areas:</p>
            <nav class="index-offline-links">
              <router-link to="/archives" class="index-offline-link">archives</router-link>
              <router-link to="/graveyard" class="index-offline-link">graveyard</router-link>
              <router-link to="/chains" class="index-offline-link">messaging</router-link>
            </nav>
          </div>
        </div>
      </q-no-ssr>

      <q-no-ssr v-else-if="!store.loading">
        <!-- Notifications bell moved to MainLayout header -->

        <!-- Mobile home: the desktop page is a composition of absolutely
             positioned rails, which on a phone leaves the random-profile action
             unreachable (it lives inside the leaderboard rail, hidden below
             1120px) and puts the only real content in a nested scroller. Stack
             the same pieces as one column instead: the action, the notices, then
             the stat. -->
        <div v-if="isMobile" class="index-mobile-home">
          <NoticeCard :announcements="liveAnnouncements" />

          <!-- Random profile moved BELOW the notices (it used to be the first thing
               on the page) and no longer stretched edge to edge: it sits at its
               natural width, centred, between the announcements and the user count. -->
          <div class="index-mobile-actions">
            <q-btn
              outline
              no-caps
              dense
              color="primary"
              icon="fas fa-dice"
              label="random profile"
              size="sm"
              :loading="randomLoading"
              class="font-mono random-profile-btn"
              @click="goRandomProfile"
            />
          </div>

          <div class="index-mobile-stat">
            <UserCountDisplay :count="store.totalUsers ?? 0" />
          </div>
        </div>

        <template v-else>
          <!-- Leaderboard - fixed to left while there is room -->
          <div class="index-leaderboard-panel">
            <!-- Random profile trip (like random star in the graveyard) - sits
                 above the leaderboard so it's easy to spot and reach -->
            <div class="index-random-btn">
              <q-btn
                outline
                no-caps
                dense
                color="primary"
                icon="fas fa-dice"
                label="random profile"
                size="sm"
                :loading="randomLoading"
                class="font-mono random-profile-btn"
                @click="goRandomProfile"
              />
            </div>

            <LeaderboardCard :profiles="store.topProfiles" :loading="store.loading" />
          </div>

          <!-- Notice Card -->
          <div class="index-notice-panel">
            <div class="index-notice-card">
              <NoticeCard :announcements="liveAnnouncements" />
            </div>
          </div>

          <div class="index-user-count">
            <UserCountDisplay :count="store.totalUsers ?? 0" />
          </div>
        </template>

        <!-- Kept outside both branches: it is a viewport-relative effect, and the
             mobile column scrolls (an ancestor with overflow would clip it). -->
        <WordsOverlay />
      </q-no-ssr>
    </q-page>
  </PageConstruct>
</template>
<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { api } from 'boot/axios';
import { useLandingStore } from 'src/stores/landing';
import { useAnnouncementsStore } from 'src/stores/announcements';
import WordsOverlay from 'components/WordsOverlay.vue';
import LeaderboardCard from 'components/LeaderBoardCard.vue';
import NoticeCard from 'components/NoticeCard.vue';
import UserCountDisplay from 'components/UserCountDisplay.vue';
import PageConstruct from 'components/PageConstruct.vue';
import { usePlatform } from 'src/composables/usePlatform';

const store = useLandingStore();
const announcementsStore = useAnnouncementsStore();
const $q = useQuasar();
const router = useRouter();
const { isMobile } = usePlatform();

/**
 * Live announcements: prefer the SSE-backed store when it has data,
 * otherwise fall back to the landing store's REST-fetched list.
 */
const liveAnnouncements = computed(() =>
  announcementsStore.loaded
    ? announcementsStore.active
    : store.announcements.filter((a) => a.isActive),
);

const randomLoading = ref(false);

async function goRandomProfile() {
  if (randomLoading.value) return;
  randomLoading.value = true;
  try {
    const resp = await api.get('/api/v1/profiles/random');
    const username = resp.data?.data?.username;
    if (username) void router.push(`/${username}`);
    else
      $q.notify({
        type: 'negative',
        message: 'No profiles to browse yet',
        position: 'bottom-right',
      });
  } catch {
    $q.notify({
      type: 'negative',
      message: 'Could not load a random profile',
      position: 'bottom-right',
    });
  } finally {
    randomLoading.value = false;
  }
}

// Transient syncing state ONLY. Offline does NOT block the page — the landing
// stays accessible and surfaces the offline navigation instead.
const showStatusScreen = computed(() => store.loading && !store.offline);

const statusCopy = computed(() => store.errorMessage ?? 'Syncing landing data.');

const constructComplete = ref(false);

function onConstructComplete() {
  constructComplete.value = true;
}

onMounted(async () => {
  await store.fetchLandingData();

  if (sessionStorage.getItem('pageConstructed')) {
    constructComplete.value = true;
  }
});
</script>

<style scoped>
/* ── Subtle background effects ── */
.index-bg-vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background: radial-gradient(ellipse at center, transparent 40%, rgba(0, 0, 0, 0.6) 100%);
}

.index-bg-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: 0.03;
  background-image:
    linear-gradient(rgb(var(--m-accent-rgb, 255 0 0) / 0.3) 1px, transparent 1px),
    linear-gradient(90deg, rgb(var(--m-accent-rgb, 255 0 0) / 0.3) 1px, transparent 1px);
  background-size: 60px 60px;
  animation: indexGridDrift 20s linear infinite;
}

@keyframes indexGridDrift {
  0% {
    transform: translate(0, 0);
  }
  100% {
    transform: translate(60px, 60px);
  }
}

.index-bg-chromatic {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  mix-blend-mode: screen;
}

.index-bg-chromatic--red {
  box-shadow: inset 1px 0 0 rgb(var(--m-accent-rgb, 255 0 0) / 0.06);
  animation: indexChromaticRed 6s ease-in-out infinite;
}

.index-bg-chromatic--cyan {
  box-shadow: inset -1px 0 0 rgba(0, 255, 255, 0.04);
  animation: indexChromaticCyan 6s ease-in-out infinite;
}

@keyframes indexChromaticRed {
  0%,
  100% {
    transform: translate(0.5px, 0);
    opacity: 0.4;
  }
  50% {
    transform: translate(1.5px, -0.5px);
    opacity: 0.7;
  }
}

@keyframes indexChromaticCyan {
  0%,
  100% {
    transform: translate(-0.5px, 0);
    opacity: 0.3;
  }
  50% {
    transform: translate(-1px, 0.5px);
    opacity: 0.6;
  }
}

.index-leaderboard-panel {
  position: absolute;
  transform: none;
  bottom: 0;
  width: 320px;
  margin: 0 0 2vh 2vw;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.index-random-btn {
  /* Sits directly above the leaderboard inside the left panel. */
  padding: 0 2px 0 2px;
}

.index-random-btn .random-profile-btn {
  width: 100%;
  justify-content: center;
  letter-spacing: 0.05em;
}

.index-notice-panel {
  position: absolute;
  inset: 0;
  z-index: 9;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  padding: clamp(1rem, 4vw, 2rem);
}

.index-notice-card {
  width: min(600px, 100%);
  pointer-events: auto;
}

.index-user-count {
  position: absolute;
  right: clamp(0.75rem, 4vw, 4rem);
  bottom: clamp(0.4rem, 2vh, 1rem);
  z-index: 12;
}

.index-status-screen {
  position: absolute;
  inset: 0;
  z-index: 11;
  display: grid;
  place-items: center;
  padding: clamp(1rem, 4vw, 3rem);
}

.index-status-card {
  width: min(680px, 100%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.78);
  backdrop-filter: blur(10px);
  box-shadow: 0 0 60px rgb(var(--m-accent-rgb, 255 0 0) / 0.08);
  padding: clamp(1.5rem, 4vw, 2.5rem);
  text-align: center;
}

.index-status-kicker {
  color: var(--primary, #ff0000);
  letter-spacing: 0.4em;
  font-size: 0.7rem;
  text-transform: uppercase;
  margin-bottom: 1rem;
}

.index-status-title {
  color: var(--white, #fff);
  font-size: clamp(1.6rem, 4vw, 2.75rem);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 0.85rem;
}

.index-status-copy {
  color: rgba(255, 255, 255, 0.68);
  font-family: 'Courier New', 'Consolas', monospace;
  letter-spacing: 0.12em;
  line-height: 1.8;
  font-size: 0.8rem;
}

/* ── Offline mode notice — landing stays accessible, no blocking overlay ── */
.index-offline {
  position: absolute;
  inset: 0;
  z-index: 11;
  display: grid;
  place-items: center;
  padding: clamp(1rem, 4vw, 3rem);
}

.index-offline-card {
  width: min(680px, 100%);
  border: 1px solid rgb(var(--m-accent-rgb, 255 0 0) / 0.25);
  background: rgba(0, 0, 0, 0.78);
  backdrop-filter: blur(10px);
  box-shadow: 0 0 60px rgb(var(--m-accent-rgb, 255 0 0) / 0.1);
  padding: clamp(1.5rem, 4vw, 2.5rem);
  text-align: center;
}

.index-offline-kicker {
  color: var(--primary, #ff0000);
  letter-spacing: 0.4em;
  font-size: 0.7rem;
  text-transform: uppercase;
  margin-bottom: 1rem;
}

.index-offline-title {
  color: var(--white, #fff);
  font-size: clamp(1.6rem, 4vw, 2.75rem);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 0.85rem;
}

.index-offline-copy {
  color: rgba(255, 255, 255, 0.68);
  font-family: 'Courier New', 'Consolas', monospace;
  letter-spacing: 0.12em;
  line-height: 1.8;
  font-size: 0.8rem;
  margin-bottom: 1.5rem;
}

.index-offline-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: center;
}

.index-offline-link {
  font-family: 'Courier New', 'Consolas', monospace;
  font-size: 0.7rem;
  letter-spacing: 0.25em;
  text-transform: uppercase;
  color: var(--primary, #ff0000);
  border: 1px solid rgb(var(--m-accent-rgb, 255 0 0) / 0.35);
  padding: 0.5rem 0.9rem;
  text-decoration: none;
  transition: all 0.15s ease;
}
.index-offline-link:hover {
  background: rgb(var(--m-accent-rgb, 255 0 0) / 0.08);
  border-color: var(--primary, #ff0000);
}

@media (max-width: 1120px), (max-height: 660px) {
  .index-leaderboard-panel {
    display: none;
  }
}

/* When the (left-anchored) leaderboard rail is visible, reserve the SAME gutter
   on both sides. A one-sided padding-left looked like a layout bug: the panel is
   `inset: 0` with `justify-content: center`, so a left-only gutter moves the
   card's centre right of the page centre (measured at 1366px: card centre 840 vs
   page centre 683). Symmetric padding keeps the card truly centred on the page
   while still keeping it clear of the leaderboard. */
@media (min-width: 1121px) and (min-height: 661px) {
  .index-notice-panel {
    /* 352px floor = the 320px leaderboard rail + its left margin, so the card
       never clips the rail at the narrow end of this breakpoint. */
    padding-left: clamp(352px, 24vw, 400px);
    padding-right: clamp(352px, 24vw, 400px);
  }
}

@media (max-width: 700px) {
  .index-notice-panel {
    align-items: flex-start;
    padding: 1rem 0.75rem 6rem;
  }

  .index-notice-card {
    width: 100%;
    max-height: calc(var(--app-height, 100vh) - 8rem);
    overflow: hidden auto;
  }

  .index-user-count {
    right: 0.75rem;
    bottom: 0.65rem;
  }
}

@media (max-width: 430px), (max-height: 520px) {
  .index-notice-panel {
    padding: 0.75rem 0.5rem 4.5rem;
  }
}

/* ── Mobile home ────────────────────────────────────────────────────────────
   The desktop page composes absolutely positioned rails; on a phone that hid the
   random-profile action entirely (it lives in the leaderboard rail, which is
   display:none below 1120px) and made the only content a nested scroller.
   One column instead: action, notices, stat — scrolling as a whole, with the
   bottom padding clearing the fixed nav and its safe-area inset. */
.index-mobile-home {
  position: absolute;
  inset: 0;
  z-index: 9;
  display: flex;
  flex-direction: column;
  /* Vertically centred: the notices used to be pinned to the top of the page. */
  justify-content: center;
  gap: 0.75rem;
  padding: 0.75rem 0.75rem calc(64px + env(safe-area-inset-bottom, 0px) + 0.75rem);
  overflow: hidden auto;
  overscroll-behavior: contain;
}

.index-mobile-home > * {
  flex: 0 0 auto;
}

.index-mobile-actions {
  display: flex;
  justify-content: center;
}

.index-mobile-actions .random-profile-btn {
  width: auto;
  justify-content: center;
  letter-spacing: 0.05em;
  /* Natural width looked tight against the label — give it real side padding and
     a comfortable touch height instead of stretching it. */
  padding: 0 20px;
  min-height: 36px;
}

.index-mobile-stat {
  display: flex;
  justify-content: center;
  padding-bottom: 0.5rem;
}
</style>
