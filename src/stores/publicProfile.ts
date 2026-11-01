import { defineStore } from 'pinia';
import { api } from 'boot/axios';
import type { Profile } from 'src/types/profile';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PublicProfileUser {
  id: string;
  username: string;
  createdAt: string;
  isDonator: boolean;
  referralCount: number;
  emailVerified: boolean;
}

interface PublicProfileState {
  profileUser: PublicProfileUser | null;
  profile: Profile | null;
  viewToken: string | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

export const usePublicProfileStore = defineStore('publicProfile', {
  state: (): PublicProfileState => ({
    profileUser: null,
    profile: null,
    viewToken: null,
    loading: false,
    notFound: false,
    error: null,
  }),

  getters: {
    username: (state) => state.profileUser?.username ?? '',
    hasProfile: (state) => state.profile !== null && state.profileUser !== null,
  },

  actions: {
    /**
     * Fetch a public profile by username.
     * Called from preFetch (SSR) and on client-side navigation.
     */
    async fetchPublicProfile(username: string) {
      const normalizedUsername = username.toLowerCase();
      const currentUsername = this.profileUser?.username?.toLowerCase();

      // If we already have the profile data for this user, DO NOTHING.
      // This preserves SSR data and prevents the "wipe."
      if (currentUsername === normalizedUsername && this.profile) {
        return;
      }

      // Only show loading if we are actually switching users or starting fresh
      this.loading = true;
      this.notFound = false;
      this.error = null;

      try {
        // Fetch both profile and leaderboard data in parallel
        const [profileRes, leaderboardRes] = await Promise.all([
          api.get(`/api/v1/profiles/${encodeURIComponent(username)}`),
          api.get(`/api/v1/public/leaderboard?limit=100&sort=referrals`).catch(() => null),
        ]);

        if (profileRes.data.success && profileRes.data.data) {
          this.profileUser = profileRes.data.data.user;
          this.profile = profileRes.data.data.profile;
          this.viewToken = profileRes.data.data.viewToken ?? null;

          // Merge leaderboard data for accurate referral/reputation counts
          if (leaderboardRes?.data?.success) {
            const userStats = leaderboardRes.data.data.find(
              (u: { username: string }) => u.username.toLowerCase() === normalizedUsername,
            );
            if (userStats && this.profileUser) {
              // Use leaderboard values as they're more up-to-date
              this.profileUser.referralCount =
                userStats.referrals ?? this.profileUser.referralCount;
              // Also update reputation/contribution if available
              if (this.profile) {
                this.profile.reputation = userStats.reputation ?? this.profile.reputation;
                this.profile.contribution = userStats.contribution ?? this.profile.contribution;
              }
            }
          }
        } else {
          this.notFound = true;
        }
      } catch (err: unknown) {
        if (import.meta.env.SSR) {
          console.error(`[SSR] Profile fetch failed for ${username}:`, err);
        }
        const resp = (err as { response?: { status?: number } })?.response;
        if (resp?.status === 404) {
          this.notFound = true;
        } else {
          this.error = 'Failed to load profile';
        }
      } finally {
        this.loading = false;
      }
    },

    /** Reset the store to its initial state. */
    $reset() {
      this.profileUser = null;
      this.profile = null;
      this.viewToken = null;
      this.loading = false;
      this.notFound = false;
      this.error = null;
    },

    /**
     * Drop any cached profile data so the NEXT call to fetchPublicProfile
     * actually hits the API. Used after a profile save so edits appear
     * immediately when navigating back to the public profile page (instead
     * of reusing the stale SSR/navigation-cached snapshot).
     */
    invalidate() {
      this.profile = null;
      this.profileUser = null;
      this.viewToken = null;
    },
  },
});
