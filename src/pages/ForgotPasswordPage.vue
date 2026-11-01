<template>
  <q-page-container class="login-page-container min-h-full p-0! m-0!">
    <q-page class="hero flex bg-card md:bg-black h-full items-center justify-center bg-[var(--bg)]">
      <q-card
        class="auth-card bg-card md:bg-[var(--card)] md:border-3 md:border-solid border-[var(--white)] px-6 md:max-w-[550px] w-full text-left text-[var(--white)] font-mono box-border shadow-none"
        square
        flat
      >
        <q-card-section class="auth-section max-h-fit px-6 pb-6 pl-5">
          <h1 class="text-[var(--primary)] text-1.5rem p-0 m-0 max-h-3.5rem text-center">
            forgot password
          </h1>
          <p class="text-center text-[#999] text-0.75rem mt-2">
            enter your email and we will transmit a reset link
          </p>
        </q-card-section>

        <q-card-section class="auth-section max-h-fit px-6 pb-6 pl-5 max-w-[90vw]">
          <q-form @submit.prevent="onSubmit">
            <div class="form-group mb-4">
              <label class="auth-label block text-[var(--white)] text-0.8rem mb-2" for="email"
                >email</label
              >
              <q-input
                id="email"
                v-model="email"
                type="email"
                placeholder="operator@mourn.bio"
                dense
                outlined
                square
                :rules="[(val) => !!val]"
                autocomplete="email"
              />
            </div>

            <q-btn
              label="send reset link"
              type="submit"
              class="auth-btn w-full bg-[var(--primary)] text-[var(--black)] border-2 border-solid border-[var(--primary)] rounded-none p-3 font-mono font-bold text-0.8rem tracking-[2px] cursor-pointer transition-all duration-200 hover:bg-[var(--black)]! hover:text-[var(--primary)]!"
              :loading="loading"
              :disable="loading"
            />
          </q-form>
        </q-card-section>

        <q-card-section
          class="auth-section max-h-fit px-6 pb-6 pl-5 text-center text-[#999] tracking-[1px] leading-[1.9rem] text-0.75rem"
        >
          <router-link to="/login" class="text-[var(--primary)] no-underline hover:underline"
            >back to login</router-link
          >
        </q-card-section>
      </q-card>
    </q-page>
  </q-page-container>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useQuasar } from 'quasar';
import { api } from 'boot/axios';
import { useAuthStore } from 'src/stores/auth';

const $q = useQuasar();
const authStore = useAuthStore();

const email = ref('');
const loading = ref(false);

async function onSubmit() {
  if (!email.value.trim()) return;

  loading.value = true;
  try {
    await authStore.fetchCsrfToken();
    await api.post(
      '/api/v1/auth/request-password-reset',
      { email: email.value.trim() },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': authStore.csrfToken || '',
        },
      },
    );

    $q.notify({
      type: 'positive',
      message: 'if this email exists, a reset link has been sent',
      position: 'top',
    });
    email.value = '';
  } catch {
    $q.notify({
      type: 'negative',
      message: 'unable to process reset request right now',
      position: 'top',
    });
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped lang="scss">
@import 'src/css/auth-shared.scss';
</style>
