<template>
  <q-page class="min-h-screen bg-dash-bg flex items-center justify-center px-4 py-16 relative">
    <q-btn
      round
      flat
      icon="mdi-arrow-left"
      to="/"
      class="absolute left-4 top-4 text-primary z-10"
      aria-label="back to home"
    />
    <div class="w-full max-w-[640px] text-center">
      <h1 class="text-dash-text text-3xl font-bold lowercase tracking-wide mb-2">contact us</h1>
      <q-separator class="bg-dash-border my-6 mx-auto w-24" />

      <q-card flat class="bg-dash-card border border-solid border-dash-border">
        <q-card-section class="text-center py-10 px-8">
          <q-icon name="mdi-email-outline" size="48px" class="text-primary mb-4" />
          <p class="text-dash-text text-base leading-relaxed mb-4">
            reach out via our
            <a
              href="https://discord.gg/sGp8A3nfKj"
              target="_blank"
              rel="noopener"
              class="text-accent hover:text-accent-secondary transition-colors duration-200 decoration-none font-semibold"
              >discord</a
            >
            for the fastest response time.
          </p>
          <p class="text-dash-muted text-sm leading-relaxed mb-2">business inquiries welcome.</p>
          <p class="text-dash-muted text-sm leading-relaxed mb-8">
            support tickets answered within 24 hours.
          </p>

          <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
            <q-btn
              no-caps
              unelevated
              href="https://discord.gg/sGp8A3nfKj"
              target="_blank"
              class="bg-primary text-white font-mono lowercase tracking-wide px-8"
              icon="fa-brands fa-discord"
              icon-size="16px"
              label="join discord"
            />
          </div>
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { useMeta } from 'quasar';

useMeta({
  title: 'contact — mourn',
  meta: {
    description: {
      name: 'description',
      content:
        'Contact the mourn team. Business inquiries welcome. Support tickets answered within 24 hours.',
    },
  },
});
</script>
