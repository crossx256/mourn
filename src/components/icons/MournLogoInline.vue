<template>
  <span
    class="mourn-logo-inline"

    v-html="svgInline"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
import rawLogo from 'src/assets/mournLogoprot1.svg?raw';

const svgInline = rawLogo
  .replace(/fill\s*:\s*#[0-9a-fA-F]{3,8}/g, 'fill:currentColor')
  .replace(/fill="#[0-9a-fA-F]{3,8}"/g, 'fill="currentColor"')
  .replace(/stroke\s*:\s*#[0-9a-fA-F]{3,8}/g, 'stroke:currentColor')
  .replace(/stroke="#[0-9a-fA-F]{3,8}"/g, 'stroke="currentColor"');
</script>

<style scoped>
.mourn-logo-inline {
  color: var(--primary, #ff0000);
  display: block;
  line-height: 0;
}

.mourn-logo-inline :deep(svg) {
  width: 100%;
  height: auto;
  display: block;
}
</style>
