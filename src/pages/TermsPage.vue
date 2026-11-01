<template>
  <q-page class="min-h-screen bg-dash-bg flex flex-center px-4 py-10 relative">
    <q-btn
      round
      flat
      icon="mdi-arrow-left"
      to="/"
      class="absolute left-4 top-4 text-primary z-10"
      aria-label="back to home"
    />

    <div class="w-full max-w-[720px]">
      <div class="text-center mb-12">
        <h1 class="text-dash-text text-4xl font-bold lowercase tracking-tighter mb-2">
          Protocol <span class="text-primary opacity-80">Documentation</span>
        </h1>
        <div class="text-primary text-xs font-bold uppercase tracking-[0.5em] opacity-60">
          Last Revision: February 2026
        </div>
      </div>

      <div
        class="bg-dash-card border border-solid border-dash-border shadow-2xl h-full overflow-hidden"
      >
        <div class="p-8 md:p-12 border-b border-solid border-dash-border bg-black/10">
          <div class="flex items-center gap-4 mb-3">
            <span class="text-primary font-mono text-lg font-bold">01</span>
            <h2 class="text-dash-text text-xs font-bold uppercase tracking-[0.3em]">
              Terms & Conditions
            </h2>
          </div>

          <div class="flex flex-col gap-1">
            <div v-for="section in communitySections" :key="section.title">
              <h3
                class="text-dash-text text-sm font-bold uppercase tracking-widest mb-3 flex items-center gap-2"
              >
                <span class="w-1.5 h-1.5 bg-primary rounded-full opacity-50"></span>
                {{ section.title }}
              </h3>
              <p
                class="text-dash-muted text-xs leading-relaxed font-light pl-4 border-l border-dash-border/30"
              >
                {{ section.body }}
              </p>
            </div>
          </div>
        </div>

        <div class="p-8 md:p-12 bg-black/10 border-b border-solid border-dash-border">
          <div class="flex items-center gap-4 mb-3">
            <span class="text-primary font-mono text-lg font-bold">02</span>
            <h2 class="text-dash-text text-sm font-bold uppercase tracking-[0.3em]">Legalities</h2>
          </div>

          <div class="flex flex-col gap-3">
            <div v-for="section in legalSections" :key="section.title">
              <h3
                class="text-dash-text text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2"
              >
                <span class="w-1.5 h-1.5 border border-primary rounded-full"></span>
                {{ section.title }}
              </h3>
              <div class="text-dash-muted text-xs leading-relaxed font-mono pl-4 opacity-80">
                {{ section.body }}
              </div>
            </div>
          </div>
        </div>

        <q-card-section class="py-8 text-center border-t border-solid border-dash-border/50">
          <p class="text-primary text-xs font-bold uppercase tracking-[0.4em]">
            Continuing to use Mourn means you agree to these terms.
          </p>
        </q-card-section>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { useMeta } from 'quasar';

useMeta({
  title: 'protocol — mourn',
  meta: {
    description: {
      name: 'description',
      content: 'MOURN terms and legal documentation.',
    },
  },
});

// Community / Sanctuary Terms (The "Vibe" & Data)
const communitySections = [
  {
    title: 'Your Data',
    body: 'We collect minimal account and usage data (emails, usernames, IP addresses, and site activity) only to operate MOURN. We don’t sell your data or share it for advertising, profiling, or marketing. Server logs are stored for up to 7 days and then deleted. Our goal is to minimize or fully remove IP logging in the future.',
  },
  {
    title: 'Conduct',
    body: 'Do not break the law; do not break the machine. We reserve the right to exile any user that threatens the ecosystem without warning or explanation.',
  },
  {
    title: 'The Veil',
    body: 'Access is a privilege reserved for those 16 years or older. If you are under 18, you confirm you have permission from a parent or legal guardian. You navigate MOURN at your own risk.',
  },
  {
    title: 'Traces',
    body: 'Cookies and analytics are the breadcrumbs required to keep the website functional. By stepping forward, you accept the digital trail you leave behind.',
  },
];

// Heavy Legal Stuff (Jurisdiction, Arbitration, XMR)
const legalSections = [
  {
    title: 'Liability & Risk',
    body: 'The service is provided “as is” without warranties of any kind. The collective is not liable for any direct, indirect, incidental, or consequential damages, data loss, downtime, or chaos. For paid users, total liability is capped at the amount actually paid to access MOURN in the last 30 days. Free users have a $0 liability cap.',
  },
  {
    title: 'XMR & Financial Transactions',
    body: 'All Monero (XMR) payments are manual and final. Given the nature of privacy coins, MOURN is not liable for lost funds due to incorrect addresses, network failure, or exchange rate volatility during the manual verification process by Operatives.',
  },
  {
    title: 'Jurisdiction',
    body: 'These terms are governed by the laws of Lebanon, without regard to conflict-of-law principles. You irrevocably consent to the exclusive jurisdiction of the courts located in Beirut, Lebanon, for any dispute arising from these terms.',
  },
  {
    title: 'Disputes & Arbitration',
    body: 'You waive any right to participate in class actions or collective proceedings. Any dispute that cannot be resolved informally (30-day notice required) must be resolved through binding arbitration on an individual basis in the specified jurisdiction.',
  },
];
</script>

<style scoped>
/* Optional: Adds a subtle scanline effect to the background to keep it "MOURN" style */
.bg-dash-bg::before {
  content: ' ';
  display: block;
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  right: 0;
  background:
    linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%),
    linear-gradient(90deg, rgba(255, 0, 0, 0.01), rgba(0, 255, 0, 0.01), rgba(0, 0, 255, 0.01));
  z-index: 1;
  background-size:
    100% 2px,
    3px 100%;
  pointer-events: none;
}
</style>
