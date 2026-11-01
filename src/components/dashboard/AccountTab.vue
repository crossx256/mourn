<template>
  <div>
    <!-- Tab Header -->
    <div class="flex justify-between items-start mb-6 gap-4">
      <div>
        <div class="dash-back-inline">
          <q-btn
            v-if="$q?.screen?.lt?.md"
            round
            flat
            icon="mdi-arrow-left"
            to="/"
            color="primary"
            size="md"
            dense
            class="dash-back-btn"
            aria-label="back to home"
          />
          <h1 class="text-xl text-primary m-0 tracking-wide lowercase font-bold leading-none">
            account
          </h1>
        </div>
        <p class="text-muted text-xs m-0">manage your account settings</p>
      </div>
    </div>

    <!-- Personal Invite Tree Section -->
    <q-card flat bordered dark class="dash-card mb-5" data-field="personal-invite-tree">
      <q-card-section>
        <div class="dash-section-title">personal invite tree</div>
        <UserInviteTree />
      </q-card-section>
    </q-card>

    <!-- Account Stats Section -->
    <q-card flat bordered dark class="dash-card mb-5">
      <q-card-section>
        <div class="dash-section-title">account info</div>

        <div class="grid grid-cols-2 gap-4">
          <div class="stat-item">
            <span class="text-muted text-xs">username</span>
            <span class="text-white font-mono">{{ dashboardStore.user?.username }}</span>
          </div>
          <div class="stat-item">
            <span class="text-muted text-xs">email</span>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-white font-mono">{{
                dashboardStore.user?.email || 'not set'
              }}</span>
              <q-btn
                flat
                dense
                no-caps
                size="sm"
                class="text-primary lowercase"
                :label="dashboardStore.user?.email ? 'change email' : 'set email'"
                @click="openEmailDialog"
              />
            </div>
          </div>
          <div class="stat-item">
            <span class="text-muted text-xs">member since</span>
            <span class="text-white font-mono">{{ formattedJoinDate }}</span>
          </div>
          <div class="stat-item">
            <span class="text-muted text-xs">referrals</span>
            <span class="text-white font-mono">{{ dashboardStore.user?.referralCount || 0 }}</span>
          </div>
          <div class="stat-item">
            <span class="text-muted text-xs">profile views</span>
            <span class="text-white font-mono">{{
              dashboardStore.profile.views?.toLocaleString() || 0
            }}</span>
          </div>
        </div>
      </q-card-section>
    </q-card>

    <!-- Email Verification Dialog -->
    <q-dialog v-model="showEmailDialog" persistent>
      <q-card dark class="bg-card text-white" style="min-width: 360px; max-width: 92vw">
        <q-card-section>
          <div class="text-lg font-bold text-primary mb-2">
            {{ dashboardStore.user?.email ? 'change email' : 'set email' }}
          </div>
          <p class="text-muted text-sm">
            enter an email address, then verify it with the 6-digit code we send.
          </p>
        </q-card-section>

        <q-card-section class="space-y-4">
          <q-input
            v-model="accountEmailInput"
            type="email"
            label="email address"
            stack-label
            dark
            filled
            square
            :disable="isVerifyingAccountEmail"
            autocomplete="email"
          />

          <q-input
            v-if="!isVerifyingAccountEmail"
            v-model="accountEmailPassword"
            type="password"
            label="current password"
            stack-label
            dark
            filled
            square
            autocomplete="current-password"
          />

          <q-input
            v-if="isVerifyingAccountEmail"
            v-model="accountEmailCode"
            type="text"
            label="verification code"
            stack-label
            dark
            filled
            square
            maxlength="6"
            input-class="font-mono"
            autocomplete="one-time-code"
          />

          <div v-if="accountEmailError" class="text-danger text-xs">{{ accountEmailError }}</div>
          <div v-if="accountEmailSuccess" class="text-green text-xs">{{ accountEmailSuccess }}</div>
        </q-card-section>

        <q-card-actions align="right" class="bg-panel">
          <q-btn flat label="cancel" color="grey" @click="closeEmailDialog" />
          <q-btn
            v-if="!isVerifyingAccountEmail"
            flat
            :label="dashboardStore.user?.email ? 'send code' : 'set email'"
            color="primary"
            :loading="isSubmittingAccountEmail"
            @click="requestAccountEmailVerification"
          />
          <q-btn
            v-else
            flat
            label="verify"
            color="primary"
            :loading="isSubmittingAccountEmail"
            @click="confirmAccountEmailVerification"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Security Section -->
    <q-card flat bordered dark class="dash-card mb-5" data-field="security">
      <q-card-section>
        <div class="dash-section-title">security</div>

        <q-btn
          outline
          no-caps
          color="grey"
          icon="mdi-lock-reset"
          label="send reset link"
          class="mb-2"
          :loading="isRequestingPasswordReset"
          :disable="isRequestingPasswordReset"
          @click="handlePasswordResetRequest"
        />
        <p class="text-muted text-xs">we'll email a link to the reset password page</p>
      </q-card-section>
    </q-card>

    <!-- Danger Zone Section -->
    <q-card
      flat
      bordered
      dark
      class="dash-card border-primary! danger-zone-card"
      data-field="danger-zone"
    >
      <q-card-section>
        <div class="dash-section-title text-primary">danger zone</div>
        <p class="text-muted text-xs mb-4">irreversible and destructive actions.</p>

        <q-btn
          outline
          no-caps
          color="primary"
          icon="mdi-delete-forever"
          label="delete account"
          @click="showDeleteConfirmDialog = true"
        />
        <p class="text-hellamuted text-xs mt-2">
          this will permanently delete your account, profile, and all associated data. this action
          cannot be undone.
        </p>
      </q-card-section>
    </q-card>

    <!-- Delete Account Security Prompt -->
    <q-dialog v-model="showDeleteConfirmDialog" persistent>
      <q-card
        class="bg-panel text-white p-8"
        style="min-width: 350px; max-width: 92vw; border: 1px solid var(--primary)"
      >
        <q-card-section class="p-0 pb-6">
          <div class="text-2xl font-bold text-primary mb-2">fade away?</div>
          <p class="text-muted text-sm">
            are you sure you want to delete your account? this action is permanent and cannot be
            undone.
          </p>
        </q-card-section>

        <q-card-actions align="right" class="bg-panel p-0 pt-0">
          <q-btn
            flat
            no-caps
            label="cancel"
            color="grey"
            @click="showDeleteConfirmDialog = false"
          />
          <q-btn no-caps label="delete account" color="primary" @click="openDeleteDialog" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Delete Account Dialog -->
    <q-dialog v-model="showDeleteDialog" persistent>
      <q-card dark class="bg-bg-primary text-white border border-primary" style="min-width: 350px">
        <q-card-section>
          <div class="text-lg font-bold text-primary mb-2">delete account</div>
          <p class="text-muted text-sm">
            are you absolutely sure? this action is
            <strong class="text-primary">permanent</strong> and cannot be undone.
          </p>
        </q-card-section>

        <q-card-section>
          <p class="text-muted text-xs mb-2">
            type <strong class="text-white">{{ dashboardStore.user?.username }}</strong> to confirm:
          </p>
          <q-input
            v-model="deleteForm.username"
            placeholder="your username"
            dark
            filled
            square
            class="mb-3 dashboard-no-label-field"
          />
          <q-input
            v-model="deleteForm.password"
            type="password"
            placeholder="your password"
            dark
            filled
            square
            class="mb-3 dashboard-no-label-field"
          />
          <q-input
            v-model="deleteForm.confirmText"
            placeholder='type "confirm" to proceed'
            dark
            filled
            square
            class="dashboard-no-label-field"
          />
          <div v-if="deleteError" class="text-danger text-xs mt-2">{{ deleteError }}</div>
        </q-card-section>

        <q-card-actions align="right" class="bg-panel">
          <q-btn flat label="cancel" color="grey" @click="closeDeleteDialog" />
          <q-btn
            unelevated
            label="permanently delete"
            color="primary"
            text-color="white"
            :loading="isDeleting"
            :disable="!canDeleteAccount"
            @click="handleDeleteAccount"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useDashboardStore } from 'src/stores/dashboard';
import { useAuthStore } from 'src/stores/auth';
import { useQuasar } from 'quasar';
import UserInviteTree from './UserInviteTree.vue';

const $q = useQuasar();
const router = useRouter();
const dashboardStore = useDashboardStore();
const authStore = useAuthStore();

// Dialog state
const showEmailDialog = ref(false);
const isVerifyingAccountEmail = ref(false);
const isSubmittingAccountEmail = ref(false);
const accountEmailInput = ref('');
const accountEmailCode = ref('');
const accountEmailPassword = ref('');
const accountEmailError = ref('');
const accountEmailSuccess = ref('');
const pendingAccountEmail = ref('');
const showDeleteDialog = ref(false);
const showDeleteConfirmDialog = ref(false);
const isRequestingPasswordReset = ref(false);

// Delete form state
const deleteForm = reactive({
  username: '',
  password: '',
  confirmText: '',
});
const deleteError = ref('');
const isDeleting = ref(false);

// Account info
const formattedJoinDate = computed(() => {
  if (!dashboardStore.user?.createdAt) return 'unknown';
  return new Date(dashboardStore.user.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
});

// Delete validation
const canDeleteAccount = computed(
  () =>
    deleteForm.username === dashboardStore.user?.username &&
    deleteForm.password.length > 0 &&
    deleteForm.confirmText === 'confirm',
);

function openEmailDialog() {
  const currentEmail = dashboardStore.user?.email || '';
  showEmailDialog.value = true;
  isVerifyingAccountEmail.value = false;
  accountEmailInput.value = currentEmail;
  accountEmailCode.value = '';
  accountEmailPassword.value = '';
  accountEmailError.value = '';
  accountEmailSuccess.value = '';
  pendingAccountEmail.value = '';
}

function closeEmailDialog() {
  showEmailDialog.value = false;
  isVerifyingAccountEmail.value = false;
  accountEmailInput.value = dashboardStore.user?.email || '';
  accountEmailCode.value = '';
  accountEmailPassword.value = '';
  accountEmailError.value = '';
  accountEmailSuccess.value = '';
  pendingAccountEmail.value = '';
}

async function requestAccountEmailVerification() {
  const email = accountEmailInput.value.trim();

  if (!email || !accountEmailPassword.value) {
    accountEmailError.value = 'enter an email address and your current password';
    return;
  }

  accountEmailError.value = '';
  accountEmailSuccess.value = '';
  isSubmittingAccountEmail.value = true;

  try {
    const result = await dashboardStore.requestAccountEmailVerification(
      email,
      accountEmailPassword.value,
    );

    if (result.success) {
      isVerifyingAccountEmail.value = true;
      pendingAccountEmail.value = email;
      accountEmailCode.value = '';
      accountEmailSuccess.value = 'verification code sent';
    } else {
      accountEmailError.value = result.error || 'failed to send verification code';
    }
  } finally {
    accountEmailPassword.value = '';
    isSubmittingAccountEmail.value = false;
  }
}

async function confirmAccountEmailVerification() {
  if (accountEmailCode.value.trim().length !== 6) {
    accountEmailError.value = 'enter the 6-digit code';
    return;
  }

  accountEmailError.value = '';
  accountEmailSuccess.value = '';
  isSubmittingAccountEmail.value = true;

  try {
    const result = await dashboardStore.confirmAccountEmailVerification(
      accountEmailCode.value.trim(),
    );

    if (result.success) {
      accountEmailSuccess.value = 'email verified';
      setTimeout(() => closeEmailDialog(), 900);
    } else {
      accountEmailError.value = result.error || 'failed to verify email';
    }
  } finally {
    isSubmittingAccountEmail.value = false;
  }
}

async function handlePasswordResetRequest() {
  const email = dashboardStore.user?.email || authStore.user?.email;

  if (!email) {
    $q.notify({
      type: 'negative',
      message: 'add an email address to request a reset link',
      position: 'bottom-right',
    });
    return;
  }

  isRequestingPasswordReset.value = true;

  try {
    await authStore.fetchCsrfToken();
    const result = await dashboardStore.requestPasswordReset(email);

    if (result.success) {
      $q.notify({
        type: 'positive',
        message: 'password reset link sent to your email',
        position: 'bottom-right',
      });
    } else {
      $q.notify({
        type: 'negative',
        message: result.error || 'failed to send reset link',
        position: 'bottom-right',
      });
    }
  } finally {
    isRequestingPasswordReset.value = false;
  }
}

// Delete account handlers
function closeDeleteDialog() {
  showDeleteDialog.value = false;
  deleteForm.username = '';
  deleteForm.password = '';
  deleteForm.confirmText = '';
  deleteError.value = '';
}

function openDeleteDialog() {
  showDeleteConfirmDialog.value = false;
  showDeleteDialog.value = true;
}

async function handleDeleteAccount() {
  if (!canDeleteAccount.value) return;

  isDeleting.value = true;
  deleteError.value = '';

  const result = await dashboardStore.deleteAccount(
    deleteForm.username,
    deleteForm.password,
    deleteForm.confirmText,
  );

  if (result.success) {
    $q.notify({
      message: 'account deleted successfully',
      color: 'positive',
      position: 'bottom',
    });
    void router.push('/');
  } else {
    deleteError.value = result.error || 'failed to delete account';
  }

  isDeleting.value = false;
}
</script>

<style scoped>
.danger-zone-card {
  border-color: var(--primary) !important;
  transition: none !important;
}

.danger-zone-card:hover,
.danger-zone-card:focus-within {
  border-color: var(--primary) !important;
  box-shadow: none !important;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  background: var(--panel, #0d0d0d);
  border-radius: 4px;
}
</style>
