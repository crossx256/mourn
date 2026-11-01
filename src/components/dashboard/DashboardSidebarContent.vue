<template>
  <div class="sidebar-content-wrap">
    <!-- User Info -->
    <div class="sidebar-user-info">
      <div class="user-avatar">
        <img
          v-if="dashboardStore.profile?.profilePicture"
          :src="dashboardStore.profile.profilePicture"
        />
        <q-icon v-else name="fas fa-user" color="grey-6" size="16px" />
      </div>
      <div class="user-meta">
        <h2>{{ dashboardStore.username }}</h2>
      </div>
    </div>

    <!-- Search -->
    <div class="sidebar-search">
      <div class="search-input-wrap" :class="{ focused: searchFocused }">
        <q-icon name="fas fa-search" size="12px" />
        <input
          ref="searchInputEl"
          :value="searchQuery"
          type="text"
          placeholder="search..."
          autocomplete="off"
          @input="$emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
          @focus="searchFocused = true"
          @blur="searchFocused = false"
        />
        <kbd class="search-shortcut">Ctrl+F</kbd>
      </div>
      <div v-if="searchQuery && searchResults.length > 0" class="search-results active">
        <div
          v-for="result in searchResults"
          :key="`${result.tab}-${result.field}`"
          class="search-result-item"
          @click="$emit('navigateResult', result)"
        >
          <span class="result-label">{{ result.field.replace(/-/g, ' ') }}</span>
          <span class="result-section">{{ result.tab }}</span>
        </div>
      </div>
    </div>

    <!-- Navigation -->
    <nav ref="navRef" class="dashboard-nav">
      <!-- Animated sliding red border -->
      <div ref="borderEffectRef" class="nav-border-effect" />

      <!-- PROFILE section -->
      <div class="nav-section">
        <div class="nav-section-title">profile</div>
        <a
          v-for="tab in profileTabs"
          :key="tab.id"
          href="#"
          class="nav-item"
          :class="{ active: activeTab === tab.id }"
          :ref="(el) => setNavItemRef(tab.id, el as HTMLElement)"
          @click.prevent="$emit('update:activeTab', tab.id)"
        >
          <q-icon :name="tab.icon" size="14px" />
          <span>{{ tab.label }}</span>
        </a>
      </div>

      <!-- CUSTOMIZATION section -->
      <div class="nav-section">
        <div class="nav-section-title">customization</div>
        <a
          v-for="tab in customizationTabs"
          :key="tab.id"
          href="#"
          class="nav-item"
          :class="{ active: activeTab === tab.id }"
          :ref="(el) => setNavItemRef(tab.id, el as HTMLElement)"
          @click.prevent="$emit('update:activeTab', tab.id)"
        >
          <q-icon :name="tab.icon" size="14px" />
          <span>{{ tab.label }}</span>
        </a>
      </div>

      <!-- SETTINGS section -->
      <div class="nav-section">
        <div class="nav-section-title">settings</div>
        <a
          v-for="tab in settingsTabs"
          :key="tab.id"
          href="#"
          class="nav-item"
          :class="{ active: activeTab === tab.id }"
          :ref="(el) => setNavItemRef(tab.id, el as HTMLElement)"
          @click.prevent="$emit('update:activeTab', tab.id)"
        >
          <q-icon :name="tab.icon" size="14px" />
          <span>{{ tab.label }}</span>
        </a>
      </div>

      <!-- STATS section -->
      <div class="nav-section">
        <div class="nav-section-title">stats</div>
        <div class="nav-item nav-stat">
          <q-icon name="fas fa-eye" size="14px" />
          <span
            >views: <b>{{ dashboardStore.profile?.views || 0 }}</b></span
          >
        </div>
        <div class="nav-item nav-stat">
          <q-icon name="fas fa-users" size="14px" />
          <span
            >referrals: <b>{{ dashboardStore.user?.referralCount || 0 }}</b></span
          >
        </div>
        <div class="nav-item nav-stat">
          <q-icon name="fas fa-star" size="14px" />
          <span
            >reputation: <b>{{ dashboardStore.profile?.reputation || 0 }}</b></span
          >
        </div>
        <div class="nav-item nav-stat">
          <q-icon name="fas fa-gift" size="14px" />
          <span>contributions: <b>0</b></span>
        </div>
      </div>
    </nav>

    <!-- Footer -->
    <div class="sidebar-footer">
      <div
        v-if="dashboardStore.hasUnsavedChanges && $q.screen.gt.sm"
        class="sidebar-actions flex flex-col gap-2"
      >
        <q-btn
          flat
          no-caps
          dense
          label="revert"
          icon="mdi-undo"
          class="btn-secondary w-full"
          @click="dashboardStore.revertChanges?.()"
        />
        <q-btn
          unelevated
          no-caps
          dense
          label="save changes"
          class="btn-primary-action w-full"
          :loading="dashboardStore.isSaving"
          @click="handleSaveChanges"
        />
      </div>
      <router-link :to="`/${dashboardStore.username}`" class="btn-view-profile">
        <q-icon name="fas fa-external-link-alt" size="12px" /> view profile
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useQuasar } from 'quasar';

interface TabDef {
  id: string;
  label: string;
  icon: string;
}

interface SearchResult {
  tab: string;
  field: string;
}

interface DashboardStoreLike {
  username: string;
  isDonator: boolean;
  hasUnsavedChanges?: boolean;
  isSaving?: boolean;
  revertChanges?: () => void;
  profile?: {
    profilePicture?: string | null;
    views?: number | null;
    reputation?: number | null;
  } | null;
  user?: {
    referralCount?: number | null;
  } | null;
}

const props = defineProps<{
  dashboardStore: DashboardStoreLike;
  searchQuery: string;
  searchResults: SearchResult[];
  activeTab: string;
  profileTabs: TabDef[];
  customizationTabs: TabDef[];
  settingsTabs: TabDef[];
  onSaveChanges?: () => void | Promise<void>;
}>();

const emit = defineEmits<{
  'update:searchQuery': [value: string | number | null];
  'update:activeTab': [tabId: string];
  navigateResult: [result: SearchResult];
  searchFocus: [ref: { focus: () => void }];
}>();

const searchFocused = ref(false);
const searchInputEl = ref<HTMLInputElement | null>(null);
const $q = useQuasar();

function handleSaveChanges() {
  void props.onSaveChanges?.();
}

// --- Nav border positioning (animated sliding red border) ---
const navRef = ref<HTMLElement | null>(null);
const borderEffectRef = ref<HTMLElement | null>(null);
const navItemRefs: Record<string, HTMLElement | null> = {};

function setNavItemRef(tabId: string, el: HTMLElement | null) {
  navItemRefs[tabId] = el;
}

function updateBorderPosition(animate = true) {
  const nav = navRef.value;
  const border = borderEffectRef.value;
  const activeLink = navItemRefs[props.activeTab];
  if (!nav || !border || !activeLink) return;

  const navRect = nav.getBoundingClientRect();
  const linkRect = activeLink.getBoundingClientRect();
  const topOffset = linkRect.top - navRect.top + nav.scrollTop;

  if (!animate) {
    border.style.transition = 'none';
    border.style.top = `${topOffset}px`;
    border.style.height = `${linkRect.height}px`;
    void border.offsetHeight; // force reflow
    border.style.transition = '';
  } else {
    border.style.top = `${topOffset}px`;
    border.style.height = `${linkRect.height}px`;
  }
}

watch(
  () => props.activeTab,
  () => {
    void nextTick(() => updateBorderPosition(true));
  },
);

let resizeTimeout: ReturnType<typeof setTimeout>;

function handleResize() {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => updateBorderPosition(false), 100);
}

onMounted(() => {
  // Emit search focus ref so parent can trigger Ctrl+F focus
  emit('searchFocus', { focus: () => searchInputEl.value?.focus() });

  // Initial border position (no animation)
  void nextTick(() => {
    requestAnimationFrame(() => updateBorderPosition(false));
  });

  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
  clearTimeout(resizeTimeout);
});

// Expose focus method for direct ref access
defineExpose({
  focusSearch() {
    searchInputEl.value?.focus();
  },
});
</script>
