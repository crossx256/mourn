<template>
  <q-page class="builders-page bg-dark text-secondary q-py-xl relative">
    <q-btn
      square
      flat
      icon="mdi-arrow-left"
      to="/"
      class="text-primary absolute left-4 top-4 z-10"
      aria-label="back to home"
    />

    <div class="builders-container column items-start mx-auto font-mono">
      <div class="flex items-center gap-3 q-mb-md">
        <MournLogoInline class="text-primary mourn-logo" />
        <h1 class="text-primary text-subtitle1 q-ma-0">// Builders</h1>
      </div>
      <p>{{ buildersIntro }}</p>

      <section v-for="category in builderCategories" :key="category.id" class="builders-section">
        <h2 class="text-primary text-subtitle1">// {{ category.title }}</h2>
        <p>{{ category.description }}</p>
        <ul v-if="category.contributors.length">
          <li v-for="contributor in category.contributors" :key="contributor.name">
            <strong>{{ contributor.name }}</strong> — {{ contributor.contribution }}
          </li>
        </ul>
        <p v-else class="text-caption">Individual contributor credits will be added here.</p>
      </section>

      <section class="builders-section">
        <h2 class="text-primary text-subtitle1">// Third-party acknowledgements</h2>
        <p>
          Mourn also uses third-party fonts, libraries, and other dependencies. Those works belong
          to their respective creators; team credits above do not claim authorship of them.
          Third-party acknowledgements and license notices are maintained separately in the
          source repository's THIRD_PARTY.md and accompanying license notices.
        </p>
        <p>
          Mourn's messaging draws inspiration from the Signal Protocol. See the
          <a :href="signalDocsUrl" target="_blank" rel="noopener noreferrer" class="text-primary">
            Signal Protocol documentation</a
          >. Mourn is not affiliated with or endorsed by Signal. This acknowledgement does not
          imply interoperability with Signal or a security audit by Signal.
        </p>
      </section>

      <q-btn flat no-caps label="[ back to main ]" to="/" class="q-mt-xl" />
    </div>
  </q-page>
</template>

<script setup lang="ts">
import MournLogoInline from 'src/components/icons/MournLogoInline.vue';
import { builderCategories, buildersIntro, signalDocsUrl } from 'src/content/builders';
</script>

<style scoped>
.builders-container {
  width: 100%;
  max-width: 780px;
  padding: 4rem 1.5rem 3rem;
  line-height: 1.7;
}

.builders-container h1 {
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.builders-section {
  width: 100%;
  margin-top: 1.5rem;
}

.builders-container :deep(.q-btn) {
  border-radius: 0;
}
</style>
