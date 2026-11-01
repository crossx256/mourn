import { defineStore } from 'pinia';
import { api } from 'boot/axios';
import type { ProfileLink, ProfileLinkIcon } from 'src/types/profile';
import { useAuthStore } from './auth';
import { captureAccountOperation } from 'src/utils/accountLifecycle';
import { loadRandomizeFileNames, persistRandomizeFileNames } from './dashboardPreferences';
import type { DashboardData, DashboardUser } from 'src/types/dashboard';
import type { Profile } from 'src/types/profile';

// The "anonymous notifications" privacy toggle (GET/PUT).
const NOTIFICATION_PREFERENCES_ENDPOINT = '/api/v1/notifications/preferences';

// Extended profile with frontend-only fields for dashboard customization
interface ExtendedProfile extends Profile {
  // Frontend-only entrance overlay fields
  entranceOverlayEnabled?: boolean;
  entranceOverlayImage?: string | null;
  entranceOverlayText?: string | null;
  entranceOverlayTextColor?: string;
  entranceOverlayTextSize?: number;
  entranceOverlayTextShadowEnabled?: boolean;
  entranceOverlayTextShadowColor?: string;
  entranceOverlayTextShadowBlur?: number;
  // Frontend-only card fields
  showCard?: boolean;
  cardBackgroundImage?: string | null;
  cardWidth?: string | null;
  cardMaxWidth?: string | null;
  cardPadding?: string | null;
  cardMargin?: string | null;
  cardShadowEnabled?: boolean;
  cardShadowColor?: string;
  cardShadowX?: number;
  cardShadowY?: number;
  cardShadowBlur?: number;
  cardShadowSpread?: number;
  cardGlowEnabled?: boolean;
  cardGlowIntensity?: number;
  // Frontend-only music fields
  musicEnabled?: boolean;
  musicVolume?: number;
  musicAutoplay?: boolean;
  musicLoop?: boolean;
  // Frontend-only meta fields
  metaTitle?: string | null;
  metaDescription?: string | null;
  metaImage?: string | null;
}

// Default profile values matching the old dashboard
const DEFAULT_PROFILE: ExtendedProfile = {
  id: '',
  userId: '',
  displayName: null,
  bio: null,
  profilePicture: null,
  profilePictureShape: 'circle',
  profilePictureRadius: 'inherit',
  profilePictureBorder: true,
  // Visibility Controls
  showHandle: true,
  showProfilePicture: true,
  views: 0,
  reputation: 0,
  contribution: 0,
  viewHistory: null,
  showViews: true,
  showReputation: true,
  showMemberSince: true,
  showReferrals: true,
  // Entrance Overlay (Prisma fields)
  showEntranceOverlay: false,
  entranceText: 'click to enter',
  entranceTextFont: 'Sour Gummy',
  entranceTextColor: '#ffffff',
  entranceOverlayColor: '#000000',
  entranceOverlayOpacity: 0.9,
  // Frontend-only entrance overlay extensions
  entranceOverlayImage: null,
  entranceOverlayText: null,
  entranceOverlayTextColor: '#ffffff',
  entranceOverlayTextSize: 24,
  entranceOverlayTextShadowEnabled: false,
  entranceOverlayTextShadowColor: '#000000',
  entranceOverlayTextShadowBlur: 10,
  // Backgrounds
  backgroundColor: '#1a1a1a',
  backgroundGradient: null,
  backgroundImage: null,
  backgroundGif: null,
  backgroundVideo: null,
  backgroundOpacity: 1.0,
  backgroundBlur: 0,
  // Borders
  borderColor: '#ffffff',
  borderRadius: '0px',
  borderStyle: 'solid',
  borderGradient: null,
  borderTarget: 'card',
  showBorders: false,
  showCard: true,
  showCardBorders: true,
  cardBorderColor: '#1a1a1a',
  cardBorderRadius: '8px',
  cardBorderStyle: 'solid',
  cardBorderWidth: 1,
  cardBorderGradient: null,
  cardBackgroundImage: null,
  cardBackgroundColor: '#000000',
  cardOpacity: 1.0,
  cardBlur: 0,
  cardWidth: null,
  cardMaxWidth: null,
  cardPadding: null,
  cardMargin: null,
  // Card Shadow
  cardShadowEnabled: false,
  cardShadowColor: '#000000',
  cardShadowX: 0,
  cardShadowY: 4,
  cardShadowBlur: 10,
  cardShadowSpread: 0,
  // Card Glow
  cardGlowEnabled: false,
  cardGlowColor: '#ff0000',
  cardGlowIntensity: 20,
  enableTiltEffect: false,
  // Socials
  socialLinks: null,
  socialIconColor: null,
  socialIconHoverEffect: 'static',
  socialIconSize: 50,
  // v2 profile links ("Linktree-class") — see src/utils/profileLinks.ts
  profileLinks: null,
  linksDisplay: 'classic',
  linksLayout: 'stack',
  linksAlign: 'center',
  linksWidth: 'default',
  linksRadius: null,
  linksColor: null,
  linksBgColor: null,
  linksHoverEffect: 'inherit',
  linksShowTitles: true,
  linksShowThumbs: true,
  linksOpenNewTab: true,
  linksPosition: 'below-bio',
  linksShowClassicIcons: false,
  linksIconPosition: 'left',
  linksGap: 10,
  statsPosition: 'default',
  statsSize: 'normal',
  customCursor: null,
  cursorEffect: null,
  cursorCSS: null,
  cursorSize: 32,
  customFontUrl: null,
  // Badges
  badges: [],
  showBadges: true,
  badgeColor: null,
  badgeSize: 50,
  // Typography
  customFont: null,
  usernameTextColor: '#ffffff',
  usernameFontSize: 32,
  usernameFontWeight: 700,
  usernameLetterSpacing: 'normal',
  usernameGlowColor: null,
  usernameEffects: null,
  usernameTextShadow: 'none',
  usernameTextStroke: 'none',
  usernameEnableShadow: false,
  usernameTextShadowColor: '#000000',
  usernameTextShadowX: 2,
  usernameTextShadowY: 2,
  usernameTextShadowBlur: 4,
  bioTextColor: '#cccccc',
  bioFontSize: 16,
  bioFontWeight: 400,
  bioLetterSpacing: 'normal',
  bioLineHeight: 1.6,
  bioTextShadow: 'none',
  bioTextStroke: 'none',
  bioEnableShadow: false,
  bioTextShadowColor: '#000000',
  bioTextShadowX: 2,
  bioTextShadowY: 2,
  bioTextShadowBlur: 4,
  // Animations (legacy set only: profileAnimation, descriptionAnimation, usernameEffects, titleGlitch)
  descriptionAnimation: 'none',
  profileAnimation: 'none',
  profileLayout: 'default',
  titleGlitch: true,
  titleGlitchSpeed: 1.0,
  showProfilePromo: true,
  // Music
  musicEnabled: false,
  musicUrl: null,
  musicVolume: 0.5,
  musicAutoplay: false,
  musicLoop: true,
  // SEO & Meta
  metaTitle: null,
  metaDescription: null,
  metaImage: null,
  seoTitle: null,
  seoDescription: null,
  showUsernameValue: false,
  usernameValue: null,
  showProfileCard: false,
  // Extra Community
  lftSection: null,
  interlinkProfiles: null,
  favoriteServer: null,
  // Timestamps
  createdAt: '',
  updatedAt: '',
};

interface DashboardState {
  user: DashboardUser | null;
  profile: ExtendedProfile;
  originalProfile: ExtendedProfile;
  presets: ProfilePreset[];
  isLoading: boolean;
  isSaving: boolean;
  isLoadingPresets: boolean;
  hasUnsavedChanges: boolean;
  error: string | null;
  activeTab: string;
  randomizeFileNames: boolean;
  // Privacy: cluster mobile pushes into one generic, content-free notification.
  anonymousNotifications: boolean;
  anonymousNotificationsLoading: boolean;
}

export interface ProfilePreset {
  id: string;
  name: string;
  data: Partial<Profile>;
  createdAt: string;
  updatedAt: string;
}

export const useDashboardStore = defineStore('dashboard', {
  state: (): DashboardState => ({
    user: null,
    profile: { ...DEFAULT_PROFILE },
    originalProfile: { ...DEFAULT_PROFILE },
    presets: [],
    isLoading: false,
    isSaving: false,
    isLoadingPresets: false,
    hasUnsavedChanges: false,
    error: null,
    activeTab: 'profile',
    randomizeFileNames: false,
    anonymousNotifications: false,
    anonymousNotificationsLoading: false,
  }),

  getters: {
    isDonator: (state) => state.user?.isDonator ?? false,
    isAdmin: (state) => state.user?.isAdmin ?? false,
    username: (state) => state.user?.username ?? '',

    // Check if profile has changes
    isDirty: (state) => {
      return JSON.stringify(state.profile) !== JSON.stringify(state.originalProfile);
    },
  },

  actions: {
    // Fetch dashboard data from API
    async fetchDashboardData() {
      const authStore = useAuthStore();

      if (!authStore.isLoggedIn) {
        this.error = 'Not authenticated';
        return false;
      }

      this.isLoading = true;
      this.error = null;

      try {
        await authStore.fetchCsrfToken();

        const response = await api.get('/api/v1/profile/dashboard', {
          headers: { 'X-CSRF-Token': authStore.csrfToken },
        });

        if (response.data.success && response.data.data) {
          const data: DashboardData = response.data.data;

          this.applyDashboardData(data);
          return true;
        }

        this.error = 'Failed to load dashboard data';
        return false;
      } catch (error: unknown) {
        const resp = (error as { response?: { data?: { error?: string } } })?.response;
        this.error = resp?.data?.error || 'Failed to load dashboard data';
        console.error('Dashboard fetch error:', error);
        return false;
      } finally {
        this.isLoading = false;
      }
    },

    // ─── Apply a DashboardData payload into local state. ───
    applyDashboardData(data: DashboardData) {
      this.user = data.user;

      // Merge DB data into our local state
      this.profile = {
        ...DEFAULT_PROFILE,
        ...data.profile,
        // Safely derive the UI state from DB data
        entranceOverlayEnabled: !!data.profile.showEntranceOverlay,
        musicEnabled: !!data.profile.musicUrl,
      };

      this.originalProfile = JSON.parse(JSON.stringify(this.profile));
      this.hasUnsavedChanges = false;
    },

    // Save profile changes
    async saveProfile() {
      const authStore = useAuthStore();

      if (!authStore.isLoggedIn) {
        this.error = 'Not authenticated';
        return false;
      }

      this.isSaving = true;
      this.error = null;

      try {
        await authStore.fetchCsrfToken();

        const generation = authStore.authOperationGeneration;
        const submittedProfile = JSON.parse(JSON.stringify(this.profile)) as Profile;
        const response = await api.post(
          '/api/v1/profile/update',
          { profile: submittedProfile },
          { headers: { 'X-CSRF-Token': authStore.csrfToken } },
        );

        if (response.data.success) {
          if (generation !== authStore.authOperationGeneration) return false;
          this.originalProfile = JSON.parse(JSON.stringify(submittedProfile)) as Profile;
          this.hasUnsavedChanges = JSON.stringify(this.profile) !== JSON.stringify(this.originalProfile);

          // Invalidate the public-profile cache so the change is immediately
          // visible when the user revisits /{username} (no stale snapshot).
          // import inside the method avoids a circular dependency at module load.
          const { usePublicProfileStore } = await import('src/stores/publicProfile');
          usePublicProfileStore().invalidate();

          return true;
        }

        this.error = response.data.error || 'Failed to save profile';
        return false;
      } catch (error: unknown) {
        const resp = (error as { response?: { data?: { error?: string } } })?.response;
        this.error = resp?.data?.error || 'Failed to save profile';
        console.error('Dashboard save error:', error);
        return false;
      } finally {
        this.isSaving = false;
      }
    },

    // Upload file (image, audio, etc.)
    async uploadFile(file: File, fieldName: string): Promise<string | null> {
      const authStore = useAuthStore();

      if (!authStore.isLoggedIn) {
        this.error = 'Not authenticated';
        return null;
      }

      try {
        await authStore.fetchCsrfToken();

        const formData = new FormData();
        formData.append('file', file);
        formData.append('field', fieldName);

        const response = await api.post('/api/v1/profile/upload', formData, {
          params: { field: fieldName },
          headers: {
            'X-CSRF-Token': authStore.csrfToken,
            'X-Upload-Field': fieldName,
          },
        });

        if (response.data.success && response.data.data?.url) {
          return response.data.data.url;
        }

        this.error = response.data.error || 'Upload failed';
        return null;
      } catch (error: unknown) {
        const resp = (error as { response?: { data?: { error?: string } } })?.response;
        this.error = resp?.data?.error || 'Upload failed';
        console.error('Upload error:', {
          field: fieldName,
          status: (error as { response?: { status?: number } })?.response?.status,
          serverError: resp?.data?.error,
          error,
        });
        return null;
      }
    },

    // Revert changes
    revertChanges() {
      this.profile = { ...this.originalProfile };
      this.hasUnsavedChanges = false;
    },

    // Update a single profile field
    updateField<K extends keyof ExtendedProfile>(field: K, value: ExtendedProfile[K]) {
      this.profile[field] = value;
      // Sync entranceOverlayEnabled with showEntranceOverlay (Prisma field)
      if (field === 'entranceOverlayEnabled') {
        this.profile.showEntranceOverlay = Boolean(value);
      }
      if (field === 'musicEnabled' && value === false) {
        this.profile.musicUrl = null; // Tell the DB to stop the music
      }
      this.hasUnsavedChanges = this.isDirty;
    },

    // ─── v2 profile links ───────────────────────────────────────────────
    // Empty list -> null, matching the server's "explicit clear" contract
    // (absent field = leave the stored list alone, null = clear it).
    setProfileLinks(links: ProfileLink[] | null) {
      this.profile.profileLinks = links && links.length ? links : null;
      this.hasUnsavedChanges = this.isDirty;
    },

    addProfileLink(link: ProfileLink) {
      const current = this.profile.profileLinks ?? [];
      this.profile.profileLinks = [...current, link];
      this.hasUnsavedChanges = this.isDirty;
    },

    addProfileLinks(links: ProfileLink[]) {
      if (!links.length) return;
      this.profile.profileLinks = [...(this.profile.profileLinks ?? []), ...links];
      this.hasUnsavedChanges = this.isDirty;
    },

    setLinkStyle(
      field:
        | 'linksDisplay'
        | 'linksLayout'
        | 'linksAlign'
        | 'linksWidth'
        | 'linksRadius'
        | 'linksColor'
        | 'linksBgColor'
        | 'linksHoverEffect'
        | 'linksPosition'
        | 'linksIconPosition'
        | 'linksGap'
        | 'linksShowTitles'
        | 'linksShowThumbs'
        | 'linksOpenNewTab'
        | 'linksShowClassicIcons',
      value: string | number | boolean | null,
    ) {
      // Single assignment point so an unknown key can never smuggle in a value the
      // sanitizer would silently drop on save.
      const allowed = new Set([
        'linksDisplay',
        'linksLayout',
        'linksAlign',
        'linksWidth',
        'linksRadius',
        'linksColor',
        'linksBgColor',
        'linksHoverEffect',
        'linksPosition',
        'linksIconPosition',
        'linksGap',
        'linksShowTitles',
        'linksShowThumbs',
        'linksOpenNewTab',
        'linksShowClassicIcons',
      ]);
      if (!allowed.has(field)) return;
      (this.profile as unknown as Record<string, unknown>)[field] = value;
      this.hasUnsavedChanges = this.isDirty;
    },

    // Update social link
    updateSocialLink(key: string, value: string) {
      if (!this.profile.socialLinks) {
        this.profile.socialLinks = {};
      }
      if (value) {
        this.profile.socialLinks[key] = value;
      } else {
        delete this.profile.socialLinks[key];
      }
      this.hasUnsavedChanges = this.isDirty;
    },

    // Per-platform custom icon for the classic row (null = back to the platform glyph)
    setSocialIcon(key: string, icon: ProfileLinkIcon | null) {
      const icons = { ...(this.profile.socialIcons ?? {}) };
      if (icon && icon.value) icons[key] = icon;
      else delete icons[key];
      this.profile.socialIcons = icons;
      this.hasUnsavedChanges = this.isDirty;
    },

    // Set active tab
    setActiveTab(tab: string) {
      this.activeTab = tab;
    },

    // Set randomize file names preference. L14: this is the one place that
    // writes it, and it persists — the toggle used to be durable only when
    // PrivacyTab's own v-model setter happened to run.
    setRandomizeFileNames(value: boolean) {
      this.randomizeFileNames = value;
      persistRandomizeFileNames(value);
    },

    /** Restore the device-level preference at boot (MessagingPage onMounted). */
    hydrateRandomizeFileNames() {
      this.randomizeFileNames = loadRandomizeFileNames();
    },

    // ─── Anonymous notifications preference (privacy) ──────────────────
    // Load the persisted value when the privacy surface mounts.
    async fetchNotificationPreferences(): Promise<boolean> {
      const authStore = useAuthStore();
      if (!authStore.isLoggedIn) return false;

      this.anonymousNotificationsLoading = true;
      try {
        const { data } = await api.get(NOTIFICATION_PREFERENCES_ENDPOINT);
        if (data?.success && data.data) {
          this.anonymousNotifications = Boolean(data.data.anonymousNotifications);
          return true;
        }
        return false;
      } catch (error) {
        if (import.meta.env.DEV) console.error('Notification preferences fetch failed', error);
        return false;
      } finally {
        this.anonymousNotificationsLoading = false;
      }
    },

    // Optimistic update: flip the toggle immediately, PUT, and revert on
    // failure so the UI can never claim a preference the server did not save.
    async setAnonymousNotifications(value: boolean): Promise<boolean> {
      const authStore = useAuthStore();
      if (!authStore.isLoggedIn) return false;

      const previous = this.anonymousNotifications;
      this.anonymousNotifications = value;
      try {
        await authStore.fetchCsrfToken();
        const { data } = await api.put(
          NOTIFICATION_PREFERENCES_ENDPOINT,
          { anonymousNotifications: value },
          {
            headers: {
              'X-CSRF-Token': authStore.csrfToken,
              'Content-Type': 'application/json',
            },
          },
        );
        if (data?.success && data.data) {
          this.anonymousNotifications = Boolean(data.data.anonymousNotifications);
          return true;
        }
        this.anonymousNotifications = previous;
        return false;
      } catch (error) {
        this.anonymousNotifications = previous;
        if (import.meta.env.DEV) console.error('Notification preferences update failed', error);
        return false;
      }
    },

    // Change password
    async changePassword(
      currentPassword: string,
      newPassword: string,
    ): Promise<{ success: boolean; error?: string }> {
      const authStore = useAuthStore();

      if (!authStore.isLoggedIn) {
        return { success: false, error: 'Not authenticated' };
      }

      try {
        await authStore.fetchCsrfToken();

        const response = await api.post(
          '/api/v1/profile/change-password',
          { currentPassword, newPassword },
          { headers: { 'X-CSRF-Token': authStore.csrfToken } },
        );

        if (response.data.success) {
          if (response.data.reauthenticationRequired) {
            const username = authStore.user?.username;
            if (username) {
              const { useSecureStore } = await import('src/composables/useSecureStore');
              await useSecureStore()
                .removeCredentials(username)
                .catch(() => {});
            }
            await authStore.logout();
          }
          return { success: true };
        }

        return { success: false, error: response.data.error || 'Failed to change password' };
      } catch (error: unknown) {
        const resp = (error as { response?: { data?: { error?: string } } })?.response;
        return { success: false, error: resp?.data?.error || 'Failed to change password' };
      }
    },

    async requestPasswordReset(email: string): Promise<{ success: boolean; error?: string }> {
      const authStore = useAuthStore();

      if (!email) {
        return { success: false, error: 'Email is required' };
      }

      try {
        const response = await api.post(
          '/api/v1/auth/request-password-reset',
          { email },
          { headers: { 'X-CSRF-Token': authStore.csrfToken } },
        );

        if (response.data?.message || response.data?.success !== false) {
          return { success: true };
        }

        return { success: false, error: response.data.error || 'Failed to send reset link' };
      } catch (error: unknown) {
        const resp = (error as { response?: { data?: { error?: string } } })?.response;
        return { success: false, error: resp?.data?.error || 'Failed to send reset link' };
      }
    },

    async requestAccountEmailVerification(
      email: string,
      currentPassword: string,
    ): Promise<{ success: boolean; error?: string }> {
      const authStore = useAuthStore();

      if (!email || !currentPassword) {
        return { success: false, error: 'Email and current password are required' };
      }

      try {
        await authStore.fetchCsrfToken();

        const response = await api.post(
          '/api/v1/profile/request-email-change',
          { email, currentPassword },
          { headers: { 'X-CSRF-Token': authStore.csrfToken } },
        );

        if (response.data?.success) {
          return { success: true };
        }

        return { success: false, error: response.data.error || 'Failed to request email change' };
      } catch (error: unknown) {
        const resp = (error as { response?: { data?: { error?: string } } })?.response;
        return { success: false, error: resp?.data?.error || 'Failed to request email change' };
      }
    },

    async confirmAccountEmailVerification(
      code: string,
    ): Promise<{ success: boolean; error?: string }> {
      const authStore = useAuthStore();

      if (!code) {
        return { success: false, error: 'Verification code is required' };
      }

      try {
        await authStore.fetchCsrfToken();

        const response = await api.post(
          '/api/v1/auth/verify-email-code',
          { code },
          { headers: { 'X-CSRF-Token': authStore.csrfToken } },
        );

        if (response.data?.success) {
          const verifiedEmail = response.data?.data?.email;
          if (this.user) {
            if (verifiedEmail) this.user.email = verifiedEmail;
            this.user.emailVerified = true;
          }
          if (authStore.user) {
            if (verifiedEmail) authStore.user.email = verifiedEmail;
            authStore.user.emailVerified = true;
          }
          if (response.data?.data?.reauthenticationRequired) {
            await authStore.logout();
          }
          return { success: true };
        }

        return { success: false, error: response.data.error || 'Failed to verify email' };
      } catch (error: unknown) {
        const resp = (error as { response?: { data?: { error?: string } } })?.response;
        return { success: false, error: resp?.data?.error || 'Failed to verify email' };
      }
    },

    // Delete account
    async deleteAccount(
      username: string,
      password: string,
      confirmText: string,
    ): Promise<{ success: boolean; error?: string }> {
      const authStore = useAuthStore();

      if (!authStore.isLoggedIn) {
        return { success: false, error: 'Not authenticated' };
      }

      if (confirmText !== 'confirm') {
        return { success: false, error: 'Please type "confirm" to delete your account' };
      }

      if (username !== this.user?.username) {
        return { success: false, error: 'Username does not match' };
      }

      const operation = captureAccountOperation();
      const deletedUserId = operation.uid;
      const deletedUsername = authStore.user?.username;
      let deletedOnServer = false;
      try {
        await operation.wait(() => authStore.fetchCsrfToken());
        const generation = operation.generation;
        const response = await api.post(
          '/api/v1/profile/delete-account',
          { username, password, confirmText },
          { headers: { 'X-CSRF-Token': authStore.csrfToken } },
        );

        if (response.data.success) {
          deletedOnServer = true;
          if (generation !== authStore.authOperationGeneration) return { success: false, error: 'Account deleted on the server. Sign out and remove its saved local account to finish device cleanup.' };
          await authStore.logout();
          if (deletedUserId) {
            const { useVaultStore } = await import('./vault');
            await useVaultStore().clearAllVaultDataForUser(deletedUserId);
          }
          if (deletedUsername) {
            const { useSecureStore } = await import('src/composables/useSecureStore');
            await useSecureStore()
              .removeCredentials(deletedUsername)
              .catch(() => {});
          }
          return { success: true };
        }

        return { success: false, error: response.data.error || 'Failed to delete account' };
      } catch (error: unknown) {
        const resp = (error as { response?: { data?: { error?: string } } })?.response;
        return { success: false, error: deletedOnServer ? 'Account deleted on the server, but device cleanup is incomplete. Remove the saved local account to retry cleanup.' : resp?.data?.error || 'Failed to delete account' };
      }
    },

    // Reset store
    $reset() {
      this.user = null;
      this.profile = { ...DEFAULT_PROFILE };
      this.originalProfile = { ...DEFAULT_PROFILE };
      this.presets = [];
      this.isLoading = false;
      this.isSaving = false;
      this.isLoadingPresets = false;
      this.hasUnsavedChanges = false;
      this.error = null;
      this.activeTab = 'profile';
      // randomizeFileNames is a device-level privacy choice, not account data:
      // $reset runs on logout, and clearing it here silently re-enabled original
      // file names for the next person using the device.
    },

    // ============================================================
    // PROFILE PRESETS — save/apply/delete named customization snapshots
    // ============================================================

    async fetchPresets() {
      const authStore = useAuthStore();
      if (!authStore.isLoggedIn) return false;
      this.isLoadingPresets = true;
      try {
        await authStore.fetchCsrfToken();
        const response = await api.get('/api/v1/profile/presets', {
          headers: { 'X-CSRF-Token': authStore.csrfToken },
        });
        if (response.data?.success) {
          this.presets = response.data.data ?? [];
          return true;
        }
        return false;
      } catch (error: unknown) {
        const resp = (error as { response?: { data?: { error?: string } } })?.response;
        this.error = resp?.data?.error || 'Failed to load presets';
        return false;
      } finally {
        this.isLoadingPresets = false;
      }
    },

    async createPreset(name: string) {
      const authStore = useAuthStore();
      if (!authStore.isLoggedIn) return { success: false, error: 'Not authenticated' };
      try {
        await authStore.fetchCsrfToken();
        const response = await api.post(
          '/api/v1/profile/presets',
          { name, data: this.profile },
          { headers: { 'X-CSRF-Token': authStore.csrfToken } },
        );
        if (response.data?.success) {
          await this.fetchPresets();
          return { success: true, data: response.data.data };
        }
        return { success: false, error: response.data?.error || 'Failed to save preset' };
      } catch (error: unknown) {
        const resp = (error as { response?: { data?: { error?: string } } })?.response;
        return { success: false, error: resp?.data?.error || 'Failed to save preset' };
      }
    },

    async updatePreset(id: string, patch: { name?: string; data?: Partial<Profile> }) {
      const authStore = useAuthStore();
      if (!authStore.isLoggedIn) return { success: false, error: 'Not authenticated' };
      try {
        await authStore.fetchCsrfToken();
        const response = await api.patch(`/api/v1/profile/presets/${id}`, patch, {
          headers: { 'X-CSRF-Token': authStore.csrfToken },
        });
        if (response.data?.success) {
          await this.fetchPresets();
          return { success: true, data: response.data.data };
        }
        return { success: false, error: response.data?.error || 'Failed to update preset' };
      } catch (error: unknown) {
        const resp = (error as { response?: { data?: { error?: string } } })?.response;
        return { success: false, error: resp?.data?.error || 'Failed to update preset' };
      }
    },

    async deletePreset(id: string) {
      const authStore = useAuthStore();
      if (!authStore.isLoggedIn) return { success: false, error: 'Not authenticated' };
      try {
        await authStore.fetchCsrfToken();
        const response = await api.delete(`/api/v1/profile/presets/${id}`, {
          headers: { 'X-CSRF-Token': authStore.csrfToken },
        });
        if (response.data?.success) {
          await this.fetchPresets();
          return { success: true };
        }
        return { success: false, error: response.data?.error || 'Failed to delete preset' };
      } catch (error: unknown) {
        const resp = (error as { response?: { data?: { error?: string } } })?.response;
        return { success: false, error: resp?.data?.error || 'Failed to delete preset' };
      }
    },

    async applyPreset(id: string) {
      const authStore = useAuthStore();
      if (!authStore.isLoggedIn) return { success: false, error: 'Not authenticated' };
      try {
        await authStore.fetchCsrfToken();
        const response = await api.post(
          `/api/v1/profile/presets/${id}/apply`,
          {},
          { headers: { 'X-CSRF-Token': authStore.csrfToken } },
        );
        if (response.data?.success && response.data.data?.profile) {
          // Reflect the applied preset in the local editing state immediately.
          this.profile = {
            ...DEFAULT_PROFILE,
            ...response.data.data.profile,
            entranceOverlayEnabled: !!response.data.data.profile.showEntranceOverlay,
            musicEnabled: !!response.data.data.profile.musicUrl,
          };
          this.originalProfile = JSON.parse(JSON.stringify(this.profile));
          this.hasUnsavedChanges = false;
          const { usePublicProfileStore } = await import('src/stores/publicProfile');
          usePublicProfileStore().invalidate();
          return { success: true };
        }
        return { success: false, error: response.data?.error || 'Failed to apply preset' };
      } catch (error: unknown) {
        const resp = (error as { response?: { data?: { error?: string } } })?.response;
        return { success: false, error: resp?.data?.error || 'Failed to apply preset' };
      }
    },
  },
});
