<template>
  <q-page-container class="application-page-container">
    <q-page class="application-page">
      <q-card class="auth-card application-card" square flat>
        <q-card-section class="application-header">
          <div class="application-kicker">// registration application</div>
          <h1>apply to Mourn</h1>
          <p v-show="!submitted">
            Answer carefully. There is no re-answer path. If your application is rejected, you are
            locked out for 14 days before you can apply again.
          </p>
        </q-card-section>

        <q-card-section v-show="submitted" class="application-result application-result-success">
          <div class="application-result-title">thank you. your application was received.</div>
          <p>
            Thank you for taking the time to apply to Mourn. Applications are reviewed once or twice
            weekly, so expect a response in roughly one week.
          </p>
          <p>
            Watch your inbox and spam folder for our reply. While you wait, you can learn more about
            Mourn or read the Archives.
          </p>
          <nav class="application-result-links" aria-label="Continue exploring Mourn">
            <router-link to="/about" class="application-link">[ about Mourn ]</router-link>
            <router-link to="/archives" class="application-link"
              >[ browse the Archives ]</router-link
            >
            <router-link to="/" class="application-link">[ return home ]</router-link>
          </nav>
        </q-card-section>

        <q-card-section v-show="!submitted">
          <section class="guidance-panel" aria-labelledby="evaluation-guidance-title">
            <h2 id="evaluation-guidance-title">// how your answers are evaluated</h2>
            <div class="guidance-item">
              <strong>Q1 and Q2 are factual.</strong> Give a short, honest answer to each.
            </div>
            <div class="guidance-item">
              <strong>Q3 is the main evaluation question.</strong> A good answer shows you actually
              understand what Mourn is and why it exists. Do not submit a one-line rehash of the
              About page or generic "community" talk. We are looking for genuine engagement with the
              idea.
            </div>
            <div class="guidance-item">
              <strong>Q4 asks what you can contribute.</strong> Be specific. "I'm good with people"
              is not useful. The purpose is to gather skills that can later be used if needed.
            </div>
            <div class="guidance-item">
              <strong>Q5 asks for transparency.</strong> An honest "no" is perfectly fine; a
              dishonest omission is not.
            </div>
            <div class="guidance-warning" role="note" aria-label="Important submission warning">
              <div class="guidance-warning-title">
                <q-icon name="sym_o_warning" size="20px" aria-hidden="true" />
                <span>review before submitting</span>
              </div>
              <p>
                Unsatisfactory answers are rejected with a reason and the 14-day cooldown applies.
                Resource links may be included in the rejection. Review every answer before
                submitting.
              </p>
            </div>
          </section>

          <div
            v-if="submissionError"
            ref="submissionErrorRef"
            class="application-result application-result-error"
            role="alert"
            aria-live="assertive"
            tabindex="-1"
          >
            <div class="application-result-title">application not submitted</div>
            <p>{{ submissionError }}</p>
            <router-link v-if="showRejectionResource" to="/about" class="application-link">
              [ read about Mourn before reapplying ]
            </router-link>
          </div>

          <q-form
            class="application-form"
            @submit.prevent="onSubmit"
            @validation-error="onValidationError"
          >
            <input type="hidden" name="_csrf" :value="authStore.csrfToken" />

            <div ref="emailGroupRef" class="form-group">
              <label class="auth-label" for="application-email">email</label>
              <q-input
                id="application-email"
                v-model="form.email"
                type="email"
                placeholder="you@example.com"
                dense
                outlined
                square
                maxlength="254"
                autocomplete="email"
                :rules="[requiredRule, authRules.email]"
              />
            </div>

            <div ref="whereLearnedGroupRef" class="form-group question-group">
              <label class="auth-label" for="where-learned"
                >1) Where did you learn about Mourn?</label
              >
              <q-input
                id="where-learned"
                v-model="form.whereLearned"
                type="textarea"
                autogrow
                outlined
                square
                counter
                :maxlength="LIMITS.whereLearned"
                :rules="[requiredRule, maxLengthRule(LIMITS.whereLearned)]"
              />
            </div>

            <div ref="invitedByGroupRef" class="form-group question-group">
              <label class="auth-label" for="invited-by-answer">
                2) Were you invited here by an already active member? If so please provide their
                Mourn username or their mourn.bio/{username} profile link so they may receive the
                referral.
              </label>
              <div class="field-note">username or profile link · no lookup is performed</div>
              <q-input
                id="invited-by-answer"
                v-model="form.invitedByAnswer"
                type="textarea"
                autogrow
                outlined
                square
                counter
                :maxlength="LIMITS.invitedByAnswer"
                :rules="[requiredRule, maxLengthRule(LIMITS.invitedByAnswer)]"
              />
            </div>

            <div ref="mournUnderstandingGroupRef" class="form-group question-group">
              <label class="auth-label" for="mourn-understanding">
                3) Please describe in detail your understanding of Mourn and what we aim to
                accomplish.
              </label>
              <div class="field-note">this is the main evaluation question</div>
              <q-btn
                flat square no-caps
                label="read about us"
                class="about-reading-button q-mb-sm"
                :disable="loading"
                @click="openAboutReading"
              />
              <p id="about-reading-status" class="field-note" role="status">
                {{ aboutRead ? 'Reading confirmed. You can now answer question 3.' : 'Read About Us to the bottom and click “I read” to unlock this answer.' }}
              </p>
              <q-input
                id="mourn-understanding"
                v-model="form.mournUnderstanding"
                :disable="!aboutRead"
                aria-describedby="about-reading-status"
                type="textarea"
                autogrow
                outlined
                square
                counter
                :maxlength="LIMITS.mournUnderstanding"
                :rules="[requiredRule, maxLengthRule(LIMITS.mournUnderstanding)]"
              />
            </div>

            <div ref="skillsGroupRef" class="form-group question-group">
              <label class="auth-label" for="skills">
                4) Do you have any skills worth mentioning? (online or in person)
              </label>
              <div class="field-note">be specific</div>
              <q-input
                id="skills"
                v-model="form.skills"
                type="textarea"
                autogrow
                outlined
                square
                counter
                :maxlength="LIMITS.skills"
                :rules="[requiredRule, maxLengthRule(LIMITS.skills)]"
              />
            </div>

            <div ref="backgroundDisclosureGroupRef" class="form-group question-group">
              <label class="auth-label" for="background-disclosure">
                5) Do you have any form of criminal record or past experiences that should be made
                known?
              </label>
              <div class="field-note">
                answer honestly; enter “no” when there is nothing to disclose
              </div>
              <q-input
                id="background-disclosure"
                v-model="form.backgroundDisclosure"
                type="textarea"
                autogrow
                outlined
                square
                counter
                :maxlength="LIMITS.backgroundDisclosure"
                :rules="[requiredRule, maxLengthRule(LIMITS.backgroundDisclosure)]"
              />
            </div>

            <div class="submission-confirmation">
              <q-checkbox
                v-model="reviewedAnswers"
                color="primary"
                keep-color
                dark
                dense
                :disable="loading"
                label="I have reviewed all of my answers, understand they cannot be revised after submission, and understand that rejection starts a 14-day cooldown."
              />
            </div>

            <div class="captcha-container">
              <CapCaptcha
                ref="captchaWidget"
                :api-endpoint="CAP_API_ENDPOINT"
                @token="captchaToken = $event"
                @error="submissionError = $event"
              />
            </div>

            <div class="submit-button-shell" @click="onSubmitButtonShellClick">
              <q-btn
                id="application-submit-btn"
                label="submit application"
                type="submit"
                class="auth-btn"
                square
                :loading="loading"
                :disable="submitDisabled"
              />
            </div>
          </q-form>
        </q-card-section>
      </q-card>
      <q-dialog
        v-model="aboutDialogOpen"
        aria-labelledby="about-reading-title"
        aria-describedby="about-reading-instructions"
        @show="onAboutReadingShow"
        @hide="stopAboutReadingObserver"
      >
        <q-card square flat class="about-reading-dialog bg-dark text-secondary">
          <q-card-section class="about-reading-header">
            <h2 id="about-reading-title">About Us</h2>
            <q-btn flat square icon="close" aria-label="Close About Us without confirming" v-close-popup />
          </q-card-section>
          <p id="about-reading-instructions" class="about-reading-instructions">
            Read to the bottom, then click “I read” to unlock question 3.
          </p>
          <div
            ref="aboutReadingRegion"
            class="about-reading-region"
            tabindex="0"
            role="region"
            aria-label="About Mourn required reading"
            @scroll.passive="updateAboutReadingBottom"
          >
            <div ref="aboutReadingContent" class="about-reading-content">
              <AboutMournContent />
            </div>
          </div>
          <q-card-actions class="about-reading-actions" align="right">
            <span class="field-note" role="status">
              {{ aboutReadingAtBottom ? 'Ready to confirm.' : 'Scroll to the bottom to confirm.' }}
            </span>
            <q-btn flat square no-caps label="Close" v-close-popup />
            <q-btn square no-caps color="primary" label="I read" :disable="!aboutReadingAtBottom" @click="confirmAboutReading" />
          </q-card-actions>
        </q-card>
      </q-dialog>
    </q-page>
  </q-page-container>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref } from 'vue';
import { useQuasar } from 'quasar';
import { collectClientFingerprint, hashClientFingerprint } from 'src/services/clientFingerprint';
import { useAuthStore } from 'src/stores/auth';
import type { ApiResponseEnvelope } from 'src/types/api';
import { authRules } from 'src/utils/validation';
import CapCaptcha from 'src/components/security/CapCaptcha.vue';
import AboutMournContent from 'src/components/AboutMournContent.vue';

const LIMITS = {
  whereLearned: 2000,
  invitedByAnswer: 500,
  mournUnderstanding: 8000,
  skills: 4000,
  backgroundDisclosure: 4000,
} as const;

interface RegistrationApplicationResponse {
  message?: string;
  status?: string;
}

type ApplicationErrorKind = 'pending' | 'approved' | 'rejected' | 'generic';

const $q = useQuasar();
const authStore = useAuthStore();
const CAP_API_ENDPOINT = import.meta.env.VITE_CAP_API_ENDPOINT || '';
const loading = ref(false);
const submitted = ref(false);
const submissionError = ref('');
const submissionErrorRef = ref<HTMLElement | null>(null);
const emailGroupRef = ref<HTMLElement | null>(null);
const whereLearnedGroupRef = ref<HTMLElement | null>(null);
const invitedByGroupRef = ref<HTMLElement | null>(null);
const mournUnderstandingGroupRef = ref<HTMLElement | null>(null);
const skillsGroupRef = ref<HTMLElement | null>(null);
const backgroundDisclosureGroupRef = ref<HTMLElement | null>(null);
const showRejectionResource = ref(false);
const captchaToken = ref('');
const captchaWidget = ref<InstanceType<typeof CapCaptcha> | null>(null);
const reviewedAnswers = ref(false);
const aboutRead = ref(false);
const aboutDialogOpen = ref(false);
const aboutReadingAtBottom = ref(false);
const aboutReadingRegion = ref<HTMLElement | null>(null);
const aboutReadingContent = ref<HTMLElement | null>(null);
let aboutReadingObserver: ResizeObserver | null = null;

function updateAboutReadingBottom() {
  const region = aboutReadingRegion.value;
  if (!aboutDialogOpen.value || !region || region.clientHeight <= 0) {
    aboutReadingAtBottom.value = false;
    return;
  }
  aboutReadingAtBottom.value =
    region.scrollHeight - region.clientHeight - region.scrollTop <= 2;
}

function stopAboutReadingObserver() {
  aboutReadingObserver?.disconnect();
  aboutReadingObserver = null;
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateAboutReadingBottom);
  }
}

function openAboutReading() {
  aboutReadingAtBottom.value = false;
  aboutDialogOpen.value = true;
}

async function onAboutReadingShow() {
  await nextTick();
  if (!aboutDialogOpen.value) return;
  stopAboutReadingObserver();
  const region = aboutReadingRegion.value;
  if (!region) return;
  region.scrollTop = 0;
  region.focus({ preventScroll: true });
  if (typeof ResizeObserver !== 'undefined') {
    aboutReadingObserver = new ResizeObserver(updateAboutReadingBottom);
    aboutReadingObserver.observe(region);
    if (aboutReadingContent.value) aboutReadingObserver.observe(aboutReadingContent.value);
  }
  window.addEventListener('resize', updateAboutReadingBottom);
  updateAboutReadingBottom();
}

async function confirmAboutReading() {
  updateAboutReadingBottom();
  if (!aboutReadingAtBottom.value) return;
  aboutRead.value = true;
  aboutDialogOpen.value = false;
  await nextTick();
  mournUnderstandingGroupRef.value?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
}

const form = reactive({
  email: '',
  whereLearned: '',
  invitedByAnswer: '',
  mournUnderstanding: '',
  skills: '',
  backgroundDisclosure: '',
});

const allFieldsAnswered = computed(() =>
  Object.values(form).every((value) => value.trim().length > 0),
);
const submitDisabled = computed(
  () => loading.value || !aboutRead.value || !reviewedAnswers.value || !allFieldsAnswered.value,
);

const requiredRule = (value: string) => Boolean(value?.trim()) || 'Required';
const maxLengthRule = (max: number) => (value: string) =>
  !value || value.length <= max || `Maximum ${max} characters`;

function clearCaptchaToken() {
  captchaToken.value = '';
}

function resetCaptcha() {
  captchaWidget.value?.reset();
  clearCaptchaToken();
}

function classifyApplicationError(code: string, message: string): ApplicationErrorKind {
  const marker = `${code} ${message}`.toLowerCase();
  if (marker.includes('pending')) return 'pending';
  if (marker.includes('approved')) return 'approved';
  if (marker.includes('rejected') || marker.includes('cooldown')) return 'rejected';
  return 'generic';
}

async function revealSubmissionError(message: string, showResource = false) {
  submissionError.value = message;
  showRejectionResource.value = showResource;
  $q.notify({
    type: 'negative',
    message,
    position: 'top',
    timeout: 5000,
  });

  await nextTick();
  const errorElement = submissionErrorRef.value;
  if (!errorElement) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  errorElement.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  errorElement.focus({ preventScroll: true });
}

function findFirstIncompleteField() {
  return [
    { label: 'your email address', value: form.email, element: emailGroupRef.value },
    { label: 'question 1', value: form.whereLearned, element: whereLearnedGroupRef.value },
    { label: 'question 2', value: form.invitedByAnswer, element: invitedByGroupRef.value },
    {
      label: 'question 3',
      value: form.mournUnderstanding,
      element: mournUnderstandingGroupRef.value,
    },
    { label: 'question 4', value: form.skills, element: skillsGroupRef.value },
    {
      label: 'question 5',
      value: form.backgroundDisclosure,
      element: backgroundDisclosureGroupRef.value,
    },
  ].find((field) => field.value.trim().length === 0);
}

async function revealIncompleteField() {
  const field = findFirstIncompleteField();
  if (!field) return false;

  const message = `Complete ${field.label} before submitting.`;
  submissionError.value = message;
  showRejectionResource.value = false;
  $q.notify({ type: 'negative', message, position: 'top', timeout: 5000 });

  await nextTick();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  field.element?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  field.element?.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
  return true;
}

function onValidationError() {
  if (!aboutRead.value) {
    openAboutReading();
    return;
  }
  void revealIncompleteField();
}

function onSubmitButtonShellClick() {
  if (loading.value) return;
  if (!aboutRead.value) {
    openAboutReading();
    return;
  }
  if (!allFieldsAnswered.value) {
    void revealIncompleteField();
    return;
  }
  if (!reviewedAnswers.value) {
    void revealSubmissionError(
      'Confirm that you reviewed your answers and understand the submission terms before continuing.',
    );
  }
}

async function handleApplicationError(body: ApiResponseEnvelope<RegistrationApplicationResponse>) {
  const backendMessage = body.error || body.message || '';
  const kind = classifyApplicationError(body.code || '', backendMessage);

  const fallbackByKind: Record<ApplicationErrorKind, string> = {
    pending: 'Your application is already pending. We review applications once or twice a week.',
    approved: 'This application was already approved. Use the activation link sent by Mourn.',
    rejected: 'You cannot submit another application until the 14-day cooldown has ended.',
    generic: 'Application submission failed. Check your answers and try again.',
  };

  resetCaptcha();
  await revealSubmissionError(backendMessage || fallbackByKind[kind], kind === 'rejected');
}

async function onSubmit() {
  submissionError.value = '';
  showRejectionResource.value = false;

  if (!aboutRead.value) {
    openAboutReading();
    return;
  }

  if (await revealIncompleteField()) return;

  if (!reviewedAnswers.value) {
    await revealSubmissionError(
      'Confirm that you reviewed your answers and understand the submission terms before continuing.',
    );
    return;
  }

  loading.value = true;

  try {
    if (!captchaToken.value) {
      await revealSubmissionError('Complete the captcha before submitting.');
      return;
    }

    const fingerprint = await collectClientFingerprint();
    const deviceFingerprint = await hashClientFingerprint(fingerprint);

    const submittedCaptchaToken = captchaToken.value;
    clearCaptchaToken();
    const response = await authStore.postWithFreshCsrf<
      ApiResponseEnvelope<RegistrationApplicationResponse>
    >(
      '/api/v1/registration-applications',
      {
        email: form.email.trim(),
        whereLearned: form.whereLearned.trim(),
        invitedByAnswer: form.invitedByAnswer.trim(),
        mournUnderstanding: form.mournUnderstanding.trim(),
        skills: form.skills.trim(),
        backgroundDisclosure: form.backgroundDisclosure.trim(),
        ...(deviceFingerprint ? { deviceFingerprint } : {}),
        captchaProvider: 'cap',
        captchaToken: submittedCaptchaToken,
      },
      { 'Content-Type': 'application/json' },
    );

    if (response.data?.success !== true) {
      await handleApplicationError(response.data);
      return;
    }

    submitted.value = true;
  } catch (error: unknown) {
    const body = (
      error as { response?: { data?: ApiResponseEnvelope<RegistrationApplicationResponse> } }
    )?.response?.data;

    if (body) {
      await handleApplicationError(body);
    } else {
      resetCaptcha();
      await revealSubmissionError('Connection failed. Your application was not submitted.');
    }
  } finally {
    loading.value = false;
  }
}

onBeforeUnmount(() => {
  stopAboutReadingObserver();
  clearCaptchaToken();
});
</script>

<style scoped lang="scss">
@import 'src/css/auth-shared.scss';

.about-reading-dialog {
  width: 850px;
  max-width: calc(100vw - 32px);
  height: 85vh;
  height: 85dvh;
  max-height: calc(100dvh - 32px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #1a1a1a;
  font-family: 'Courier New', 'Consolas', monospace;
}

.about-reading-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;

  h2 { margin: 0; font-size: 1.02rem; font-weight: 700; }
}

.about-reading-instructions { margin: 0; padding: 0 16px 16px; font-size: 0.85rem; }

.about-reading-region {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-color: var(--q-secondary) #101010;

  &:focus-visible { outline: 2px solid var(--q-primary); outline-offset: -2px; }
}

.about-reading-content { display: flex; justify-content: center; padding: 24px 0; }
.about-reading-actions { flex-shrink: 0; gap: 8px; border-top: 1px solid #1a1a1a; }
.about-reading-actions .field-note { margin-right: auto; }

.application-page-container,
.application-page {
  min-height: 100%;
  margin: 0;
  padding: 0;
  background: var(--black);
}

@media (min-width: 1024px) {
  .application-page-container {
    padding-top: 0 !important;
    padding-bottom: 0 !important;
  }
}

.application-page {
  display: flex;
  justify-content: center;
  padding: 48px 18px;
  color: var(--white);
  font-family: 'Courier New', 'Consolas', monospace;
}

.application-card {
  --border: #1a1a1a;

  width: min(900px, 100%);
  height: fit-content;
  margin-bottom: 64px;
  overflow: hidden;
  color: var(--white);
  background: var(--card);
  border: 1px solid var(--white);
  border-radius: 0;
  box-shadow: none;
}

.application-header {
  padding: 28px 28px 20px;
}

.application-kicker,
.application-header h1,
.guidance-panel h2,
.application-result-title {
  color: var(--primary);
  font-family: 'Courier New', 'Consolas', monospace;
  font-weight: 700;
}

.application-kicker {
  margin-bottom: 8px;
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.application-header h1 {
  margin: 0 0 18px;
  font-size: clamp(1.35rem, 4vw, 2rem);
}

.application-header p,
.application-result p {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 0.82rem;
  line-height: 1.7;
}

.guidance-panel {
  margin-bottom: 28px;
  padding: 20px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 0;
}

.guidance-panel h2 {
  margin: 0 0 16px;
  padding-bottom: 10px;
  font-size: 0.85rem;
  border-bottom: 1px solid var(--border);
}

.guidance-item {
  padding: 10px 0;
  color: var(--muted);
  font-size: 0.75rem;
  line-height: 1.65;
  border-bottom: 1px solid var(--border);
}

.guidance-item strong {
  color: var(--white);
}

.guidance-warning {
  margin-top: 18px;
  padding: 16px;
  color: var(--white);
  font-size: 0.78rem;
  line-height: 1.65;
  background: rgba(255, 0, 0, 0.16);
  border: 1px solid var(--primary);
  border-left-width: 4px;
  border-radius: 0;
  box-shadow: inset 0 0 24px rgba(255, 0, 0, 0.06);
}

.guidance-warning-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--white);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.guidance-warning-title :deep(.q-icon) {
  color: var(--primary);
}

.guidance-warning p {
  margin: 0;
  color: var(--white);
}

.submission-confirmation {
  padding: 14px;
  color: var(--white);
  font-size: 0.75rem;
  line-height: 1.6;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 0;
}

.submission-confirmation :deep(.q-checkbox__label) {
  color: var(--white);
  line-height: 1.6;
}

.application-form {
  display: grid;
  gap: 22px;
}

.form-group {
  margin: 0;
  padding: 18px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.025), transparent 55%), var(--panel);
  border: 1px solid var(--border);
  border-left: 3px solid rgba(255, 0, 0, 0.45);
}

.form-group:focus-within {
  border-color: rgba(255, 0, 0, 0.7);
  border-left-color: var(--primary);
  box-shadow: inset 0 0 24px rgba(255, 0, 0, 0.04);
}

.auth-label {
  display: block;
  margin-bottom: 9px;
  color: var(--white);
  font-size: 0.78rem;
  line-height: 1.55;
}

.application-card .form-group:focus-within > .auth-label {
  color: var(--white);
}

.field-note {
  margin: -3px 0 8px;
  color: var(--muted);
  font-size: 0.65rem;
}

.question-group :deep(textarea) {
  min-height: 74px;
  color: var(--white);
  font-family: 'Courier New', 'Consolas', monospace;
  line-height: 1.55;
  caret-color: var(--primary);
}

.application-form :deep(.q-field__counter) {
  color: var(--white);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  opacity: 1;
}

.application-result {
  margin: 0 16px 24px;
  padding: 18px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 0;
}

.application-result-success {
  margin: 28px;
  border-color: rgba(255, 0, 0, 0.35);
}

.application-result-links {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  margin-top: 20px;
}

.application-result-error {
  margin-right: 0;
  margin-left: 0;
  color: var(--white);
  background: #160000;
  border: 2px solid var(--primary);
  outline: none;
  box-shadow: 0 0 24px rgba(255, 0, 0, 0.18);
}

.application-result-error .application-result-title {
  color: #ff6666;
}

.application-result-error p {
  color: var(--white);
}

.captcha-container {
  display: flex;
  min-height: 78px;
  align-items: center;
  justify-content: center;
}

.submit-button-shell {
  width: 100%;
}

.submit-button-shell:has(.q-btn.disabled) {
  cursor: not-allowed;
}

.submit-button-shell .q-btn.disabled {
  pointer-events: none;
}

.auth-btn {
  width: 100%;
  padding: 12px;
  color: var(--black);
  font-family: 'Courier New', 'Consolas', monospace;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  background: var(--primary);
  border: 2px solid var(--primary);
  border-radius: 0;
}

.auth-btn:hover {
  color: var(--primary);
  background: var(--black);
}

.about-reading-button {
  background: var(--black) !important;
  color: var(--white);
  border: 1px solid var(--primary);
  text-transform: none;
}

.application-link {
  color: var(--primary);
  text-decoration: none;
}

.application-link:hover {
  text-decoration: underline;
}

@media (max-width: 600px) {
  .application-page {
    padding: 0;
  }

  .application-card {
    margin-bottom: 48px;
    border-right: 0;
    border-left: 0;
  }

  .application-header {
    padding: 24px 16px 18px;
  }

  .guidance-panel {
    padding: 16px;
  }

  .application-result-success {
    margin: 20px 16px;
  }
}
</style>
