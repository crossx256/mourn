<template>
  <q-layout view="hHh lpR fFf">
    <q-page-container>
      <!-- Contextual back button — only when navigated from within mourn -->
      <q-no-ssr>
        <Transition name="fade-back">
          <q-btn
            round
            flat
            v-if="showBackButton"
            icon="mdi-arrow-left"
            @click="goBack"
            size="lg"
            class="fixed left-4 top-1/2 -translate-y-1/2 z-50 text-primary"
            aria-label="back"
          />
        </Transition>
      </q-no-ssr>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const router = useRouter();
const route = useRoute();
const TITLEBAR_EVENT = 'mourn:titlebar-label';

// Initialize as false to match SSR; evaluate in onMounted (client-only)
const showBackButton = ref(false);

function publishProfileLabel() {
  if (typeof window === 'undefined') return;
  const username = typeof route.params.username === 'string' ? route.params.username : 'profile';
  window.dispatchEvent(new CustomEvent(TITLEBAR_EVENT, { detail: { label: username } }));
}

onMounted(() => {
  // Use Vue Router's history state to determine if there is a previous route.
  // window.history.state.back contains the path of the previous page if handled by the router.
  // If opened directly (new tab), .back is usually null or undefined.
  const backEntry = window.history.state?.back;

  showBackButton.value = Boolean(backEntry);
  publishProfileLabel();
});

watch(
  () => route.params.username,
  () => {
    publishProfileLabel();
  },
  { immediate: true },
);

function goBack() {
  router.back();
}
</script>

<style scoped>
.fade-back-enter-active,
.fade-back-leave-active {
  transition: opacity 0.3s ease;
}
.fade-back-enter-from,
.fade-back-leave-to {
  opacity: 0;
}
</style>
