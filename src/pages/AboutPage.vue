<template>
  <q-page class="about-page bg-dark text-secondary flex flex-center q-py-xl relative">
    <q-btn
      square
      flat
      icon="mdi-arrow-left"
      to="/"
      class="text-primary absolute left-4 top-4 z-10"
      aria-label="back to home"
    />
    <AboutMournContent show-back-link />
  </q-page>
</template>

<script setup lang="ts">
import AboutMournContent from 'src/components/AboutMournContent.vue';
</script>

<style scoped>
.about-page {
  font-family: 'Courier New', 'Consolas', monospace;
  overflow-x: hidden;
}

.about-page :deep(.q-btn) {
  border-radius: 0;
}
</style>
