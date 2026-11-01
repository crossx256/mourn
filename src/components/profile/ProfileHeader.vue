<template>
  <header class="profile-header">
    <!-- Profile Picture -->
    <template v-if="profile.showProfilePicture !== false">
      <img
        v-if="profile.profilePicture"
        :src="profile.profilePicture"
        :alt="user?.username || 'profile picture'"
        class="profile-picture"
        loading="lazy"
        decoding="async"
        fetchpriority="low"
        :class="pictureShapeClass"
        :style="pictureBorderStyle"
      />
      <div
        v-else
        class="profile-picture-placeholder"
        :class="pictureShapeClass"
        :style="pictureBorderStyle"
      >
        <q-icon name="fa-solid fa-user" />
      </div>
    </template>

    <!-- Display Name and Username -->
    <template v-if="profile.displayName">
      <div class="username-container" :class="isShimmerEffect ? usernameEffectClass : ''">
        <h1 class="profile-username">
          <span
            :class="!isShimmerEffect ? usernameEffectClass : ''"
            :data-text="profile.displayName || user?.username"
          >
            {{ profile.displayName || user?.username || 'unknown' }}
          </span>
        </h1>
      </div>
      <p v-if="profile.displayName && profile.showHandle !== false" class="profile-handle">
        @{{ user?.username || 'unknown' }}
      </p>
    </template>

    <template v-else>
      <div class="username-container" :class="isShimmerEffect ? usernameEffectClass : ''">
        <h1
          class="profile-username"
          :class="!isShimmerEffect ? usernameEffectClass : ''"
          :data-text="user?.username || 'unknown'"
        >
          {{ user?.username || 'unknown' }}
        </h1>
      </div>
    </template>

    <!-- Username Value -->
    <div v-if="profile.showUsernameValue && profile.usernameValue" class="username-value">
      <span class="value-label">username value:</span>
      <span class="value-amount">{{ profile.usernameValue }}</span>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Profile } from 'src/types/profile';
import type { PublicProfileUser } from 'src/stores/publicProfile';

const props = defineProps<{
  profile: Profile;
  user: PublicProfileUser;
  showInnerBorders: boolean;
  disableEffects?: boolean;
}>();

const pictureShapeClass = computed(() =>
  props.profile.profilePictureShape === 'square' ? 'shape-square' : 'shape-circle',
);

const pictureBorderStyle = computed(() => {
  if (props.profile.profilePictureBorder && props.showInnerBorders) {
    return { border: `2px solid var(--profile-border-color, #fff)` };
  }
  return {};
});

const usernameEffectClass = computed(() => {
  if (props.disableEffects) {
    return '';
  }
  if (props.profile.usernameEffects) {
    return `effect-${props.profile.usernameEffects}`;
  }
  return '';
});

const isShimmerEffect = computed(() => {
  if (props.disableEffects) {
    return false;
  }
  const effect = props.profile.usernameEffects;
  return !!effect && ['shimmer-spin', 'shimmer-wave', 'shimmer-throb'].includes(effect);
});
</script>
