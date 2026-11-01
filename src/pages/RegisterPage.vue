<template>
  <q-page-container class="login-page-container min-h-full! p-0! m-0!">
    <!-- Alt policy popup overlay -->
    <transition name="fade">
      <div
        v-if="showAltWarning"
        class="alt-popup-overlay fixed top-0 left-0 w-full h-full bg-[rgba(0,0,0,0.85)] flex items-start justify-center pt-20 z-[9999]"
        @click.self="dismissAltWarning"
      >
        <div
          class="alt-popup-card bg-[var(--card)] border-3 border-solid border-[#ffa500] max-w-[90vw] aspect-[8/3] max-h-[200px] w-fit p-6 font-mono shadow-[0_0_40px_rgba(255,165,0,0.4)]"
        >
          <div class="alt-popup-header flex items-center mb-1.5 gap-3">
            <q-icon name="mdi-alert" class="text-[#ffa500] text-1.5rem shrink-0" />
            <h2 class="text-[#ffa500] text-1rem font-bold m-0 flex-1 lowercase">alt policy</h2>
            <q-icon
              name="mdi-close"
              class="text-[#ffa500] text-2rem opacity-70 transition-opacity duration-200 shrink-0 cursor-pointer hover:opacity-100"
              @click="dismissAltWarning"
            />
          </div>
          <div class="alt-popup-body">
            <p class="text-[var(--white)] text-0.8rem leading-[1.8] m-0 font-bold">
              creating more than 1-2 accounts is strictly prohibited and will result in a permanent
              ban. we actively monitor and detect duplicate accounts.
            </p>
          </div>
        </div>
      </div>
    </transition>

    <q-page
      class="hero flex bg-card md:bg-black m-0! p-0! max-h-full items-center justify-center bg-[var(--bg)]"
    >
      <q-card
        v-if="isActivationMode && activationLoading"
        class="auth-card activation-state-card"
        square
        flat
      >
        <q-card-section>
          <div class="activation-state-title">// checking activation link</div>
          <p>Verifying that this activation link is valid and unused.</p>
          <q-linear-progress indeterminate color="primary" class="activation-progress" />
        </q-card-section>
      </q-card>

      <q-card
        v-else-if="isActivationMode && activationError"
        class="auth-card activation-state-card activation-error-card"
        square
        flat
      >
        <q-card-section>
          <div class="activation-state-title">// activation unavailable</div>
          <p>{{ activationError }}</p>
          <router-link to="/register" class="activation-link"
            >[ submit an application ]</router-link
          >
        </q-card-section>
      </q-card>

      <q-card
        v-else
        class="auth-card bg-card md:bg-[var(--card)] md:border-3 md:border-solid border-[var(--white)] md:max-w-[550px] max-h-[80vh] overflow-x-hidden overflow-y-auto w-full text-left text-[var(--white)] font-mono box-border shadow-none"
        square
        flat
      >
        <q-card-section class="auth-section max-h-fit mt-[-1rem]! md:px-6 md:pt-2 md:pb-6 md:pl-5">
          <div
            class="text-[var(--primary)] text-1.1rem md:text-1.5rem max-h-[1rem] mt-2 md:mt-5 md:pt-3 md:max-h-3.5rem text-center"
          >
            <span class="text-1.1rem">register</span>
          </div>
          <div
            id="error-message"
            class="error-message hidden p-3 mb-4 rounded-none text-0.7rem text-center bg-[rgba(255,0,0,0.1)] border border-solid border-[rgba(255,0,0,0.3)] text-[#ff6666]"
          ></div>
          <div
            id="success-message"
            class="success-message hidden p-3 mb-4 rounded-none text-0.7rem text-center bg-[rgba(0,255,0,0.1)] border border-solid border-[rgba(0,255,0,0.3)] text-[#66ff66]"
          ></div>
        </q-card-section>

        <q-card-section class="auth-section max-h-fit px-3 pb-3 md:px-6 md:pb-6 md:pl-5">
          <div v-if="isActivationMode" class="activation-approved-banner">
            <strong>application approved</strong>
            <p>
              Create your account below. Your application email is prefilled, but you may change or
              remove it.
            </p>
            <small v-if="activationExpiryLabel"
              >activation expires {{ activationExpiryLabel }}</small
            >
          </div>

          <q-form @submit.prevent="onSubmit">
            <input type="hidden" name="_csrf" :value="authStore.csrfToken" />

            <div class="form-group m-0">
              <label
                class="auth-label block text-[var(--white)] text-0.65rem mb-0.5 md:text-0.8rem md:mb-2"
                for="username"
                >username</label
              >
              <q-input
                id="username"
                v-model="form.username"
                placeholder="lowercase, numbers, -, _"
                dense
                outlined
                square
                :rules="[(val) => !!val || 'Required', authRules.username]"
                autocomplete="username"
              />
            </div>

            <div v-if="!isActivationMode" class="form-group m-0">
              <label
                class="auth-label block text-[var(--white)] text-0.65rem mb-0.5 md:text-0.8rem md:mb-2"
                for="referralCode"
                >invitation code</label
              >
              <q-input
                id="referralCode"
                v-model="form.referralCode"
                placeholder="mourn..."
                dense
                outlined
                square
                :rules="[(val) => !!val || 'Required', authRules.referralCode]"
              />
            </div>

            <div class="form-group m-0">
              <label
                class="auth-label block text-[var(--white)] text-0.65rem mb-0.5 md:text-0.8rem md:mb-2"
                for="email"
                >email (optional)</label
              >
              <q-input
                id="email"
                v-model="form.email"
                type="email"
                placeholder="for password recovery"
                dense
                outlined
                square
                :rules="[authRules.email]"
                autocomplete="email"
                @update:model-value="checkEmailWarning"
              />
            </div>

            <div
              v-if="showNoEmailWarning"
              class="warning-banner flex items-start gap-3 bg-[rgba(255,100,100,0.1)] border border-solid border-[rgba(255,100,100,0.3)] p-3 mb-1 rounded-none"
            >
              <div class="warning-content flex-1">
                <div class="warning-icon-cont flex items-end gap-2 mb-0.5">
                  <q-icon
                    name="mdi-alert-circle"
                    class="warning-icon text-[#ff6666] text-1.25rem"
                  />
                  <strong class="text-[#ff6666] text-0.75rem block"
                    >no email = no password recovery</strong
                  >
                </div>
                <p class="text-[var(--muted)] text-0.65rem m-0 leading-[1.4]">
                  without an email, we cannot trust you are the owner of the account. make sure to
                  memorize your password or write it down somewhere safe. we will only help if we
                  personally know you.
                </p>
              </div>
            </div>

            <div class="form-group m-0">
              <label
                class="auth-label block text-[var(--white)] text-0.65rem mb-0.5 md:text-0.8rem md:mb-2"
                for="password"
                >password</label
              >
              <q-input
                id="password"
                v-model="form.password"
                :type="isPwd ? 'password' : 'text'"
                placeholder="minimum 12 characters"
                dense
                outlined
                square
                :rules="[(val) => !!val || 'Required', authRules.password]"
                autocomplete="new-password"
                @focus="onPasswordFocus"
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
            </div>

            <div class="form-group m-0">
              <label
                class="auth-label block text-[var(--white)] text-0.65rem mb-0.5 md:text-0.8rem md:mb-2"
                for="confirmPassword"
                >confirm password</label
              >
              <q-input
                id="confirmPassword"
                v-model="form.confirmPassword"
                :type="isPwdConfirm ? 'password' : 'text'"
                placeholder="confirm password"
                dense
                outlined
                square
                :rules="[
                  (val) => !!val || 'Required',
                  (val) => val === form.password || 'Passwords do not match',
                ]"
                autocomplete="new-password"
              >
                <template v-slot:append>
                  <q-icon
                    :name="isPwdConfirm ? 'mdi-eye-off' : 'mdi-eye'"
                    class="cursor-pointer"
                    color="white"
                    size="20px"
                    @click="isPwdConfirm = !isPwdConfirm"
                  />
                </template>
              </q-input>
            </div>

            <div class="captcha-container w-full flex justify-center items-center mb-4">
              <CapCaptcha
                ref="captchaWidget"
                :api-endpoint="CAP_API_ENDPOINT"
                @token="captchaToken = $event"
              />
            </div>

            <q-btn
              label="create account"
              type="submit"
              class="auth-btn w-full bg-[var(--primary)] text-[var(--black)] border-2 border-solid border-[var(--primary)] rounded-none p-2 md:p-3 font-mono font-bold text-0.65rem md:text-0.8rem tracking-[2px] md:tracking-[4px] cursor-pointer transition-all duration-200 hover:bg-[var(--black)]! hover:text-[var(--primary)]!"
              :loading="loading"
              :disable="loading"
              id="submit-btn"
            />
          </q-form>
        </q-card-section>

        <q-card-section
          class="auth-section max-h-fit px-3 pb-3 md:px-6 md:pb-6 md:pl-5 text-center text-[#999] tracking-[2px] leading-[1.4rem] md:leading-[1.9rem] text-0.65rem md:text-0.75rem"
        >
          already have an account?
          <router-link to="/login" class="text-[var(--primary)] no-underline hover:underline"
            >login here</router-link
          >
        </q-card-section>
      </q-card>
    </q-page>
  </q-page-container>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from 'src/stores/auth';
import { api } from 'src/boot/axios';
import { authRules } from 'src/utils/validation';
import { useQuasar } from 'quasar';
import { collectClientFingerprint } from 'src/services/clientFingerprint';
import type { RegisterCredentials } from 'src/types/auth';
import type { ApiResponseEnvelope } from 'src/types/api';
import CapCaptcha from 'src/components/security/CapCaptcha.vue';

interface RegisterFormFields {
  username: string;
  referralCode: string;
  email: string;
  password: string;
  confirmPassword: string;
}

interface ActivationPreflightData {
  email: string;
  expiresAt: string;
}

const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const CAP_API_ENDPOINT = import.meta.env.VITE_CAP_API_ENDPOINT || '';
const isPwd = ref(true);
const isPwdConfirm = ref(true);
const loading = ref(false);
const showNoEmailWarning = ref(false);
const passwordTouched = ref(false);
const showAltWarning = ref(false);
const captchaToken = ref('');
const captchaWidget = ref<InstanceType<typeof CapCaptcha> | null>(null);
const activationLoading = ref(false);
const activationError = ref('');
const activationExpiresAt = ref('');

const activationToken = computed(() => {
  if (route.path !== '/register') return '';
  const token = route.query.token;
  return typeof token === 'string' ? token.trim() : '';
});
const isActivationMode = computed(() => Boolean(activationToken.value));
const activationExpiryLabel = computed(() => {
  if (!activationExpiresAt.value) return '';
  const expiresAt = new Date(activationExpiresAt.value);
  return Number.isNaN(expiresAt.getTime()) ? '' : expiresAt.toLocaleString();
});

let altWarningTimer: ReturnType<typeof setTimeout> | null = null;

function dismissAltWarning() {
  showAltWarning.value = false;
}

const form = reactive<RegisterFormFields>({
  username: '',
  referralCode: '',
  email: '',
  password: '',
  confirmPassword: '',
});

function checkEmailWarning() {
  showNoEmailWarning.value = passwordTouched.value && (!form.email || form.email.trim() === '');
}

function onPasswordFocus() {
  passwordTouched.value = true;
  checkEmailWarning();
}

function clearCaptchaToken() {
  captchaToken.value = '';
}

function initializeRegistrationForm() {
  altWarningTimer = setTimeout(() => {
    showAltWarning.value = true;
  }, 2000);
}

async function preflightActivation() {
  activationLoading.value = true;
  activationError.value = '';
  activationExpiresAt.value = '';

  try {
    const response = await api.get<ApiResponseEnvelope<ActivationPreflightData>>(
      '/api/v1/registration-applications/activation',
      { params: { token: activationToken.value } },
    );
    const activation = response.data?.data;

    if (response.data?.success !== true || !activation?.email) {
      throw new Error(
        response.data?.error ||
          response.data?.message ||
          'This activation link is invalid or expired.',
      );
    }

    form.email = activation.email;
    activationExpiresAt.value = activation.expiresAt || '';
    activationLoading.value = false;
    await nextTick();
    initializeRegistrationForm();
  } catch (error: unknown) {
    const backendMessage = (error as { response?: { data?: { error?: string; message?: string } } })
      ?.response?.data;
    activationError.value =
      backendMessage?.error ||
      backendMessage?.message ||
      (error instanceof Error ? error.message : '') ||
      'This activation link is invalid or expired.';
    activationLoading.value = false;
  }
}

onMounted(() => {
  if (isActivationMode.value) {
    void preflightActivation();
  } else {
    initializeRegistrationForm();
  }
});

onBeforeUnmount(() => {
  if (altWarningTimer) clearTimeout(altWarningTimer);

  clearCaptchaToken();
});

async function onSubmit() {
  loading.value = true;
  try {
    const fingerprint = await collectClientFingerprint();

    if (!captchaToken.value) {
      $q.notify({ type: 'negative', message: 'please complete the captcha' });
      loading.value = false;
      return;
    }

    const credentials: RegisterCredentials = isActivationMode.value
      ? {
          username: form.username,
          activationToken: activationToken.value,
          email: form.email,
          password: form.password,
          confirmPassword: form.confirmPassword,
        }
      : {
          username: form.username,
          referralCode: form.referralCode,
          email: form.email,
          password: form.password,
          confirmPassword: form.confirmPassword,
        };

    const submittedCaptchaToken = captchaToken.value;
    clearCaptchaToken();
    const result = await authStore.register(credentials, fingerprint, submittedCaptchaToken);

    if (result.success) {
      $q.notify({ type: 'positive', message: 'account created successfully' });
      if (result.verificationRequired) {
        void router.push('/verify-email');
      } else {
        // Backend creates session on register, redirect to home
        void router.push('/');
      }
    } else {
      $q.notify({ type: 'negative', message: result.error || 'registration failed' });
      captchaWidget.value?.reset();
    }
  } catch (err) {
    console.error(err);
    captchaWidget.value?.reset();
    $q.notify({ type: 'negative', message: 'connection failed' });
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped lang="scss">
@import 'src/css/auth-shared.scss';

.activation-state-card {
  width: min(550px, 100%);
  padding: 20px;
  color: var(--white);
  font-family: 'Courier New', 'Consolas', monospace;
  background: var(--card);
  border: 1px solid var(--white);
  border-radius: 0;
  box-shadow: none;
}

.activation-state-title,
.activation-approved-banner strong {
  color: var(--primary);
  font-weight: 700;
  letter-spacing: 0.08em;
}

.activation-state-card p,
.activation-approved-banner p {
  color: var(--muted);
  font-size: 0.75rem;
  line-height: 1.6;
}

.activation-progress {
  margin-top: 20px;
  border-radius: 0;
}

.activation-error-card {
  border-color: rgba(255, 0, 0, 0.5);
}

.activation-link {
  color: var(--primary);
  font-size: 0.75rem;
  text-decoration: none;
}

.activation-link:hover {
  text-decoration: underline;
}

.activation-approved-banner {
  margin-bottom: 20px;
  padding: 14px;
  background: var(--panel);
  border: 1px solid #1a1a1a;
  border-radius: 0;
}

.activation-approved-banner p {
  margin: 6px 0;
}

.activation-approved-banner small {
  color: var(--muted);
}
</style>
