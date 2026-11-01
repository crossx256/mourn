<template>
  <q-dialog v-model="showTerms" persistent maximized transition-show="fade" transition-hide="fade">
    <q-card class="bg-black/90 flex flex-center px-4">
      <div class="w-full max-w-[680px] bg-dash-card border border-solid border-dash-border">
        <q-card-section class="pt-5 pb-1 text-center">
          <h1 class="text-dash-text text-3xl font-bold lowercase tracking-tighter">mourn</h1>
          <div class="text-primary text-xs font-bold uppercase tracking-[0.3em] mb-2">
            Terms of Passage
          </div>
          <q-separator class="bg-dash-border my-3 mx-auto w-full" />
        </q-card-section>

        <q-card-section class="px-2 md:px-12">
          <q-scroll-area style="height: 450px" class="pr-4">
            <div class="flex flex-col gap-6">
              <div v-for="(section, index) in mainSections" :key="index">
                <h2
                  class="text-dash-text text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-2"
                >
                  <span class="text-primary opacity-50">0{{ index + 1 }}</span>
                  {{ section.title }}
                </h2>
                <p class="text-dash-muted text-xs leading-relaxed font-light">
                  {{ section.body }}
                </p>
              </div>

              <div class="mt-2 p-4 border border-dashed border-dash-border/30 bg-black/20">
                <p class="text-[10px] text-dash-muted leading-relaxed uppercase tracking-widest">
                  By checking the box below, you also agree to the
                  <a
                    href="/terms"
                    target="_blank"
                    class="text-primary no-underline hover:underline decoration-1 underline-offset-4 cursor-pointer"
                  >
                    Full Legal Protocol </a
                  >, including specific jurisdiction, XMR payment terms, and binding arbitration.
                </p>
              </div>
            </div>
          </q-scroll-area>
        </q-card-section>

        <q-separator class="bg-dash-border mt-4" />

        <q-card-section class="py-8 px-8 md:px-12">
          <div class="flex flex-col sm:flex-row items-center justify-between gap-6">
            <q-checkbox
              v-model="accepted"
              keep-color
              color="primary"
              dark
              class="text-dash-muted text-xs font-mono lowercase tracking-tight"
            >
              <template v-slot:default> I accept the weight of these words. </template>
            </q-checkbox>

            <q-btn
              unelevated
              label="Enter"
              :disable="!accepted"
              :loading="loading"
              @click="confirmTerms"
              class="bg-primary text-white px-10 py-3 text-xs font-bold uppercase tracking-[0.2em] transition-all hover:brightness-110 disabled:opacity-30"
            />
          </div>
        </q-card-section>
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { api } from 'boot/axios';
import { useQuasar } from 'quasar';
import { useAuthStore } from 'src/stores/auth';

const $q = useQuasar();
const authStore = useAuthStore();
const showTerms = ref(true);
const accepted = ref(false);
const loading = ref(false);
const mainSections = [
  {
    title: 'Your Data',
    body: 'We collect minimal account and usage data only to operate MOURN. We don’t sell your data and we don’t share it for advertising, profiling, or marketing. Server logs are stored for up to 7 days and then deleted. Our goal is to minimize or fully remove IP logging in the future.',
  },
  {
    title: 'Conduct',
    body: 'Do not break the law; do not break the machine. We reserve the right to exile any user that threatens the ecosystem without warning or explanation.',
  },
  {
    title: 'The Veil',
    body: 'Access is a privilege reserved for those 16 years or older. If you are under 18, you confirm you have permission from a parent or legal guardian. You navigate MOURN at your own peril.',
  },
  {
    title: 'Traces',
    body: 'Cookies and analytics are the breadcrumbs required to keep the website functional. By stepping forward, you accept the digital trail you leave behind.',
  },
  {
    title: 'Liability',
    body: 'Use MOURN at your own risk. The service is provided “as is” without warranties. For paid users, our total liability is capped at the amount you actually paid to access MOURN. Free users have a $0 liability cap.',
  },
];

const confirmTerms = async () => {
  loading.value = true;
  try {
    const csrfRes = await api.get('/api/v1/auth/csrf');
    const token = csrfRes.data.csrfToken;

    await api.post(
      '/api/v1/auth/accept-terms',
      {},
      {
        headers: { 'x-csrf-token': token },
      },
    );

    await authStore.checkSession();
    showTerms.value = false;

    $q.notify({
      message: 'Welcome to Mourn',
      position: 'top',
      color: 'black',
      textColor: 'primary',
      icon: 'mdi-shield-check',
      timeout: 3000,
      classes:
        'border border-solid border-dash-border font-mono lowercase tracking-widest text-weight-bold',
    });
  } catch (err: unknown) {
    interface AxiosError {
      response?: {
        data?: {
          error?: string;
        };
      };
    }

    const message =
      (typeof err === 'object' &&
        err !== null &&
        'response' in err &&
        (err as AxiosError).response?.data?.error) ||
      'The machine refused your oath.';
    $q.notify({ color: 'negative', message, icon: 'mdi-alert-octagon', position: 'bottom' });
  } finally {
    loading.value = false;
  }
};
</script>
