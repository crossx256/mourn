<template>
  <q-page class="leaderboard-page">
    <nav class="leaderboard-nav" aria-label="Leaderboard navigation">
      <router-link to="/" class="leaderboard-back" aria-label="Back to home">
        <q-icon name="mdi-arrow-left" size="18px" />
        <span>mourn.bio</span>
      </router-link>
      <span class="leaderboard-nav__mark" aria-hidden="true">[ M / INDEX ]</span>
    </nav>

    <main class="leaderboard-shell">
      <header class="leaderboard-masthead">
        <h1>Leaderboards</h1>
        <div class="leaderboard-intro">
          <p>Browse the top 50 profiles by reputation, contribution, or referrals.</p>
          <span aria-hidden="true">SIGNAL / RANKINGS</span>
        </div>
      </header>

      <section class="leaderboard-ledger" aria-label="Profile rankings">
        <div class="leaderboard-controls">
          <div class="leaderboard-controls__title">
            <span class="leaderboard-signal" aria-hidden="true" />
            <h2>Rankings</h2>
            <span class="leaderboard-count" v-if="!loading && !errorMessage">
              {{ users.length }} {{ users.length === 1 ? 'profile' : 'profiles' }} in view
            </span>
          </div>
          <div class="leaderboard-tabs" role="group" aria-label="Sort rankings by">
            <button
              v-for="type in sortOptions"
              :key="type"
              type="button"
              :class="{ 'is-active': currentSort === type }"
              :aria-pressed="currentSort === type"
              @click="changeSort(type)"
            >
              {{ type }}
            </button>
          </div>
        </div>

        <div class="leaderboard-heading" aria-hidden="true">
          <span>Rank</span>
          <span>Profile</span>
          <span>{{ currentSort }}</span>
        </div>

        <div class="leaderboard-results" :aria-busy="loading">
          <div
            v-if="loading"
            class="leaderboard-loading"
            role="status"
            aria-label="Loading rankings"
          >
            <div v-for="n in 8" :key="n" class="leaderboard-row leaderboard-row--loading">
              <q-skeleton type="text" width="24px" bg-color="grey-9" />
              <div class="leaderboard-user">
                <q-skeleton type="QAvatar" size="38px" bg-color="grey-9" />
                <q-skeleton type="text" width="110px" bg-color="grey-9" />
              </div>
              <q-skeleton
                type="text"
                width="45px"
                bg-color="grey-9"
                class="leaderboard-skeleton-value"
              />
            </div>
          </div>

          <div v-else-if="errorMessage" class="leaderboard-message" role="alert">
            <span class="leaderboard-message__marker" aria-hidden="true">[ ! ]</span>
            <h3>Signal interrupted</h3>
            <p>{{ errorMessage }}</p>
            <button type="button" @click="fetchLeaderboard">
              Try again <q-icon name="mdi-arrow-right" size="16px" />
            </button>
          </div>

          <ol
            v-else-if="users.length"
            class="leaderboard-list"
            :aria-label="`${currentSort} rankings`"
          >
            <li v-for="(user, index) in users" :key="user.username" class="leaderboard-row">
              <span class="leaderboard-rank">{{ String(index + 1).padStart(2, '0') }}</span>
              <div class="leaderboard-user">
                <q-avatar size="38px" class="leaderboard-avatar">
                  <q-img
                    :src="user.profilePicture || blackPixel"
                    spinner-color="primary"
                    spinner-size="12px"
                    decoding="async"
                    fetchpriority="low"
                  />
                </q-avatar>
                <router-link :to="`/${user.username}`" :title="user.username">
                  {{ user.username }}
                </router-link>
              </div>
              <span class="leaderboard-value">{{ formatValue(user[currentSort]) }}</span>
            </li>
          </ol>

          <div v-else class="leaderboard-message" role="status">
            <span class="leaderboard-message__marker" aria-hidden="true">[ — ]</span>
            <h3>No rankings found</h3>
            <p>There are no profiles ranked by {{ currentSort }} yet. Try another category.</p>
          </div>
        </div>
        <div class="leaderboard-footer" aria-hidden="true">
          <span>END OF INDEX</span>
          <span>mourn.bio / rankings</span>
        </div>
      </section>
    </main>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from 'src/boot/axios';
import type { LeaderboardProfile, APILeaderboardProfile } from 'src/types/leaderboard';

type SortKey = 'reputation' | 'contribution' | 'referrals';

const sortOptions: SortKey[] = ['reputation', 'contribution', 'referrals'];
const blackPixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const currentSort = ref<SortKey>('reputation');
const loading = ref(false);
const errorMessage = ref('');
const users = ref<LeaderboardProfile[]>([]);
let requestId = 0;

const formatValue = (val: number | null | undefined) => {
  if (val == null) return '0';
  const formatted = val.toLocaleString();
  return currentSort.value === 'contribution' ? `${formatted}$` : formatted;
};

const changeSort = (type: SortKey) => {
  if (currentSort.value === type) return;
  currentSort.value = type;
  void fetchLeaderboard();
};

const fetchLeaderboard = async () => {
  const id = ++requestId;
  const sort = currentSort.value;
  loading.value = true;
  errorMessage.value = '';
  try {
    const response = await api.get(`/api/v1/public/leaderboard?limit=50&sort=${sort}`);
    if (!response.data.success || !Array.isArray(response.data.data)) {
      throw new Error('Invalid leaderboard response');
    }
    if (id !== requestId) return;
    users.value = response.data.data.map((item: APILeaderboardProfile) => ({
      username: item.username,
      reputation: item.reputation ?? 0,
      referrals: item.referrals ?? 0,
      contribution: item.contribution ?? 0,
      profilePicture: item.profilePicture || null,
    }));
  } catch (error) {
    if (id !== requestId) return;
    console.error('Leaderboard fetch failed:', error);
    users.value = [];
    errorMessage.value = 'Could not load the rankings. Check your connection and try again.';
  } finally {
    if (id === requestId) loading.value = false;
  }
};

onMounted(fetchLeaderboard);
</script>

<style scoped>
.leaderboard-page {
  --lb-red: rgb(var(--m-lbRed-rgb, 227 38 38));
  --lb-text: rgb(var(--m-text-rgb, 236 233 228));
  --lb-muted: rgb(var(--m-textMuted-rgb, 166 160 154));
  position: relative;
  min-height: 100%;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  color: var(--lb-text);
  background: rgb(var(--m-bg-rgb, 0 0 0));
  scrollbar-color: rgb(var(--m-borderStrong-rgb, 69 64 62)) rgb(var(--m-bg-rgb, 0 0 0));
  caret-color: var(--lb-red);
}

.leaderboard-page::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    0deg,
    transparent 0 3px,
    rgba(255, 255, 255, 0.008) 3px 4px
  );
}

.leaderboard-page::selection,
.leaderboard-page :deep(::selection) {
  color: #fff;
  background: rgb(var(--lb-ink-rgb, var(--m-lbRed-rgb, 227 38 38)) / 0.7);
}

.leaderboard-nav,
.leaderboard-shell {
  position: relative;
  width: min(1060px, calc(100% - 48px));
  margin: 0 auto;
}

.leaderboard-nav {
  display: flex;
  min-height: 64px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgb(var(--m-border-rgb, 41 41 41));
}

.leaderboard-back,
.leaderboard-nav__mark,
.leaderboard-intro span,
.leaderboard-controls,
.leaderboard-heading,
.leaderboard-rank,
.leaderboard-value,
.leaderboard-count,
.leaderboard-message__marker,
.leaderboard-message button,
.leaderboard-footer {
  font-family: 'Courier New', Consolas, monospace;
}

.leaderboard-back {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--lb-muted);
  font-size: 11px;
  letter-spacing: 0.1em;
  text-decoration: none;
  text-transform: uppercase;
}

.leaderboard-back:hover,
.leaderboard-back:focus-visible {
  color: var(--lb-red);
}

.leaderboard-nav__mark {
  color: #89817d;
  font-size: 10px;
  letter-spacing: 0.1em;
}

.leaderboard-shell {
  padding: 72px 0 64px;
}

.leaderboard-masthead {
  margin-bottom: 64px;
}

.leaderboard-masthead h1 {
  margin: 0;
  color: #f4f1ec;
  font-family: Arial, Helvetica, sans-serif;
  font-size: clamp(3rem, 7vw, 5.5rem);
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.04em;
  text-shadow:
    1px 0 rgb(var(--lb-ink-rgb, var(--m-lbRed-rgb, 227 38 38)) / 0.16),
    -1px 0 rgba(80, 174, 174, 0.12);
}

.leaderboard-intro {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  margin-top: 18px;
}

.leaderboard-intro p {
  margin: 0;
  color: #b8b2ac;
  font-size: 14px;
  line-height: 1.6;
}

.leaderboard-intro span {
  flex: none;
  color: var(--lb-muted);
  font-size: 10px;
  letter-spacing: 0.12em;
}

.leaderboard-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 0;
  border-top: 1px solid rgb(var(--m-borderStrong-rgb, 52 48 47));
}

.leaderboard-controls__title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.leaderboard-controls h2 {
  margin: 0;
  font:
    700 12px/1.4 'Courier New',
    Consolas,
    monospace;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.leaderboard-signal {
  width: 5px;
  height: 5px;
  background: var(--lb-red);
}

.leaderboard-count {
  margin-left: 12px;
  color: var(--lb-muted);
  font-size: 10px;
  letter-spacing: 0.04em;
}

.leaderboard-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.leaderboard-tabs button {
  min-height: 42px;
  padding: 8px 12px;
  border: 1px solid transparent;
  color: var(--lb-muted);
  background: transparent;
  font:
    700 10px/1.4 'Courier New',
    Consolas,
    monospace;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition:
    color 160ms ease,
    border-color 160ms ease,
    background 160ms ease;
}

.leaderboard-tabs button:hover,
.leaderboard-tabs button:focus-visible {
  color: rgb(var(--m-text-rgb, 255 255 255));
  background: rgb(var(--m-accent-rgb, 226 38 38) / 0.1);
}

.leaderboard-tabs button.is-active {
  border-color: rgb(var(--m-accent-rgb, 226 38 38) / 0.45);
  color: rgb(var(--m-text-rgb, 255 255 255));
  background: rgb(var(--m-accent-rgb, 226 38 38) / 0.12);
}

.leaderboard-tabs button:focus-visible,
.leaderboard-back:focus-visible,
.leaderboard-user a:focus-visible,
.leaderboard-message button:focus-visible {
  outline: 2px solid var(--lb-red);
  outline-offset: 3px;
}

.leaderboard-heading,
.leaderboard-row {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr) minmax(110px, 160px);
  align-items: center;
  gap: 12px;
}

.leaderboard-heading {
  padding: 17px 20px;
  border-top: 1px solid rgb(var(--m-border-rgb, 41 41 41));
  border-bottom: 1px solid rgb(var(--m-border-rgb, 41 41 41));
  color: var(--lb-muted);
  background: rgb(var(--m-bg-rgb, 0 0 0));
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.leaderboard-heading span:last-child {
  text-align: right;
}

.leaderboard-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.leaderboard-row {
  min-height: 77px;
  padding: 12px 20px;
  border-bottom: 1px solid rgb(var(--m-border-rgb, 36 36 36));
  transition: background 160ms ease;
}

.leaderboard-list .leaderboard-row:hover,
.leaderboard-list .leaderboard-row:focus-within {
  background: rgb(var(--m-hover-rgb, 19 16 16));
}

.leaderboard-rank {
  color: var(--lb-muted);
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}

.leaderboard-row:nth-child(-n + 3) .leaderboard-rank {
  color: var(--lb-red);
}

.leaderboard-user {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 16px;
}

.leaderboard-avatar {
  flex: none;
  overflow: hidden;
  border: 1px solid rgb(var(--m-borderStrong-rgb, 59 54 52));
  background: rgb(var(--m-card-rgb, 17 17 17));
}

.leaderboard-user a {
  min-width: 0;
  overflow: hidden;
  color: var(--lb-text);
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 160ms ease;
}

.leaderboard-user a:hover,
.leaderboard-user a:focus-visible {
  color: rgb(var(--m-accentAlt-rgb, 255 96 96));
  text-decoration: underline;
  text-underline-offset: 4px;
}

.leaderboard-value {
  color: #f1ede8;
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.leaderboard-skeleton-value {
  justify-self: end;
}

.leaderboard-message {
  display: flex;
  min-height: 230px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  padding: 36px 18px;
  border-bottom: 1px solid rgb(var(--m-border-rgb, 41 41 41));
  text-align: center;
}

.leaderboard-message__marker {
  color: var(--lb-red);
  font-size: 12px;
}

.leaderboard-message h3 {
  margin: 12px 0 0;
  color: var(--lb-text);
  font-size: 20px;
  font-weight: 700;
}

.leaderboard-message p {
  margin: 8px 0 0;
  color: var(--lb-muted);
  font-size: 13px;
  line-height: 1.5;
}

.leaderboard-message button {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
  padding: 10px 14px;
  border: 1px solid rgb(var(--m-accent-rgb, 226 38 38) / 0.45);
  color: rgb(var(--m-text-rgb, 255 255 255));
  background: rgb(var(--m-accent-rgb, 226 38 38) / 0.12);
  font-size: 11px;
  text-transform: uppercase;
  cursor: pointer;
}

.leaderboard-message button:hover {
  background: rgb(var(--m-accent-rgb, 226 38 38) / 0.22);
}

.leaderboard-footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 0;
  color: #89817d;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

@media (max-width: 720px) {
  .leaderboard-shell {
    padding-top: 52px;
  }

  .leaderboard-masthead {
    margin-bottom: 48px;
  }

  .leaderboard-intro {
    align-items: start;
    flex-direction: column;
    gap: 12px;
  }

  .leaderboard-controls {
    align-items: start;
    flex-direction: column;
    gap: 14px;
  }
}

@media (max-width: 520px) {
  .leaderboard-nav,
  .leaderboard-shell {
    width: calc(100% - 28px);
  }

  .leaderboard-nav__mark {
    display: none;
  }

  .leaderboard-masthead h1 {
    font-size: clamp(2.45rem, 10vw, 3.5rem);
  }

  .leaderboard-tabs {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .leaderboard-tabs button {
    padding: 8px 4px;
    font-size: 9px;
    letter-spacing: 0.02em;
  }

  .leaderboard-heading,
  .leaderboard-row {
    grid-template-columns: 32px minmax(0, 1fr) minmax(72px, auto);
    gap: 8px;
    padding-right: 8px;
    padding-left: 8px;
  }

  .leaderboard-user {
    gap: 9px;
  }

  .leaderboard-user a {
    font-size: 13px;
  }

  .leaderboard-rank,
  .leaderboard-value {
    font-size: 14px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .leaderboard-tabs button,
  .leaderboard-row,
  .leaderboard-user a {
    transition: none;
  }
}
</style>
