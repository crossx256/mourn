<template>
  <div class="profile-stats" :class="[`position-${statsPosition}`, `size-${statsSize}`]">
    <div v-if="profile?.showViews" class="stat">
      <span class="stat-value">{{ formatNumber(profile?.views || 0) }}</span>
      <span class="stat-label">views</span>
    </div>

    <div v-if="profile?.showReputation" class="stat">
      <span class="stat-value">{{ formatNumber(profile?.reputation || 0) }}</span>
      <span class="stat-label">reputation</span>
    </div>

    <div v-if="profile?.showReferrals !== false" class="stat">
      <span class="stat-value">{{ formatNumber(user?.referralCount || 0) }}</span>
      <span class="stat-label">referrals</span>
    </div>

    <div v-if="profile?.showMemberSince !== false" class="stat">
      <span class="stat-value">member since</span>
      <span class="stat-label">{{ memberSince }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { formatNumber } from 'src/utils/format';
import type { Profile } from 'src/types/profile';
import type { PublicProfileUser } from 'src/stores/publicProfile';

const props = defineProps<{
  profile: Profile;
  user: PublicProfileUser;
}>();

const statsPosition = computed(() => props.profile?.statsPosition || 'default');
const statsSize = computed(() => props.profile?.statsSize || 'normal');

const MEMBER_SINCE_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const memberSince = computed(() => {
  if (!props.user?.createdAt) return '';
  const date = new Date(props.user.createdAt);
  // Deterministic formatting: identical output on the SSR (Node) runtime and each
  // client browser. `toLocaleDateString()` depends on the runtime's ICU/timezone
  // data and can render a DIFFERENT string on mobile vs the server, which surfaces
  // as a Vue "Hydration completed but contains mismatches" text mismatch. Manual
  // formatting keeps server and client bytes identical.
  if (Number.isNaN(date.getTime())) return '';
  const month = MEMBER_SINCE_MONTHS[date.getUTCMonth()] ?? 'Jan';
  return `${month} ${date.getUTCFullYear()}`;
});
</script>
