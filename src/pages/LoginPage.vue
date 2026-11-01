<template>
  <q-page-container class="login-page-container min-h-full p-0! m-0!">
    <q-page class="hero flex bg-card md:bg-black h-full items-center justify-center bg-[var(--bg)]">
      <q-card
        class="auth-card bg-card md:bg-[var(--card)] md:border-3 md:border-solid border-[var(--white)] px-6 md:max-w-[550px] w-full text-left text-[var(--white)] font-mono box-border shadow-none"
        square
        flat
      >
        <q-card-section class="auth-section max-h-fit px-6 pb-6 pl-5">
          <h1 class="text-[var(--primary)] text-1.5rem p-0 m-0 max-h-3.5rem text-center">login</h1>
          <div
            id="error-message"
            class="error-message hidden p-3 mb-4 rounded text-0.7rem text-center bg-[rgba(255,0,0,0.1)] border border-solid border-[rgba(255,0,0,0.3)] text-[#ff6666]"
          ></div>
          <div
            id="success-message"
            class="success-message hidden p-3 mb-4 rounded text-0.7rem text-center bg-[rgba(0,255,0,0.1)] border border-solid border-[rgba(0,255,0,0.3)] text-[#66ff66]"
          ></div>
        </q-card-section>

        <q-card-section class="auth-section max-h-fit px-6 pb-6 pl-5 max-w-[90vw]">
          <q-form @submit.prevent="onSubmit">
            <input type="hidden" name="_csrf" :value="authStore.csrfToken" />

            <div class="form-group mb-4">
              <label class="auth-label block text-[var(--white)] text-0.8rem mb-2" for="username"
                >username</label
              >
              <q-input
                id="username"
                v-model="form.username"
                placeholder="enter username"
                dense
                outlined
                square
                :rules="[(val) => !!val]"
                autocomplete="username"
              />
              <div class="input-data-stream">
                <div v-for="n in 10" :key="n" class="stream-bar" :style="`--i: ${n - 1}`" />
              </div>
            </div>

            <div class="form-group mb-4">
              <label class="auth-label block text-[var(--white)] text-0.8rem mb-2" for="password"
                >password</label
              >
              <q-input
                id="password"
                v-model="form.password"
                :type="isPwd ? 'password' : 'text'"
                placeholder="enter password"
                dense
                bordered
                outlined
                square
                :rules="[(val) => !!val]"
                autocomplete="current-password"
              >
                <template v-slot:append>
                  <q-icon
                    :name="isPwd ? 'mdi-eye-off' : 'mdi-eye'"
                    class="cursor-pointer"
                    color="white"
                    size="20px"
                    @click="isPwd = !isPwd"
                  />
                </template>
              </q-input>
              <div class="input-data-stream">
                <div v-for="n in 10" :key="n" class="stream-bar" :style="`--i: ${n - 1}`" />
              </div>
            </div>

            <q-btn
              label="authenticate"
              type="submit"
              class="auth-btn w-full bg-[var(--primary)] text-[var(--black)] border-2 border-solid border-[var(--primary)] rounded-none p-3 font-mono font-bold text-0.8rem tracking-[4px] cursor-pointer transition-all duration-200 hover:bg-[var(--black)]! hover:text-[var(--primary)]!"
              :loading="loading"
              :disable="loading"
              id="submit-btn"
            />

            <q-checkbox
              v-if="isTauri || isCapacitor"
              v-model="stayLoggedIn"
              label="stay logged in"
              class="mt-3 text-[var(--white)] text-0.75rem"
              dense
            />
          </q-form>
        </q-card-section>

        <q-card-section
          class="auth-section max-h-fit px-6 pb-6 pl-5 text-center text-[#999] tracking-[2px] leading-[1.9rem] text-0.75rem"
        >
          no account?
          <router-link to="/register" class="text-[var(--primary)] no-underline hover:underline"
            >register here</router-link
          ><br />
          <router-link
            to="/forgot-password"
            class="text-[var(--primary)] no-underline hover:underline"
            >forgot password?</router-link
          >
        </q-card-section>
      </q-card>
    </q-page>
  </q-page-container>
</template>
<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from 'src/stores/auth';
import { useQuasar } from 'quasar';
import { useNativeShell } from 'src/composables/useNativeShell';
import { collectClientFingerprint } from 'src/services/clientFingerprint';
import { type LoginCredentials } from 'src/types/auth';

const $q = useQuasar();
const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();
const isPwd = ref(true);
const loading = ref(false);
const stayLoggedIn = ref(false);
// Use the shared native-shell detection: in Tauri v2 the runtime is exposed via
// `window.__TAURI_INTERNALS__` (NOT `window.__TAURI__`, which only exists when
// `app.withGlobalTauri` is enabled). The local check here only tested
// `__TAURI__`, so the "stay logged in" checkbox was hidden in the desktop app.
const { isTauri, isCapacitor } = useNativeShell();
const form = reactive<LoginCredentials>({
  username: '',
  password: '',
});

// Pre-fill username from account switcher query param
onMounted(() => {
  const u = route.query.username;
  if (typeof u === 'string' && u) {
    form.username = u;
  }
});

async function onSubmit() {
  loading.value = true;
  try {
    const fingerprint = await collectClientFingerprint();
    const result = await authStore.login(form, fingerprint, stayLoggedIn.value);

    if (result.success) {
      // show a welcome message styled like the terms dialog alert
      // use primary color variable so it appears red/primary instead of green
      $q.notify({
        message: 'welcome back',
        position: 'top',
        color: 'primary',
        textColor: 'black',
        icon: 'mdi-shield-check',
        timeout: 3000,
        classes:
          'border border-solid border-[var(--primary)] font-mono lowercase tracking-widest text-weight-bold',
      });
      void router.push('/');
    } else {
      $q.notify({ type: 'negative', message: result.error || 'invalid credentials' });
    }
  } catch (err) {
    console.error(err);
    $q.notify({ type: 'negative', message: 'connection failed' });
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped lang="scss">
@import 'src/css/auth-shared.scss';
</style>
