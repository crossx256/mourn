// =============================================
// useNavigation — Global nav state & actions
// =============================================
// Manages shared navigation state consumed by MainLayout:
//   • Mobile search expansion toggle
//   • Global drawer open/close
//   • Notification badge count
//   • Logout action
//   • Navigation helpers (goGraveyard, etc.)

import { ref, computed } from 'vue';
import { useQuasar } from 'quasar';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from 'src/stores/auth';
import { useGraveyardStore } from 'src/stores/graveyard';
import { useNotificationsStore } from 'src/stores/notifications';
import { api } from 'boot/axios';

// ───── Module-level shared state ─────
// Intentionally outside the function so all component instances share
// the same nav state (singleton). Safe for SPA; search UI is client-only.

/** Mobile search bar expanded */
const isSearchExpanded = ref(false);

/** Global mobile drawer */
const isDrawerOpen = ref(false);

/** Notification count (desktop/Tauri only) */
const notificationCount = ref(0);

/** Search query bound to the header search input */
const searchQuery = ref('');

/** Search results from API for dropdown */
const searchResults = ref<
  Array<{
    id: string;
    username: string;
    profile?: { displayName?: string; profilePicture?: string };
  }>
>([]);

/** Whether a search request is in-flight */
const isSearching = ref(false);

/** Whether the desktop search input is focused (controls dropdown visibility) */
const isSearchFocused = ref(false);

/** Blur timeout handle so clicks on dropdown items still register */
let searchBlurTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounce timer for search */
let searchTimer: ReturnType<typeof setTimeout> | null = null;

/** Track in-flight link requests from header search */
const linkRequesting = ref<Record<string, boolean>>({});

/**
 * Called by MainLayout when mounted to register the focus handler for the
 * desktop search input. Any page can then call focusDesktopSearch() to
 * programmatically focus the always-visible header search bar.
 */
let _focusDesktopSearchFn: (() => void) | null = null;

export function useNavigation() {
  const router = useRouter();
  const route = useRoute();
  const authStore = useAuthStore();
  const graveyardStore = useGraveyardStore();
  const notificationsStore = useNotificationsStore();
  const $q = useQuasar();

  // ───── Computed (route-dependent, must stay inside function) ─────

  /** Dashboard route detection */
  const isDashboardRoute = computed(() => route.path.startsWith('/dashboard'));

  // ───── Actions ─────

  /** Open the mobile search bar (expands it without toggle) */
  function openSearch() {
    isSearchExpanded.value = true;
    // On desktop the search input is always visible — focus it directly
    _focusDesktopSearchFn?.();
  }

  /** Called by MainLayout on mount to register the desktop input focus handler */
  function registerDesktopSearchFocus(fn: () => void) {
    _focusDesktopSearchFn = fn;
  }

  function toggleSearch() {
    isSearchExpanded.value = !isSearchExpanded.value;
    if (!isSearchExpanded.value) {
      searchQuery.value = '';
      searchResults.value = [];
    }
  }

  function closeSearch() {
    isSearchExpanded.value = false;
    searchQuery.value = '';
    searchResults.value = [];
    isSearchFocused.value = false;
  }

  function toggleDrawer() {
    isDrawerOpen.value = !isDrawerOpen.value;
  }

  function closeDrawer() {
    isDrawerOpen.value = false;
  }

  async function handleLogout() {
    const success = await authStore.logout();
    closeSearch();
    closeDrawer();
    void router.push('/login');
    return success;
  }

  function goGraveyard() {
    graveyardStore.requestRitual();
    void router.push('/graveyard');
  }

  async function onSearchInput(query: string) {
    searchQuery.value = query;

    if (searchTimer) clearTimeout(searchTimer);

    // Real accounts exist with 1- and 2-character usernames ('o', 'l'). The
    // backend answers a <3-character query with EXACT matches only (see
    // routes/api/v1/search.routes.js — `exactOnly = query.length <= 2`) and
    // partial `contains` matching resumes at 3+. So a single character is a
    // legitimate query and must not be swallowed here; only an empty input is.
    if (!query || query.trim().length < 1) {
      searchResults.value = [];
      isSearching.value = false;
      return;
    }

    isSearching.value = true;

    searchTimer = setTimeout(async () => {
      try {
        const res = await api.get('/api/v1/search/users', {
          params: { q: query.trim() },
        });
        if (res.data.success) {
          searchResults.value = res.data.data;
        }
      } catch {
        searchResults.value = [];
      } finally {
        isSearching.value = false;
      }
    }, 300);
  }

  function navigateToUser(username: string) {
    searchQuery.value = '';
    searchResults.value = [];
    isSearchExpanded.value = false;
    isSearchFocused.value = false;
    void router.push(`/${username}`);
  }

  function onSearchFocus() {
    if (searchBlurTimer) {
      clearTimeout(searchBlurTimer);
      searchBlurTimer = null;
    }
    isSearchFocused.value = true;
  }

  function onSearchBlur() {
    // Delay clearing focus to allow clicks on results
    searchBlurTimer = setTimeout(() => {
      isSearchFocused.value = false;
    }, 120);
  }

  function isLinkRequesting(userId: string) {
    return !!linkRequesting.value[userId];
  }

  async function requestLink(userId: string) {
    if (!userId) return;
    linkRequesting.value = { ...linkRequesting.value, [userId]: true };
    try {
      const { useLinksStore } = await import('src/stores/links');
      const linksStore = useLinksStore();
      await linksStore.requestLink(userId, false);
      await notificationsStore.fetchNotifications();
      $q.notify({
        message: 'Link request sent',
        position: 'top',
        timeout: 3000,
        color: 'primary',
        textColor: 'black',
        icon: 'mdi-shield-check',
        classes:
          'notify-offset border border-solid border-[var(--primary)] font-mono lowercase tracking-widest text-weight-bold',
      });
    } catch (err: unknown) {
      // Surface the backend error when available (e.g., 403 donor requirement)
      const message =
        (typeof err === 'object' &&
          err !== null &&
          'response' in err &&
          (err as { response?: { data?: { error?: string } } }).response?.data?.error) ||
        (typeof err === 'object' && err !== null && 'message' in err
          ? (err as { message?: string }).message
          : undefined) ||
        'Failed to send link request';
      console.error('Link request failed:', err);
      $q.notify({ type: 'negative', message, position: 'top' });
    } finally {
      const next = { ...linkRequesting.value };
      delete next[userId];
      linkRequesting.value = next;
    }
  }

  async function acceptLink(linkId: string) {
    if (!linkId) {
      $q.notify({ type: 'warning', message: 'Invalid link ID', position: 'top' });
      return;
    }

    try {
      const { useLinksStore } = await import('src/stores/links');
      const linksStore = useLinksStore();
      await linksStore.respondToLink(linkId, 'accept');
      // Remove the notification from local state (backend deletes it too)
      notificationsStore.removeNotificationByLinkId(linkId);
      $q.notify({
        message: 'Link request accepted',
        position: 'top',
        timeout: 2000,
        color: 'positive',
        icon: 'mdi-check-circle',
      });
      // Refresh links to show the new accepted link
      await linksStore.fetchLinks();
    } catch (err: unknown) {
      const message =
        (typeof err === 'object' &&
          err !== null &&
          'response' in err &&
          (err as { response?: { data?: { error?: string } } }).response?.data?.error) ||
        'Failed to accept link request';
      console.error('Accept link failed:', err);
      $q.notify({ type: 'negative', message, position: 'top' });
    }
  }

  async function rejectLink(linkId: string) {
    if (!linkId) {
      $q.notify({ type: 'warning', message: 'Invalid link ID', position: 'top' });
      return;
    }

    try {
      const { useLinksStore } = await import('src/stores/links');
      const linksStore = useLinksStore();
      await linksStore.respondToLink(linkId, 'reject');
      // Remove the notification from local state (backend deletes it too)
      notificationsStore.removeNotificationByLinkId(linkId);
      $q.notify({
        message: 'Link request rejected',
        position: 'top',
        timeout: 2000,
        color: 'negative',
        icon: 'mdi-close-circle',
      });
      // Refresh links
      await linksStore.fetchLinks();
    } catch (err: unknown) {
      const message =
        (typeof err === 'object' &&
          err !== null &&
          'response' in err &&
          (err as { response?: { data?: { error?: string } } }).response?.data?.error) ||
        'Failed to reject link request';
      console.error('Reject link failed:', err);
      $q.notify({ type: 'negative', message, position: 'top' });
    }
  }

  return {
    // State
    isSearchExpanded,
    isDrawerOpen,
    notificationCount,
    searchQuery,
    searchResults,
    isSearching,
    isLinkRequesting,
    isSearchFocused,
    isDashboardRoute,

    // Actions
    openSearch,
    registerDesktopSearchFocus,
    toggleSearch,
    closeSearch,
    toggleDrawer,
    closeDrawer,
    handleLogout,
    goGraveyard,
    onSearchInput,
    navigateToUser,
    requestLink,
    onSearchFocus,
    onSearchBlur,
    acceptLink,
    rejectLink,
  };
}
