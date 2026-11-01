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
      <h1 class="text-dash-text text-3xl font-bold lowercase tracking-wide mb-2">help center</h1>
      <q-separator class="bg-dash-border my-6 mx-auto w-24" />

      <q-card flat class="bg-dash-card border border-solid border-dash-border">
        <q-card-section class="text-center py-10 px-8">
          <q-icon name="mdi-lifebuoy" size="48px" class="text-primary mb-4" />
          <p class="text-dash-text text-base leading-relaxed mb-6">
            open a support ticket, report a person, message, suite or graveyard star — or reach us
            on
            <a
              href="https://discord.gg/sGp8A3nfKj"
              target="_blank"
              rel="noopener"
              class="text-accent hover:text-accent-secondary transition-colors duration-200 decoration-none font-semibold"
              >discord</a
            >
            for immediate assistance.
          </p>
          <p class="text-dash-muted text-sm leading-relaxed mb-8">
            tickets are tracked in-app: you'll get a notification and an email when yours is
            resolved.
          </p>

          <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
            <q-btn
              no-caps
              unelevated
              to="/tickets"
              class="bg-primary text-white font-mono lowercase tracking-wide px-8"
              icon="mdi-ticket-confirmation-outline"
              icon-size="16px"
              label="open a ticket"
            />
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
  title: 'help — mourn',
  meta: {
    description: {
      name: 'description',
      content: 'Get help and support for mourn. Contact us via Discord for immediate assistance.',
    },
  },
});
</script>
