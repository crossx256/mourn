<template>
  <q-dialog v-model="modelValue" persistent>
    <q-card class="modal-card">
      <q-card-section class="modal-header">
        <h3>change password</h3>
        <q-btn flat round dense icon="close" @click="closeModal" />
      </q-card-section>

      <q-card-section class="modal-body">
        <div class="form-group">
          <label class="form-label">current password</label>
          <div class="password-input-wrapper">
            <input
              v-model="currentPassword"
              :type="showCurrentPassword ? 'text' : 'password'"
              class="form-input"
              placeholder="Enter current password"
            />
            <button
              type="button"
              class="password-toggle"
              @click="showCurrentPassword = !showCurrentPassword"
            >
              <i :class="showCurrentPassword ? 'fas fa-eye-slash' : 'fas fa-eye'"></i>
            </button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">new password</label>
          <div class="password-input-wrapper">
            <input
              v-model="newPassword"
              :type="showNewPassword ? 'text' : 'password'"
              class="form-input"
              placeholder="Enter new password"
            />
            <button
              type="button"
              class="password-toggle"
              @click="showNewPassword = !showNewPassword"
            >
              <i :class="showNewPassword ? 'fas fa-eye-slash' : 'fas fa-eye'"></i>
            </button>
          </div>
          <div class="password-strength" v-if="newPassword">
            <div class="strength-bar" :class="passwordStrengthClass">
              <div class="strength-fill" :style="{ width: `${passwordStrength}%` }"></div>
            </div>
            <span class="strength-text">{{ passwordStrengthText }}</span>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">confirm new password</label>
          <div class="password-input-wrapper">
            <input
              v-model="confirmPassword"
              :type="showConfirmPassword ? 'text' : 'password'"
              class="form-input"
              :class="{ error: confirmPassword && confirmPassword !== newPassword }"
              placeholder="Confirm new password"
            />
            <button
              type="button"
              class="password-toggle"
              @click="showConfirmPassword = !showConfirmPassword"
            >
              <i :class="showConfirmPassword ? 'fas fa-eye-slash' : 'fas fa-eye'"></i>
            </button>
          </div>
          <p v-if="confirmPassword && confirmPassword !== newPassword" class="error-text">
            Passwords do not match
          </p>
        </div>
      </q-card-section>

      <q-card-actions class="modal-actions">
        <button type="button" class="btn-secondary" @click="closeModal">cancel</button>
        <button
          type="button"
          class="btn-primary"
          :disabled="!canSubmit || isSubmitting"
          @click="handleSubmit"
        >
          <i v-if="isSubmitting" class="fas fa-spinner fa-spin"></i>
          <span v-else>change password</span>
        </button>
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useDashboardStore } from 'src/stores/dashboard';

const modelValue = defineModel<boolean>({ default: false });
const emit = defineEmits<{
  (e: 'success', message: string): void;
  (e: 'error', message: string): void;
}>();

const dashboardStore = useDashboardStore();

// Form state
const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const showCurrentPassword = ref(false);
const showNewPassword = ref(false);
const showConfirmPassword = ref(false);
const isSubmitting = ref(false);

// Password strength calculation
const passwordStrength = computed(() => {
  const password = newPassword.value;
  if (!password) return 0;

  let strength = 0;

  // Length checks
  if (password.length >= 8) strength += 25;
  if (password.length >= 12) strength += 15;

  // Character variety
  if (/[a-z]/.test(password)) strength += 15;
  if (/[A-Z]/.test(password)) strength += 15;
  if (/[0-9]/.test(password)) strength += 15;
  if (/[^a-zA-Z0-9]/.test(password)) strength += 15;

  return Math.min(100, strength);
});

const passwordStrengthClass = computed(() => {
  const strength = passwordStrength.value;
  if (strength < 30) return 'weak';
  if (strength < 60) return 'fair';
  if (strength < 80) return 'good';
  return 'strong';
});

const passwordStrengthText = computed(() => {
  const strength = passwordStrength.value;
  if (strength < 30) return 'weak';
  if (strength < 60) return 'fair';
  if (strength < 80) return 'good';
  return 'strong';
});

const canSubmit = computed(() => {
  return (
    currentPassword.value.length > 0 &&
    newPassword.value.length >= 12 &&
    newPassword.value === confirmPassword.value
  );
});

// Reset form when modal closes
watch(modelValue, (value) => {
  if (!value) {
    currentPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
    showCurrentPassword.value = false;
    showNewPassword.value = false;
    showConfirmPassword.value = false;
  }
});

function closeModal() {
  modelValue.value = false;
}

async function handleSubmit() {
  if (!canSubmit.value || isSubmitting.value) return;

  isSubmitting.value = true;

  try {
    const result = await dashboardStore.changePassword(currentPassword.value, newPassword.value);
    if (!result.success) {
      emit('error', result.error || 'Failed to change password');
      return;
    }
    emit('success', 'Password changed successfully');
    closeModal();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to change password';
    emit('error', errorMessage);
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.modal-card {
  background: var(--dash-panel);
  border-radius: 0;
  border: 1px solid var(--dash-border);
  width: 480px;
  min-width: 0;
  max-width: calc(100vw - 32px);
  overflow-wrap: anywhere;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--dash-border);
  padding: 20px 24px;

  h3 {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--dash-text);
    margin: 0;
    text-transform: lowercase;
    letter-spacing: 0.5px;
    font-family: 'Courier New', monospace;
  }

  .q-btn {
    color: var(--dash-muted);
  }
}

.modal-body {
  padding: 24px;
}

.form-group {
  margin-bottom: 20px;

  &:last-child {
    margin-bottom: 0;
  }
}

.form-label {
  display: block;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--dash-muted);
  margin-bottom: 8px;
  font-family: 'Courier New', monospace;
}

.password-input-wrapper {
  position: relative;
}

.form-input {
  width: 100%;
  height: 38px;
  background: var(--dash-bg);
  border: 1px solid var(--dash-border);
  border-radius: 0;
  padding: 8px 44px 8px 10px;
  color: var(--dash-text);
  font-size: 0.85rem;
  font-family: 'Courier New', monospace;
  transition:
    border-color 0.3s ease,
    box-shadow 0.3s ease;

  &::placeholder {
    color: var(--dash-muted);
    opacity: 0.5;
  }

  &:focus {
    outline: none;
    border-color: var(--dash-accent);
    box-shadow:
      0 0 0 2px var(--dash-accent-dim),
      0 0 10px rgba(255, 0, 0, 0.1);
  }

  &.error {
    border-color: var(--dash-error);

    &:focus {
      box-shadow: 0 0 0 2px rgba(255, 0, 0, 0.15);
    }
  }
}

.password-toggle {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--dash-muted);
  cursor: pointer;
  padding: 4px;

  &:hover {
    color: var(--dash-text);
  }
}

.password-strength {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.strength-bar {
  flex: 1;
  height: 4px;
  background: var(--dash-border);
  border-radius: 0;
  overflow: hidden;

  &.weak .strength-fill {
    background: #ef4444;
  }

  &.fair .strength-fill {
    background: #f59e0b;
  }

  &.good .strength-fill {
    background: #10b981;
  }

  &.strong .strength-fill {
    background: #22c55e;
  }
}

.strength-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.strength-text {
  font-size: 0.7rem;
  color: var(--dash-muted);
  text-transform: lowercase;
  font-family: 'Courier New', monospace;
}

.error-text {
  margin-top: 6px;
  font-size: 0.75rem;
  color: var(--dash-error);
  font-family: 'Courier New', monospace;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px;
  border-top: 1px solid var(--dash-border);
}

.btn-secondary {
  height: 36px;
  padding: 0 16px;
  background: transparent;
  border: 1px solid var(--dash-border);
  border-radius: 0;
  color: var(--dash-text);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  font-family: 'Courier New', monospace;
  text-transform: lowercase;
  letter-spacing: 0.5px;
  transition: all 0.2s ease;

  &:hover {
    background: var(--dash-card);
  }
}

.btn-primary {
  height: 36px;
  padding: 0 16px;
  background: var(--dash-accent);
  border: 1px solid var(--dash-accent);
  border-radius: 0;
  color: var(--dash-bg);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  font-family: 'Courier New', monospace;
  text-transform: lowercase;
  letter-spacing: 0.5px;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    background: #cc0000;
    border-color: rgb(var(--m-accentStrong-rgb));
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
</style>
