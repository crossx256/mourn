<template>
  <div v-if="visibleBadges.length > 0" class="profile-badges">
    <div class="badges-grid">
      <div
        v-for="badge in visibleBadges"
        :key="badge.key"
        class="badge-item"
        :class="`hover-${hoverEffect || 'static'}`"
        :title="badge.label"
      >
        <q-icon :name="badge.icon" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { BADGE_DEFINITIONS, isBadgeKey } from 'src/constants/badges';

const props = defineProps<{
  badges?: string[] | null;
  hoverEffect?: string;
}>();

const visibleBadges = computed(() =>
  (props.badges ?? []).filter(isBadgeKey).map((key) => ({
    key,
    ...BADGE_DEFINITIONS[key],
  })),
);
</script>
