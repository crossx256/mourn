<template>
  <q-card flat bordered class="download-card flex flex-col items-center p-6 min-w-[220px] relative">
    <q-badge
      v-if="highlight"
      label="Auto-detected"
      color="primary"
      class="absolute top-2 right-2 text-[10px] font-mono tracking-wide"
      style="padding: 4px 6px; border-radius: 4px"
    />
    <q-icon :name="icon" size="48px" class="mb-2 text-[var(--q-primary)]" />
    <div class="font-mono text-lg text-white mb-4">{{ label }}</div>
    <q-btn
      :href="file"
      target="_blank"
      rel="noopener noreferrer"
      outline
      no-caps
      class="w-full font-mono lowercase"
      color="primary"
      label="Download"
    />
  </q-card>
</template>

<script setup lang="ts">
type DownloadCardProps = {
  os: string;
  label: string;
  file: string;
  highlight: boolean;
  badge: string;
  icon: string;
};

defineProps<DownloadCardProps>();
</script>

<style scoped>
.download-card {
  background: var(--q-dark);
  border-color: color-mix(in srgb, var(--q-primary) 40%, transparent);
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

.download-card:hover {
  border-color: var(--q-primary);
}
</style>
