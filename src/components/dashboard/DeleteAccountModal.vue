<template>
  <q-dialog v-model="modelValue" persistent>
    <q-card class="modal-card danger-modal">
      <q-card-section class="modal-header">
        <h3><i class="fas fa-exclamation-triangle"></i> delete account</h3>
        <q-btn flat round dense icon="close" @click="closeModal" />
      </q-card-section>

      <q-card-section class="modal-body">
        <div class="warning-banner">
          <i class="fas fa-skull-crossbones"></i>
          <div class="warning-content">
            <h4>this action is irreversible</h4>
            <p>
              Deleting your account will permanently remove all your data, including your profile,
              settings, and any associated content. This cannot be undone.
            </p>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">
            type your username to confirm: <strong>{{ username }}</strong>
          </label>
          <input
            v-model="confirmUsername"
            type="text"
            class="form-input"
            :class="{ error: confirmUsername && confirmUsername !== username }"
            placeholder="Enter your username"
          />
        </div>

        <div class="form-group">
          <label class="form-label">enter your password</label>
          <div class="password-input-wrapper">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              class="form-input"
              placeholder="Enter your password"
            />
            <button type="button" class="password-toggle" @click="showPassword = !showPassword">
              <i :class="showPassword ? 'fas fa-eye-slash' : 'fas fa-eye'"></i>
            </button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label"> type <strong>DELETE MY ACCOUNT</strong> to confirm </label>
          <input
            v-model="confirmText"
            type="text"
            class="form-input"
            :class="{ error: confirmText && confirmText !== 'DELETE MY ACCOUNT' }"
            placeholder="DELETE MY ACCOUNT"
          />
        </div>
      </q-card-section>

      <q-card-actions class="modal-actions">
        <button type="button" class="btn-secondary" @click="closeModal">cancel</button>
        <button
          type="button"
          class="btn-danger"
          :disabled="!canSubmit || isSubmitting"
          @click="handleSubmit"
        >
          <i v-if="isSubmitting" class="fas fa-spinner fa-spin"></i>
          <span v-else><i class="fas fa-trash"></i> delete my account</span>
        </button>
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useDashboardStore } from 'src/stores/dashboard';
import { useRouter } from 'vue-router';

const modelValue = defineModel<boolean>({ default: false });
const emit = defineEmits<{
  (e: 'success', message: string): void;
  (e: 'error', message: string): void;
}>();

const dashboardStore = useDashboardStore();
const router = useRouter();

const username = computed(() => dashboardStore.user?.username || '');

// Form state
const confirmUsername = ref('');
const password = ref('');
const confirmText = ref('');
const showPassword = ref(false);
const isSubmitting = ref(false);

const canSubmit = computed(() => {
  return (
    confirmUsername.value === username.value &&
    password.value.length > 0 &&
    confirmText.value === 'DELETE MY ACCOUNT'
  );
});

// Reset form when modal closes
watch(modelValue, (value) => {
  if (!value) {
    confirmUsername.value = '';
    password.value = '';
    confirmText.value = '';
    showPassword.value = false;
  }
});

function closeModal() {
  modelValue.value = false;
}

async function handleSubmit() {
  if (!canSubmit.value || isSubmitting.value) return;

  isSubmitting.value = true;

  try {
    const result = await dashboardStore.deleteAccount(
      confirmUsername.value,
      password.value,
      'confirm', // The store expects 'confirm' as confirmText
    );
    if (result.success) {
      emit('success', 'Account deleted successfully');
      closeModal();
      // Redirect to home page
      void router.push('/');
    } else {
      emit('error', result.error || 'Failed to delete account');
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete account';
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
  width: 520px;
  min-width: 0;
  max-width: calc(100vw - 32px);
  overflow-wrap: anywhere;
}

.danger-modal {
  border-color: var(--dash-accent);

  .modal-header {
    border-bottom-color: rgba(255, 0, 0, 0.3);

    h3 {
      color: var(--dash-accent);
      display: flex;
      align-items: center;
      gap: 10px;

      i {
        font-size: 1rem;
      }
    }
  }
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

.warning-banner {
  display: flex;
  gap: 16px;
  padding: 14px;
  background: var(--dash-accent-dim);
  border: 1px solid var(--dash-accent);
  border-radius: 0;
  margin-bottom: 20px;

  > i {
    font-size: 1.2rem;
    color: var(--dash-accent);
    flex-shrink: 0;
  }
}

.warning-content {
  h4 {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--dash-accent);
    margin: 0 0 6px;
    font-family: 'Courier New', monospace;
  }

  p {
    font-size: 0.8rem;
    color: var(--dash-muted);
    margin: 0;
    line-height: 1.5;
    font-family: 'Courier New', monospace;
  }
}

.form-group {
  margin-bottom: 16px;

  &:last-child {
    margin-bottom: 0;
  }
}

.form-label {
  display: block;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--dash-muted);
  margin-bottom: 6px;
  font-family: 'Courier New', monospace;

  strong {
    color: var(--dash-text);
    font-weight: 600;
  }
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
  padding: 8px 10px;
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
    border-color: var(--dash-accent);

    &:focus {
      box-shadow: 0 0 0 2px rgba(255, 0, 0, 0.15);
    }
  }
}

.password-input-wrapper .form-input {
  padding-right: 44px;
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

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px;
  border-top: 1px solid rgba(255, 0, 0, 0.3);
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

.btn-danger {
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
  display: flex;
  align-items: center;
  gap: 6px;

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
