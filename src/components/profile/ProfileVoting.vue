<template>
  <div v-if="isClient" class="profile-voting">
    <div class="rep-message" :class="{ show: showMessage }">{{ message }}</div>
    <template v-if="isLoggedIn && !isOwnProfile">
      <button
        class="rep-btn"
        :class="{ animating: isAnimating, 'already-repped': hasVoted }"
        :title="hasVoted ? 'Remove reputation' : 'Give reputation'"
        type="button"
        @click="handleVote"
      >
        <span class="rep-btn-glyph" aria-hidden="true">+</span>
      </button>
    </template>
    <template v-else-if="!isLoggedIn">
      <router-link to="/login" class="rep-btn" style="color: var(--white); text-decoration: none">
        <span class="rep-btn-glyph" aria-hidden="true">+</span>
      </router-link>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { api } from 'boot/axios';
import { useAuthStore } from 'src/stores/auth';

const props = defineProps<{
  username: string;
  profileUserId: string;
}>();

const authStore = useAuthStore();

const isClient = ref(false);
const hasVoted = ref(false);
const isAnimating = ref(false);
const message = ref('');
const showMessage = ref(false);

const isLoggedIn = computed(() => authStore.isLoggedIn);
const isOwnProfile = computed(() => authStore.user?.id === props.profileUserId);

onMounted(async () => {
  isClient.value = true;

  // Check if user already voted
  if (authStore.isLoggedIn && !isOwnProfile.value) {
    try {
      const { data } = await api.get(`/api/v1/votes/${encodeURIComponent(props.username)}`, {
        headers: { 'X-CSRF-Token': authStore.csrfToken },
      });
      if (data.vote === 1) {
        hasVoted.value = true;
      }
    } catch {
      // ignore — user may not have voted yet
    }
  }
});

async function handleVote() {
  if (isAnimating.value) return;

  await authStore.fetchCsrfToken();
  isAnimating.value = true;

  const newVote = hasVoted.value ? 0 : 1;

  try {
    const { data } = await api.post(
      `/api/v1/votes/${encodeURIComponent(props.username)}`,
      { vote: newVote },
      { headers: { 'X-CSRF-Token': authStore.csrfToken } },
    );

    if (data.success) {
      hasVoted.value = newVote === 1;
      message.value = newVote === 1 ? '+rep' : 'removed';
      showMessage.value = true;
      setTimeout(() => (showMessage.value = false), 2000);
    }
  } catch (err: unknown) {
    const resp = (err as { response?: { data?: { error?: string } } })?.response;
    message.value = resp?.data?.error || 'error';
    showMessage.value = true;
    setTimeout(() => (showMessage.value = false), 3000);
  } finally {
    setTimeout(() => (isAnimating.value = false), 600);
  }
}
</script>
