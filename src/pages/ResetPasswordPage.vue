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
            reset password
          </h1>
          <p class="text-center text-[#999] text-0.75rem mt-2">
            set a new secure password for your account
          </p>
        </q-card-section>

        <q-card-section class="auth-section max-h-fit px-6 pb-6 pl-5 max-w-[90vw]">
          <q-form @submit.prevent="onSubmit">
            <div class="form-group mb-4">
              <label class="auth-label block text-[var(--white)] text-0.8rem mb-2" for="password"
                >new password</label
              >
              <q-input
                id="password"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                placeholder="enter new password"
                dense
                outlined
                square
                :rules="[(val) => !!val && val.length >= 12]"
                autocomplete="new-password"
              >
                <template #append>
                  <q-icon
                    :name="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
                    class="cursor-pointer"
                    color="white"
                    size="20px"
                    @click="showPassword = !showPassword"
                  />
                </template>
              </q-input>
            </div>

            <div class="form-group mb-4">
              <label
                class="auth-label block text-[var(--white)] text-0.8rem mb-2"
                for="confirmPassword"
                >confirm password</label
              >
              <q-input
                id="confirmPassword"
                v-model="confirmPassword"
                :type="showConfirmPassword ? 'text' : 'password'"
                placeholder="re-enter password"
                dense
                outlined
                square
                :rules="[(val) => !!val]"
                autocomplete="new-password"
              >
                <template #append>
                  <q-icon
                    :name="showConfirmPassword ? 'mdi-eye-off' : 'mdi-eye'"
                    class="cursor-pointer"
                    color="white"
                    size="20px"
                    @click="showConfirmPassword = !showConfirmPassword"
                  />
                </template>
              </q-input>
            </div>

            <q-btn
              label="reset password"
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
import { computed, ref } from 'vue';
import { useQuasar } from 'quasar';
import { useRouter, useRoute } from 'vue-router';
import { api } from 'boot/axios';
import { useAuthStore } from 'src/stores/auth';

const $q = useQuasar();
const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

const password = ref('');
const confirmPassword = ref('');
const showPassword = ref(false);
const showConfirmPassword = ref(false);
const loading = ref(false);

const token = computed(() => String(route.query.token || '').trim());

async function onSubmit() {
  if (!token.value) {
    $q.notify({ type: 'negative', message: 'invalid reset link', position: 'top' });
    return;
  }

  if (password.value.length < 12) {
    $q.notify({
      type: 'negative',
      message: 'password must be at least 12 characters',
      position: 'top',
    });
    return;
  }

  if (password.value !== confirmPassword.value) {
    $q.notify({ type: 'negative', message: 'passwords do not match', position: 'top' });
    return;
  }

  loading.value = true;
  try {
    await authStore.fetchCsrfToken();

    await api.post(
      '/api/v1/auth/reset-password',
      {
        token: token.value,
        newPassword: password.value,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': authStore.csrfToken || '',
        },
      },
    );

    $q.notify({
      type: 'positive',
      message: 'password reset successful, redirecting to login',
      position: 'top',
      timeout: 2500,
    });

    password.value = '';
    confirmPassword.value = '';
    setTimeout(() => {
      void router.push('/login');
    }, 1200);
  } catch (error) {
    const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
    $q.notify({
      type: 'negative',
      message: message || 'failed to reset password',
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
