<template>
  <q-page
    class="dashboard-page bg-black text-white font-mono flex max-h-[100%] flex-col no-wrap relative"
  >
    <q-no-ssr tag="div" class="dashboard-layout">
      <main class="dashboard-main flex-grow">
        <div class="dashboard-workspace">
          <div class="dashboard-workspace__inner">
            <div class="dashboard-workspace__bar">
              <span class="dashboard-workspace__title">dashboard</span>
              <span
                class="dashboard-workspace__status"
                :class="{ 'is-dirty': hasUnsavedDashboardChanges }"
                role="status"
              >
                {{
                  dashboardStore.isLoading
                    ? 'Loading profile'
                    : dashboardStore.isSaving
                      ? 'Saving changes'
                      : hasUnsavedDashboardChanges
                        ? 'Unsaved changes'
                        : 'No unsaved changes'
                }}
              </span>
            </div>
            <nav
              v-if="sectionLinks.length > 1"
              class="dashboard-workspace__sections"
              :aria-label="`Sections in ${activeTabLabel}`"
            >
              <div ref="sectionListRef" class="dashboard-workspace__section-list">
                <button
                  v-for="(section, index) in sectionLinks"
                  :key="`${activeTab}-${index}-${section.label}`"
                  type="button"
                  :class="{ 'is-current': activeSection === index }"
                  :aria-current="activeSection === index ? 'location' : undefined"
                  @click="goToSection(index)"
                >
                  {{ section.label }}
                </button>
              </div>
            </nav>
          </div>
        </div>

        <div
          ref="dashboardContentRef"
          class="dashboard-content"
          @scroll.passive="onMainScroll"
          @wheel.passive="cancelSectionNavigation"
          @touchstart.passive="cancelSectionNavigation"
        >
          <transition name="fade" mode="out-in">
            <div :key="activeTab">
              <ProfileTab v-if="activeTab === 'profile'" />
              <AppearanceTab v-else-if="activeTab === 'appearance'" />
              <EffectsTab v-else-if="activeTab === 'effects'" />
              <CardTab v-else-if="activeTab === 'card'" />
              <SocialTab v-else-if="activeTab === 'social'" />
              <PresetsTab v-else-if="activeTab === 'presets'" />
              <AccountTab v-else-if="activeTab === 'account'" />
              <AppTab v-else-if="activeTab === 'app'" />
              <ThemeTab v-else-if="THEME_ENABLED && activeTab === 'theme'" />
              <PerformanceTab v-else-if="activeTab === 'performance'" />
              <PrivacyTab v-else-if="activeTab === 'privacy'" />
              <WatcherTab v-else-if="activeTab === 'watcher'" />
              <SecurityTab v-else-if="activeTab === 'security'" />
            </div>
          </transition>
        </div>
      </main>

      <section v-if="$q?.screen?.gt?.md" class="dashboard-preview-panel">
        <DashboardPreview />
      </section>

      <q-dialog v-model="showLeavePrompt" persistent transition-show="fade" transition-hide="fade">
        <q-card class="dashboard-leave-dialog bg-[#0f0f12] text-white border border-[#2a2a30]">
          <q-card-section class="pb-2">
            <div class="text-[10px] uppercase tracking-[0.35em] text-primary/70 mb-2">
              unsaved changes
            </div>
            <div class="text-lg font-semibold">Leave this page?</div>
            <p class="mt-2 text-sm text-white/70 leading-relaxed">
              You have unsaved dashboard changes. Leave and revert will discard them, leave and save
              will keep them, or cancel will keep you here.
            </p>
          </q-card-section>

          <q-card-actions align="right" class="gap-2 px-4 pb-4 pt-0">
            <q-btn
              flat
              no-caps
              label="cancel"
              class="text-white/70"
              :disable="isResolvingLeavePrompt"
              @click="cancelLeavePrompt"
            />
            <q-btn
              flat
              no-caps
              label="leave and revert"
              class="text-primary"
              :disable="isResolvingLeavePrompt"
              @click="resolveLeavePrompt('revert')"
            />
            <q-btn
              unelevated
              no-caps
              label="leave and save"
              color="primary"
              :loading="isResolvingLeavePrompt && leavePromptAction === 'save'"
              :disable="isResolvingLeavePrompt"
              @click="resolveLeavePrompt('save')"
            />
          </q-card-actions>
        </q-card>
      </q-dialog>
      <ChangePasswordModal v-model="showChangePasswordModal" />
      <DeleteAccountModal v-model="showDeleteAccountModal" />
    </q-no-ssr>
  </q-page>
</template>

<script setup lang="ts">
import { THEME_ENABLED, useThemeStore } from 'src/stores/theme';
import {
  ref,
  shallowRef,
  computed,
  watch,
  onMounted,
  onUnmounted,
  provide,
  inject,
  nextTick,
  defineAsyncComponent,
} from 'vue';
import { useQuasar } from 'quasar';
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router';
import { useDashboardStore } from 'src/stores/dashboard';
import {
  DashboardPreview,
  ChangePasswordModal,
  DeleteAccountModal,
} from 'src/components/dashboard';

const ProfileTab = defineAsyncComponent(() => import('src/components/dashboard/ProfileTab.vue'));
const AppearanceTab = defineAsyncComponent(
  () => import('src/components/dashboard/AppearanceTab.vue'),
);
const EffectsTab = defineAsyncComponent(() => import('src/components/dashboard/EffectsTab.vue'));
const CardTab = defineAsyncComponent(() => import('src/components/dashboard/CardTab.vue'));
const SocialTab = defineAsyncComponent(() => import('src/components/dashboard/SocialTab.vue'));
const PresetsTab = defineAsyncComponent(() => import('src/components/dashboard/PresetsTab.vue'));
const AccountTab = defineAsyncComponent(() => import('src/components/dashboard/AccountTab.vue'));
const AppTab = defineAsyncComponent(() => import('src/components/dashboard/AppTab.vue'));
const ThemeTab = defineAsyncComponent(() => import('src/components/dashboard/ThemeTab.vue'));
const PerformanceTab = defineAsyncComponent(
  () => import('src/components/dashboard/PerformanceTab.vue'),
);
const PrivacyTab = defineAsyncComponent(() => import('src/components/dashboard/PrivacyTab.vue'));
const WatcherTab = defineAsyncComponent(() => import('src/components/dashboard/WatcherTab.vue'));
const SecurityTab = defineAsyncComponent(() => import('src/components/dashboard/SecurityTab.vue'));

const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const dashboardStore = useDashboardStore();
const theme = useThemeStore();

const activeTab = ref('profile');
const dashboardContentRef = ref<HTMLElement | null>(null);
const sectionListRef = ref<HTMLElement | null>(null);
interface SectionLink {
  label: string;
  card: HTMLElement;
  heading: HTMLElement;
}
const sectionLinks = shallowRef<SectionLink[]>([]);
const activeSection = ref(0);
let sectionObserver: MutationObserver | null = null;
let sectionFrame = 0;
let scrollFrame = 0;
let sectionScrollTimer: ReturnType<typeof setTimeout> | undefined;
let isNavigatingToSection = false;
let sectionHighlightTimer: ReturnType<typeof setTimeout> | undefined;
let highlightedSectionCard: HTMLElement | null = null;
const showChangePasswordModal = ref(false);
const showDeleteAccountModal = ref(false);
const showLeavePrompt = ref(false);
const searchQuery = ref('');
const highlightedField = ref('');
const searchInputRef = ref<{ focus: () => void } | null>(null);
const pendingLeaveTarget = ref<string | null>(null);
const isResolvingLeavePrompt = ref(false);
const leavePromptAction = ref<'save' | 'revert' | null>(null);

// Drawer state and sidebar props management
const setDashboardSidebarProps = inject<(props: Record<string, unknown>) => void>(
  'setDashboardSidebarProps',
  () => {},
);

// --- Tab definitions ---
// Tab definitions
const profileTabs = [
  { id: 'profile', label: 'my profile', icon: 'fas fa-user-circle' },
  { id: 'appearance', label: 'appearance', icon: 'fas fa-palette' },
  { id: 'effects', label: 'effects', icon: 'fas fa-magic' },
];

const customizationTabs = [
  { id: 'card', label: 'profile card', icon: 'fas fa-id-card' },
  { id: 'social', label: 'links & socials', icon: 'fas fa-share-alt' },
  { id: 'presets', label: 'presets', icon: 'fas fa-clone' },
];

const settingsTabs = [
  ...(THEME_ENABLED ? [{ id: 'theme', label: 'client theme', icon: 'fas fa-palette' }] : []),
  { id: 'app', label: 'app', icon: 'fas fa-desktop' },
  { id: 'account', label: 'account', icon: 'fas fa-cog' },
  { id: 'performance', label: 'performance', icon: 'fas fa-bolt' },
  { id: 'privacy', label: 'privacy', icon: 'fas fa-shield' },
  { id: 'watcher', label: 'watcher', icon: 'fas fa-shield-alt' },
  { id: 'security', label: 'security', icon: 'fas fa-shield-halved' },
];

const activeTabLabel = computed(
  () =>
    [...profileTabs, ...customizationTabs, ...settingsTabs].find(
      (tab) => tab.id === activeTab.value,
    )?.label ?? 'my profile',
);

// --- Search ---
const searchableFields = [
  { keywords: ['display name', 'name', 'username'], tab: 'profile', field: 'display-name' },
  { keywords: ['bio', 'about', 'description'], tab: 'profile', field: 'bio' },
  {
    keywords: ['profile picture', 'avatar', 'photo', 'pfp'],
    tab: 'profile',
    field: 'profile-picture',
  },
  { keywords: ['shape', 'circle', 'square'], tab: 'profile', field: 'profile-picture-shape' },
  { keywords: ['location', 'country'], tab: 'profile', field: 'location' },
  { keywords: ['timezone', 'time zone'], tab: 'profile', field: 'timezone' },
  { keywords: ['pronouns'], tab: 'profile', field: 'pronouns' },
  { keywords: ['birthday', 'birth date', 'age'], tab: 'profile', field: 'birthday' },
  { keywords: ['background', 'bg', 'wallpaper'], tab: 'appearance', field: 'background' },
  { keywords: ['background image', 'bg image'], tab: 'appearance', field: 'background-image' },
  {
    keywords: ['background gif', 'animated background', 'bg gif'],
    tab: 'appearance',
    field: 'background-gif',
  },
  { keywords: ['opacity', 'transparency'], tab: 'appearance', field: 'background-opacity' },
  { keywords: ['blur', 'background blur'], tab: 'appearance', field: 'background-blur' },
  { keywords: ['font', 'typography', 'text font'], tab: 'appearance', field: 'font' },
  { keywords: ['accent', 'accent color', 'theme color'], tab: 'appearance', field: 'accent-color' },
  { keywords: ['text color', 'font color'], tab: 'appearance', field: 'text-color' },
  {
    keywords: ['entrance', 'overlay', 'splash', 'click to enter'],
    tab: 'effects',
    field: 'entrance-overlay',
  },
  { keywords: ['cursor', 'mouse'], tab: 'effects', field: 'cursor' },
  { keywords: ['audio', 'music', 'song', 'sound'], tab: 'effects', field: 'audio' },
  { keywords: ['particles', 'snow', 'rain', 'stars'], tab: 'effects', field: 'particles' },
  { keywords: ['animations', 'animate'], tab: 'effects', field: 'animations' },
  { keywords: ['card', 'card background', 'profile card'], tab: 'card', field: 'card-background' },
  {
    keywords: ['card visibility', 'show card', 'hide card'],
    tab: 'card',
    field: 'card-visibility',
  },
  { keywords: ['card border', 'border'], tab: 'card', field: 'card-border' },
  { keywords: ['card opacity'], tab: 'card', field: 'card-opacity' },
  { keywords: ['card blur'], tab: 'card', field: 'card-blur' },
  { keywords: ['social', 'social links'], tab: 'social', field: 'social-links' },
  {
    keywords: ['links', 'link list', 'linktree', 'link in bio'],
    tab: 'social',
    field: 'profile-links',
  },
  { keywords: ['link layout', 'button style', 'link order'], tab: 'social', field: 'links-layout' },
  { keywords: ['display', 'classic', 'icon row'], tab: 'social', field: 'links-display' },
  { keywords: ['discord'], tab: 'social', field: 'discord' },
  { keywords: ['twitter', 'x'], tab: 'social', field: 'twitter' },
  { keywords: ['instagram', 'ig'], tab: 'social', field: 'instagram' },
  { keywords: ['github'], tab: 'social', field: 'github' },
  { keywords: ['youtube'], tab: 'social', field: 'youtube' },
  { keywords: ['tiktok'], tab: 'social', field: 'tiktok' },
  { keywords: ['spotify'], tab: 'social', field: 'spotify' },
  { keywords: ['custom link', 'custom url'], tab: 'social', field: 'custom-link' },
  { keywords: ['password', 'change password', 'security'], tab: 'account', field: 'security' },
  { keywords: ['delete account', 'remove account'], tab: 'account', field: 'danger-zone' },
  { keywords: ['email'], tab: 'account', field: 'email' },
  { keywords: ['watcher', 'security log', 'security'], tab: 'watcher', field: 'watcher-level' },
  {
    keywords: ['alert email', 'security email', 'watcher email'],
    tab: 'watcher',
    field: 'watcher-alert-email',
  },
  { keywords: ['security logs', 'watcher logs'], tab: 'watcher', field: 'watcher-logs' },
  {
    keywords: ['devices', 'sessions', 'log out session', 'security'],
    tab: 'security',
    field: 'security-sessions',
  },
];

// Search results - must be defined BEFORE sidebarProps uses it
const searchResults = computed(() => {
  if (!searchQuery.value.trim()) return [];
  const q = searchQuery.value.toLowerCase();
  return searchableFields.filter((item) =>
    item.keywords.some((kw) => kw.includes(q) || q.includes(kw)),
  );
});

const hasUnsavedProfileChanges = computed(
  () => dashboardStore.hasUnsavedChanges || dashboardStore.isDirty,
);
const hasUnsavedDashboardChanges = computed(
  () => hasUnsavedProfileChanges.value || (THEME_ENABLED && theme.dirty),
);

// Create sidebar props object
const sidebarProps = computed(() => ({
  dashboardStore,
  searchQuery: searchQuery.value,
  searchResults: searchResults.value,
  activeTab: activeTab.value,
  profileTabs,
  customizationTabs,
  settingsTabs,
  'onUpdate:searchQuery': (val: string | number | null) => {
    searchQuery.value = String(val ?? '');
  },
  'onUpdate:activeTab': (tabId: string) => {
    activeTab.value = tabId;
  },
  onNavigateResult: (result: { tab: string; field: string }) => {
    navigateToResult(result);
    searchQuery.value = '';
  },
  onSaveChanges: () => {
    void saveChanges();
  },
  onSearchFocus: (inputRef: { focus: () => void }) => {
    searchInputRef.value = inputRef;
  },
}));

const dashboardTabIds = new Set([
  ...profileTabs.map((tab) => tab.id),
  ...customizationTabs.map((tab) => tab.id),
  ...settingsTabs.map((tab) => tab.id),
]);

watch(
  () => route.query.tab,
  (tab) => {
    if (typeof tab !== 'string' || !dashboardTabIds.has(tab)) return;
    if (tab !== activeTab.value) {
      activeTab.value = tab;
    }
  },
  { immediate: true },
);

watch(activeTab, (tab) => {
  cancelSectionNavigation();
  dashboardContentRef.value?.scrollTo({ top: 0, behavior: 'auto' });
  sectionLinks.value = [];
  activeSection.value = 0;
  if (route.query.tab === tab) return;
  void router.replace({ query: { ...route.query, tab } });
});

function updateActiveSection() {
  const content = dashboardContentRef.value;
  if (isNavigatingToSection || !content || !sectionLinks.value.length) return;
  if (
    content.scrollHeight > content.clientHeight + 4 &&
    content.scrollTop + content.clientHeight >= content.scrollHeight - 4
  ) {
    activeSection.value = sectionLinks.value.length - 1;
    return;
  }
  const threshold = content.getBoundingClientRect().top + 24;
  let current = 0;
  sectionLinks.value.forEach((section, index) => {
    if (section.card.getBoundingClientRect().top <= threshold) current = index;
  });
  activeSection.value = current;
}

watch(activeSection, async (index) => {
  await nextTick();
  const list = sectionListRef.value;
  const button = list?.querySelectorAll<HTMLElement>('button')[index];
  if (!list || !button) return;
  const left = button.offsetLeft - list.offsetLeft;
  if (left < list.scrollLeft) {
    list.scrollTo({ left, behavior: 'auto' });
  } else if (left + button.offsetWidth > list.scrollLeft + list.clientWidth) {
    list.scrollTo({ left: left + button.offsetWidth - list.clientWidth, behavior: 'auto' });
  }
});

function cancelSectionNavigation() {
  if (sectionScrollTimer) clearTimeout(sectionScrollTimer);
  sectionScrollTimer = undefined;
  isNavigatingToSection = false;
}

function scheduleSectionNavigationEnd() {
  if (sectionScrollTimer) clearTimeout(sectionScrollTimer);
  sectionScrollTimer = setTimeout(() => {
    cancelSectionNavigation();
    updateActiveSection();
  }, 180);
}

function onMainScroll() {
  if (isNavigatingToSection) {
    scheduleSectionNavigationEnd();
    return;
  }
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    updateActiveSection();
  });
}

function collectSections() {
  const content = dashboardContentRef.value;
  if (!content) return;
  sectionLinks.value = Array.from(content.querySelectorAll<HTMLElement>('.dash-card'))
    .filter((card) => !card.parentElement?.closest('.dash-card'))
    .flatMap((card) => {
      const heading = card.querySelector<HTMLElement>('.dash-section-title, .section-title');
      const label = heading?.textContent?.trim();
      return heading && label ? [{ label, card, heading }] : [];
    });
  updateActiveSection();
}

function scheduleSectionRefresh() {
  if (sectionFrame) return;
  sectionFrame = requestAnimationFrame(() => {
    sectionFrame = 0;
    collectSections();
  });
}

function goToSection(index: number) {
  const content = dashboardContentRef.value;
  const section = sectionLinks.value[index];
  if (!content || !section) return;
  const top =
    content.scrollTop +
    section.card.getBoundingClientRect().top -
    content.getBoundingClientRect().top -
    20;
  isNavigatingToSection = true;
  activeSection.value = index;
  scheduleSectionNavigationEnd();
  content.scrollTo({
    top: Math.max(0, top),
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
  if (sectionHighlightTimer) clearTimeout(sectionHighlightTimer);
  highlightedSectionCard?.classList.remove('is-section-target');
  section.card.classList.add('is-section-target');
  section.card.setAttribute('tabindex', '-1');
  section.card.focus({ preventScroll: true });
  highlightedSectionCard = section.card;
  sectionHighlightTimer = setTimeout(() => {
    section.card.classList.remove('is-section-target');
    highlightedSectionCard = null;
    sectionHighlightTimer = undefined;
  }, 3000);
}

onBeforeRouteLeave((to) => {
  if (isResolvingLeavePrompt.value || !hasUnsavedDashboardChanges.value) {
    return true;
  }

  pendingLeaveTarget.value = to.fullPath;
  showLeavePrompt.value = true;
  return false;
});

// Keep MainLayout sidebar/drawer in sync with current dashboard state
watch(
  () => sidebarProps.value,
  () => {
    setDashboardSidebarProps(sidebarProps.value);
  },
  { immediate: true, deep: true },
);

// Keyboard shortcut handler for Ctrl+F
function handleKeydown(e: KeyboardEvent) {
  if (e.ctrlKey && e.key === 'f') {
    e.preventDefault();
    searchInputRef.value?.focus();
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('beforeunload', handleBeforeUnload);
  await nextTick();
  if (dashboardContentRef.value) {
    sectionObserver = new MutationObserver(scheduleSectionRefresh);
    sectionObserver.observe(dashboardContentRef.value, { childList: true, subtree: true });
    scheduleSectionRefresh();
  }
  await dashboardStore.fetchDashboardData();
});

onUnmounted(() => {
  sectionObserver?.disconnect();
  if (sectionFrame) cancelAnimationFrame(sectionFrame);
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
  cancelSectionNavigation();
  if (sectionHighlightTimer) clearTimeout(sectionHighlightTimer);
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('beforeunload', handleBeforeUnload);
  if (THEME_ENABLED && theme.dirty) theme.cancel();
});

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasUnsavedDashboardChanges.value) return;

  event.preventDefault();
  event.returnValue = '';
}

function cancelLeavePrompt() {
  pendingLeaveTarget.value = null;
  showLeavePrompt.value = false;
}

async function resolveLeavePrompt(action: 'save' | 'revert') {
  const target = pendingLeaveTarget.value;
  if (!target) {
    cancelLeavePrompt();
    return;
  }

  isResolvingLeavePrompt.value = true;
  leavePromptAction.value = action;

  try {
    if (action === 'save') {
      const saved = await saveChanges();
      if (!saved) {
        return;
      }
    } else {
      if (hasUnsavedProfileChanges.value) dashboardStore.revertChanges();
      if (THEME_ENABLED && theme.dirty) theme.cancel();
    }

    showLeavePrompt.value = false;
    pendingLeaveTarget.value = null;

    await router.push(target);
  } finally {
    leavePromptAction.value = null;
    isResolvingLeavePrompt.value = false;
  }
}

// Navigate to a search result
function navigateToResult(result: { tab: string; field: string }) {
  activeTab.value = result.tab;
  highlightedField.value = result.field;
  setTimeout(() => {
    highlightedField.value = '';
  }, 3000);
  void nextTick(() => {
    const el = document.querySelector(`[data-field="${result.field}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('field-highlight');
      setTimeout(() => el.classList.remove('field-highlight'), 3000);
    }
  });
}

watch(searchResults, (results) => {
  if (results.length === 1 && results[0]) {
    navigateToResult(results[0]);
    searchQuery.value = '';
  }
});

// --- Provide to children ---
provide('highlightedField', highlightedField);
provide('openChangePasswordModal', () => {
  showChangePasswordModal.value = true;
});
provide('openDeleteAccountModal', () => {
  showDeleteAccountModal.value = true;
});

// --- Save ---
async function saveChanges() {
  let success = true;
  let error = '';
  try {
    if (hasUnsavedProfileChanges.value) {
      success = await dashboardStore.saveProfile();
      if (!success) error = dashboardStore.error || 'Failed to save profile changes';
    }
    if (success && THEME_ENABLED && theme.dirty) {
      await theme.save();
      // Account sync may remain pending after a successful local commit.
      success = !theme.dirty;
      if (!success) error = theme.error || 'Failed to save theme changes';
    }
  } catch {
    success = false;
    error = 'Failed to save changes. Your unsaved changes are still here.';
  }
  $q.notify({
    type: success ? 'positive' : 'negative',
    message: success
      ? THEME_ENABLED && theme.pending
        ? 'Changes saved on this device; theme account sync pending.'
        : 'Changes saved successfully'
      : error,
    position: 'bottom-right',
  });

  return success;
}
</script>

<style scoped lang="scss">
.dashboard-main {
  --workspace-gutter: 32px;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  padding-top: 0;
}

.dashboard-workspace {
  position: relative;
  z-index: 5;
  margin: 0 calc(-1 * var(--workspace-gutter)) 15px;
  padding: 0 var(--workspace-gutter);
  border-bottom: 1px solid #292929;
  background: #000;
  isolation: isolate;
}

.dashboard-workspace__inner {
  max-width: 960px;
  margin: 0 auto;
}

.dashboard-workspace__bar {
  display: flex;
  min-height: 52px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.dashboard-workspace__title {
  color: #f0f0f0;
  font-size: 14px;
  font-weight: 600;
}

.dashboard-workspace__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;

  color: #a6a6a6;
  font-size: 11px;
  white-space: nowrap;
}

.dashboard-workspace__status::before {
  width: 6px;
  height: 6px;
  background: #777;
  content: '';
}

.dashboard-workspace__status.is-dirty::before {
  background: var(--primary);
}

.dashboard-workspace__sections {
  display: flex;
  min-width: 0;
  align-items: center;
  border-top: 1px solid #1d1d1d;
}

.dashboard-workspace__section-list {
  display: flex;
  min-width: 0;
  flex: 1;
  gap: 16px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.dashboard-workspace__section-list button {
  min-height: 42px;
  flex-shrink: 0;
  padding: 10px 2px 8px;
  border: 0;
  border-bottom: 2px solid transparent;
  color: #aaa;
  background: transparent;
  font: inherit;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color 160ms ease,
    border-color 160ms ease;
}

.dashboard-workspace__section-list button:hover {
  color: #d0d0d0;
}

.dashboard-workspace__section-list button.is-current {
  border-bottom-color: var(--primary);
  color: #fff;
}

.dashboard-workspace__section-list button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.dashboard-content {
  width: calc(100% + 2 * var(--workspace-gutter));
  min-height: 0;
  flex: 1;
  margin: 0 calc(-1 * var(--workspace-gutter));
  padding: 0 var(--workspace-gutter);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--primary) var(--dash-bg);
}

.dashboard-content::-webkit-scrollbar {
  width: 6px;
}

.dashboard-content::-webkit-scrollbar-track {
  background: var(--dash-bg);
}

.dashboard-content::-webkit-scrollbar-thumb {
  background: var(--primary);
}

.dashboard-content > div {
  max-width: 960px;
  margin: 0 auto;
  padding-bottom: 64px;
}

.dashboard-content :deep(.dash-back-btn) {
  display: none;
}

.dashboard-content :deep(h1) {
  color: #f3f3f3 !important;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.dashboard-content :deep(.dash-section-title),
.dashboard-content :deep(.section-title) {
  color: #e5e5e5;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.dashboard-content :deep(.dash-card > .q-card__section) {
  padding: 22px 24px;
}

.dashboard-content :deep(.dash-card.is-section-target) {
  border-color: var(--primary) !important;
  outline: 2px solid var(--primary);
  outline-offset: 4px;
  animation: field-pulse 0.5s ease-out 3;
}

@media (max-width: 1366px) {
  .dashboard-main {
    --workspace-gutter: 24px;
  }
}

@media (max-width: 1280px) {
  .dashboard-main {
    --workspace-gutter: 20px;
  }
}

@media (max-width: 1024px) {
  .dashboard-main {
    --workspace-gutter: 24px;
  }
}

@media (max-width: 768px) {
  .dashboard-main {
    --workspace-gutter: 16px;
  }
}

@media (max-width: 760px) {
  .dashboard-workspace__bar {
    min-height: 48px;
  }

  .dashboard-workspace__section-list button {
    min-height: 44px;
  }

  .dashboard-content :deep(.dash-card > .q-card__section) {
    padding: 18px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dashboard-workspace__section-list button {
    transition: none;
  }

  .dashboard-content :deep(.dash-card.is-section-target) {
    animation: none;
  }
}
</style>
