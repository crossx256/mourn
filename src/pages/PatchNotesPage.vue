<template>
  <q-page class="patch-notes-page bg-dark text-secondary q-py-xl relative">
    <q-btn
      round
      flat
      icon="mdi-arrow-left"
      to="/"
      class="text-primary absolute left-4 top-4 z-10"
      aria-label="back to home"
    />

    <div class="patch-notes-container column items-start mx-auto">
      <div class="patch-notes-head flex items-center gap-3 q-mb-md">
        <MournLogoInline class="text-primary mourn-logo" />
        <h1 class="text-primary font-mono text-subtitle1 q-ma-0 letter-spacing-3">
          // Patch Notes
        </h1>
      </div>

      <!-- Markdown rendered from src/content/patchnotes.md -->
      <div class="patch-notes-body font-mono text-body1" v-html="renderedHtml" />

      <p class="q-mt-xl text-caption opacity-60">last updated from the current build.</p>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import MournLogoInline from 'components/icons/MournLogoInline.vue';
import patchnotes from 'src/content/patchnotes.md?raw';

const markedInstance = new Marked({ gfm: true, breaks: true });

const renderedHtml = computed(() => DOMPurify.sanitize(markedInstance.parse(patchnotes) as string));
</script>

<style scoped>
.patch-notes-page {
  min-height: 100vh;
}
.patch-notes-container {
  width: 100%;
  max-width: 780px;
  padding: 4rem 1.5rem 3rem;
}
.patch-notes-head h1 {
  letter-spacing: 0.2em;
  text-transform: uppercase;
}
.patch-notes-body {
  width: 100%;
  color: #dddddd;
  line-height: 1.6;
}
.patch-notes-body :deep(h1) {
  font-size: 1.15rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #ff0000;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 0.5rem;
  margin: 2rem 0 1rem;
}
.patch-notes-body :deep(h2) {
  font-size: 1rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #ff0000;
  margin: 1.75rem 0 0.75rem;
}
.patch-notes-body :deep(h3) {
  font-size: 0.9rem;
  letter-spacing: 0.1em;
  color: rgb(var(--m-text-rgb));
  margin: 1.25rem 0 0.5rem;
}
.patch-notes-body :deep(p) {
  margin: 0.5rem 0;
  color: #cccccc;
}
.patch-notes-body :deep(ul) {
  padding-left: 1.25rem;
  margin: 0.5rem 0;
  list-style: none;
}
.patch-notes-body :deep(li) {
  position: relative;
  padding-left: 1rem;
  margin: 0.35rem 0;
  color: #cccccc;
}
.patch-notes-body :deep(li)::before {
  content: '>';
  position: absolute;
  left: 0;
  color: #ff0000;
}
.patch-notes-body :deep(blockquote) {
  border-left: 2px solid #ff0000;
  margin: 1rem 0;
  padding: 0.25rem 1rem;
  color: #999999;
  font-size: 0.95rem;
}
.patch-notes-body :deep(strong) {
  color: rgb(var(--m-text-rgb));
}
.patch-notes-body :deep(hr) {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  margin: 2rem 0;
}
.patch-notes-body :deep(code) {
  color: #ff0000;
}
</style>
