<template>
  <q-page class="bg-dash-bg text-dash-text flex justify-center q-pt-lg overflow-hidden relative">
    <q-btn
      round
      flat
      icon="mdi-arrow-left"
      to="/dashboard"
      color="primary"
      class="absolute left-4 top-4 z-10"
      aria-label="back to dashboard"
    />

    <div class="w-full max-w-2xl px-4 flex flex-col gap-6">
      <!-- Header -->
      <div class="text-center">
        <h1 class="text-3xl font-bold tracking-tight mb-1">Discovery</h1>
        <p class="text-dash-muted text-xs font-mono uppercase tracking-widest">
          Search &middot; Connect &middot; Establish
        </p>
      </div>

      <!-- Search Bar -->
      <div class="relative">
        <q-input
          v-model="searchQuery"
          placeholder="Search users..."
          dense
          outlined
          dark
          class="discovery-search"
          input-class="font-mono text-sm"
          color="primary"
          @update:model-value="onSearch"
        >
          <template #prepend>
            <q-icon name="mdi-magnify" color="grey-6" />
          </template>
          <template #append>
            <q-spinner v-if="linksStore.searchLoading" color="primary" size="xs" />
            <q-icon
              v-else-if="searchQuery"
              name="mdi-close"
              class="cursor-pointer"
              color="grey-6"
              @click="clearSearch"
            />
          </template>
        </q-input>
      </div>

      <!-- Results -->
      <q-scroll-area class="flex-grow" style="height: 60vh">
        <!-- Empty state -->
        <div
          v-if="!searchQuery && linksStore.searchResults.length === 0"
          class="flex flex-col items-center justify-center h-full text-dash-muted"
        >
          <q-icon name="mdi-account-search" size="64px" class="opacity-20 mb-4" />
          <p class="text-xs font-mono uppercase tracking-widest">
            Begin typing to discover users
          </p>
        </div>

        <!-- No results -->
        <div
          v-else-if="searchQuery && !linksStore.searchLoading && linksStore.searchResults.length === 0"
          class="flex flex-col items-center justify-center h-40 text-dash-muted"
        >
          <p class="text-xs font-mono uppercase">No users found</p>
        </div>

        <!-- User Cards -->
        <div v-else class="flex flex-col gap-2 pr-2">
          <div
            v-for="user in linksStore.searchResults"
            :key="user.id"
            class="discovery-card group"
            @click="selectUser(user)"
          >
            <div class="flex items-center gap-4 p-4">
              <q-avatar size="42px" class="border border-dash-border">
                <img
                  v-if="user.profile?.profilePicture"
                  :src="user.profile.profilePicture"
                  :alt="user.username"
                />
                <q-icon v-else name="mdi-account" size="24px" color="grey-6" />
              </q-avatar>

              <div class="flex-grow min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-bold text-sm truncate">
                    {{ user.profile?.displayName || user.username }}
                  </span>
                  <q-icon
                    v-if="user.isDonator"
                    name="mdi-crown"
                    size="14px"
                    color="amber"
                  />
                </div>
                <span class="text-dash-muted text-xs font-mono">@{{ user.username }}</span>
              </div>

              <!-- Link status indicator -->
              <div class="flex-none">
                <q-badge
                  v-if="user.linkStatus === 'ANCHORED'"
                  color="negative"
                  text-color="white"
                  class="font-mono text-[10px]"
                >
                  ANCHORED
                </q-badge>
                <q-badge
                  v-else-if="user.linkStatus === 'ESTABLISHED'"
                  color="positive"
                  text-color="white"
                  class="font-mono text-[10px]"
                >
                  LINKED
                </q-badge>
                <q-badge
                  v-else-if="user.linkStatus === 'PENDING'"
                  color="warning"
                  text-color="dark"
                  class="font-mono text-[10px]"
                >
                  PENDING
                </q-badge>
                <q-icon
                  v-else
                  name="mdi-link-plus"
                  size="20px"
                  class="text-dash-muted group-hover:text-primary transition-colors"
                />
              </div>
            </div>
          </div>
        </div>
      </q-scroll-area>
    </div>

    <!-- Profile Modal -->
    <q-dialog v-model="showProfileModal" transition-show="fade" transition-hide="fade">
      <q-card
        v-if="selectedUser"
        class="bg-dash-panel text-dash-text border border-dash-border"
        style="min-width: 380px; max-width: 440px; border-radius: 0"
      >
        <q-card-section class="flex flex-col items-center gap-4 pt-8 pb-4">
          <q-avatar size="80px" class="border-2 border-dash-border">
            <img
              v-if="selectedUser.profile?.profilePicture"
              :src="selectedUser.profile.profilePicture"
              :alt="selectedUser.username"
            />
            <q-icon v-else name="mdi-account" size="40px" color="grey-6" />
          </q-avatar>

          <div class="text-center">
            <h3 class="text-lg font-bold flex items-center justify-center gap-2">
              {{ selectedUser.profile?.displayName || selectedUser.username }}
              <q-icon v-if="selectedUser.isDonator" name="mdi-crown" size="16px" color="amber" />
            </h3>
            <span class="text-dash-muted text-xs font-mono">@{{ selectedUser.username }}</span>
          </div>

          <p
            v-if="selectedUser.profile?.bio"
            class="text-dash-muted text-xs text-center max-w-[300px] leading-relaxed"
          >
            {{ selectedUser.profile.bio }}
          </p>

          <div class="flex items-center gap-4 text-[10px] font-mono text-dash-muted uppercase">
            <span>Rep: {{ selectedUser.profile?.reputation ?? 0 }}</span>
            <span>&middot;</span>
            <span>Joined: {{ formatDate(selectedUser.createdAt) }}</span>
          </div>
        </q-card-section>

        <q-separator dark />

        <q-card-actions class="flex justify-center pb-6 pt-4">
          <!-- Already anchored -->
          <q-btn
            v-if="selectedUser.linkStatus === 'ANCHORED'"
            flat
            disable
            class="font-mono text-xs"
            icon="mdi-link-lock"
            label="ANCHORED"
            color="negative"
          />

          <!-- Already linked -->
          <q-btn
            v-else-if="selectedUser.linkStatus === 'ESTABLISHED'"
            flat
            disable
            class="font-mono text-xs"
            icon="mdi-link"
            label="LINK ACTIVE"
            color="positive"
          />

          <!-- Pending -->
          <q-btn
            v-else-if="selectedUser.linkStatus === 'PENDING'"
            flat
            disable
            class="font-mono text-xs"
            icon="mdi-clock-outline"
            label="PENDING"
            color="warning"
          />

          <!-- No link — show establish actions -->
          <template v-else>
            <q-btn
              flat
              class="font-mono text-xs"
              icon="mdi-link-plus"
              label="ESTABLISH LINK"
              color="white"
              :loading="actionLoading"
              @click="initiateLink"
            />
          </template>
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useQuasar } from 'quasar';
import { useLinksStore } from 'stores/links';
import { useNativeShell } from 'src/composables/useNativeShell';
import type { SearchUser } from 'src/types/links';

const $q = useQuasar();
const linksStore = useLinksStore();
const { isTauri } = useNativeShell();

const searchQuery = ref('');
const showProfileModal = ref(false);
const selectedUser = ref<SearchUser | null>(null);
const actionLoading = ref(false);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function onSearch(val: string | number | null) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void linksStore.searchUsers(String(val ?? ''));
  }, 300);
}

function clearSearch() {
  searchQuery.value = '';
  linksStore.searchResults = [];
}

function selectUser(user: SearchUser) {
  selectedUser.value = user;
  showProfileModal.value = true;
}

async function initiateLink() {
  if (!selectedUser.value) return;
  actionLoading.value = true;

  try {
    // Desktop: route through Tauri bridge for future key-exchange
    if (isTauri.value && window.__TAURI_INTERNALS__) {
      // Use the global Tauri internals directly — @tauri-apps/api is not a dep of mourn-frontend
      await (window.__TAURI_INTERNALS__ as { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> }).invoke('establish_secure_link', {
        chatId: selectedUser.value.id,
        anchor: false,
      });
    }

    await linksStore.requestLink(selectedUser.value.id, false);

    // Update the modal's link status optimistically
    selectedUser.value = {
      ...selectedUser.value,
      linkStatus: 'PENDING',
    };

    const common = {
      position: 'top' as const,
      timeout: 3000,
      classes:
        'notify-offset border border-solid border-[var(--primary)] font-mono lowercase tracking-widest text-weight-bold',
    };

    $q.notify({
      ...common,
      message: 'Link request sent',
      color: 'primary',
      textColor: 'black',
      icon: 'mdi-shield-check',
    });
  } catch {
    $q.notify({
      type: 'negative',
      message: 'Failed to establish link',
      position: 'bottom',
      timeout: 2000,
    });
  } finally {
    actionLoading.value = false;
  }
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}
</script>

<style scoped>
.discovery-search :deep(.q-field__control) {
  background: #0d0d0d;
  border-color: rgba(255, 255, 255, 0.08);
}
.discovery-search :deep(.q-field__control:hover) {
  border-color: rgba(255, 255, 255, 0.15);
}

.discovery-card {
  background: #0d0d0d; /* --dash-panel */
  border: 1px solid #1a1a1a; /* --dash-border */
  border-radius: 0; /* Mourn: square corners */
  cursor: pointer;
  transition: all 0.15s ease;
}

.discovery-card:hover {
  border-color: #2a2a2a; /* --dash-border-hover */
  background: #111;
}
