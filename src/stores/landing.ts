import { defineStore } from 'pinia';
import { api } from 'src/boot/axios';
import type { Announcement } from 'src/types/system';
import type { LeaderboardProfile } from 'src/types/leaderboard';
import type {
  ApiResponseEnvelope,
  LandingAnnouncementsPayload,
  LandingLeaderboardPayload,
  LandingStatsPayload,
} from 'src/types/api';
import { isJsonContentType } from 'src/utils/http';

function logBackendRoutingError(): void {
  console.error('Backend Routing Error: Received HTML instead of JSON');
}

export const useLandingStore = defineStore('landing', {
  state: () => ({
    totalUsers: 0,
    topProfiles: [] as LeaderboardProfile[],
    announcements: [] as Announcement[],
    loading: true,
    offline: false,
    errorMessage: null as string | null,
  }),

  actions: {
    async fetchLandingData() {
      this.loading = true;
      this.offline = false;
      this.errorMessage = null;

      try {
        const [statsRes, leaderRes, announceRes] = await Promise.all([
          api.get<ApiResponseEnvelope<LandingStatsPayload>>('/api/v1/public/stats'),
          api.get<ApiResponseEnvelope<LandingLeaderboardPayload>>(
            '/api/v1/public/leaderboard?limit=10&sort=reputation',
          ),
          api.get<ApiResponseEnvelope<LandingAnnouncementsPayload>>('/api/v1/public/announcements'),
        ]);

        if (
          !isJsonContentType(statsRes.headers) ||
          !isJsonContentType(leaderRes.headers) ||
          !isJsonContentType(announceRes.headers)
        ) {
          logBackendRoutingError();
          this.offline = true;
          this.errorMessage = 'Connection unavailable';
          return false;
        }

        this.totalUsers = statsRes?.data?.data?.count ?? 0;

        const leaderboardPayload = leaderRes?.data?.data as
          | { data?: Array<{ username: string; reputation?: number | null }> }
          | Array<{ username: string; reputation?: number | null }>
          | undefined;
        const rawProfiles = Array.isArray(leaderboardPayload)
          ? leaderboardPayload
          : (leaderboardPayload?.data ?? []);

        this.topProfiles = rawProfiles.map((item) => ({
          username: item.username,
          reputation: item.reputation ?? null,
        }));

        const announcementsPayload = announceRes?.data?.data as
          { data?: Announcement[] } | Announcement[] | undefined;
        this.announcements = Array.isArray(announcementsPayload)
          ? announcementsPayload
          : (announcementsPayload?.data ?? []);
        return true;
      } catch (error) {
        this.offline = true;
        this.errorMessage = 'Offline';
        if (error instanceof Error) {
          console.error('Failed to load landing data:', error.message);
        } else {
          console.error('Failed to load landing data');
        }
        return false;
      } finally {
        this.loading = false;
      }
    },

    startPolling(intervalMs = 60000): ReturnType<typeof setInterval> {
      return setInterval(() => {
        void this.fetchLandingData();
      }, intervalMs);
    },
  },
});
