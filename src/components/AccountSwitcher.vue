<template>
  <div class="acct-switcher">
    <!-- Current Account -->
    <div v-if="activeAccount" class="acct-current-row">
      <q-avatar size="32px" class="acct-avatar">
        <img v-if="activeAccount.profilePicture" :src="activeAccount.profilePicture" />
        <q-icon v-else name="sym_o_person" size="18px" />
      </q-avatar>
      <div class="acct-info">
        <span class="acct-name">{{ activeAccount.displayName || activeAccount.username }}</span>
        <span class="acct-handle">@{{ activeAccount.username }}</span>
      </div>
      <span class="acct-active-badge">active</span>
    </div>

    <!-- Other saved accounts -->
    <div v-if="otherAccounts.length > 0" class="acct-section">
      <span class="acct-section-label">Switch to</span>
      <div v-for="acc in otherAccounts" :key="acc.id" class="acct-row">
        <button type="button" class="acct-row-left" :disabled="isSwitching" :aria-label="`Switch to @${acc.username}`" @click="switchToAccount(acc)">
          <q-avatar size="28px" class="acct-avatar-sm">
            <img v-if="acc.profilePicture" :src="acc.profilePicture" />
            <q-icon v-else name="sym_o_person" size="14px" />
          </q-avatar>
          <div class="acct-row-info">
            <span class="acct-row-name">{{ acc.displayName || acc.username }}</span>
            <span class="acct-row-handle">@{{ acc.username }}</span>
          </div>
        </button>
        <button type="button" class="acct-remove-btn" :aria-label="`Remove saved account @${acc.username}`" @click.stop="confirmRemove(acc)">
          <q-icon name="mdi-close" size="14px" />
        </button>
      </div>
    </div>

    <div v-if="otherAccounts.length === 0 && !activeAccount" class="acct-empty">
      No saved accounts
    </div>

    <div class="acct-sep" />

    <!-- Add account -->
    <button class="acct-action" @click="addAccount">
      <q-icon name="mdi-plus" size="16px" />
      Add Account
    </button>

    <!-- Logout current -->
    <button v-if="activeAccount" class="acct-action acct-action--danger" @click="logoutCurrent">
      <q-icon name="mdi-logout" size="16px" />
      Log Out @{{ activeAccount.username }}
    </button>

    <!-- Remove confirmation dialog -->
    <q-dialog v-model="showRemoveDialog">
      <q-card class="acct-confirm-card">
        <q-card-section>
          <div class="acct-confirm-title">Remove Account</div>
          <div class="acct-confirm-desc">
            Remove <strong>@{{ removingAccount?.username }}</strong> from saved accounts? This won't
            delete the account — just removes it from this device.
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" class="acct-confirm-btn" @click="showRemoveDialog = false" />
          <q-btn
            flat
            label="Remove"
            class="acct-confirm-btn acct-confirm-btn--danger"
            @click="doRemove"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useAccountsStore, type SavedAccount } from 'src/stores/accounts';
import { useAuthStore } from 'src/stores/auth';
import { Notify } from 'quasar';
import { useFingerprint } from 'src/composables/useFingerprint';
import { useNavigation } from 'src/composables/useNavigation';

const emit = defineEmits<{ close: [] }>();

const accountsStore = useAccountsStore();
const authStore = useAuthStore();
const router = useRouter();
const { getFingerprint } = useFingerprint();
const { closeSearch } = useNavigation();

const showRemoveDialog = ref(false);
const removingAccount = ref<SavedAccount | null>(null);
const isSwitching = ref(false);
let disposeOverlay: (() => void) | undefined;
onBeforeUnmount(() => { disposeOverlay?.(); });

/**
 * Creates a fullscreen fade overlay to mask UI flicker during account switch.
 * The overlay fades in, the switch happens behind it, then it fades out.
 */
function createSwitchOverlay(): { fadeIn: () => Promise<void>; fadeOut: () => Promise<void> } {
  disposeOverlay?.();
  const overlay = document.createElement('div');
  overlay.setAttribute('aria-hidden', 'true');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '99999', background: '#000',
    opacity: '0', transition: reducedMotion ? 'none' : 'opacity 0.25s ease-in-out',
    pointerEvents: 'all',
  });
  document.body.appendChild(overlay);
  let disposed = false;
  let finishTransition: (() => void) | undefined;
  // A hung switch must never leave an opaque, input-blocking screen behind.
  const deadline = setTimeout(() => dispose(), 10_000);
  function dispose() {
    disposed = true;
    clearTimeout(deadline);
    finishTransition?.();
    overlay.remove();
  }
  disposeOverlay = dispose;
  function transition(opacity: string): Promise<void> {
    if (disposed) return Promise.resolve();
    finishTransition?.();
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timeout);
        overlay.removeEventListener('transitionend', finish);
        overlay.removeEventListener('transitioncancel', finish);
        finishTransition = undefined;
        resolve();
      };
      const timeout = setTimeout(finish, reducedMotion ? 0 : 350);
      finishTransition = finish;
      overlay.addEventListener('transitionend', finish);
      overlay.addEventListener('transitioncancel', finish);
      void overlay.offsetWidth;
      overlay.style.opacity = opacity;
    });
  }
  return { fadeIn: () => transition('1'), fadeOut: async () => { await transition('0'); dispose(); } };
}

const activeAccount = computed(() => accountsStore.activeAccount);
const otherAccounts = computed(() => accountsStore.inactiveAccounts);

onMounted(async () => {
  await accountsStore.load();
});

async function switchToAccount(acc: SavedAccount) {
  if (isSwitching.value) return;
  isSwitching.value = true;
  emit('close');
  closeSearch();

  const overlay = createSwitchOverlay();

  try {
    await overlay.fadeIn();
    const fingerprint = await getFingerprint();
    const result = await authStore.switchAccount(acc.username, fingerprint);

    if (result.success) {
      await router.push('/');
    } else {
      await router.push({ path: '/login', query: { username: acc.username, switch: '1' } });
    }
  } catch {
    await router.push({ path: '/login', query: { username: acc.username, switch: '1' } });
  } finally {
    try { await overlay.fadeOut(); }
    finally { disposeOverlay?.(); isSwitching.value = false; }
  }
}

function addAccount() {
  emit('close');
  closeSearch();
  if (authStore.isLoggedIn) {
    authStore.logout().then(() => {
      router.push({ path: '/login', query: { add: '1' } });
    });
  } else {
    router.push({ path: '/login', query: { add: '1' } });
  }
}

async function logoutCurrent() {
  emit('close');
  closeSearch();
  await authStore.logout();
  await router.push('/login');
}

function confirmRemove(acc: SavedAccount) {
  removingAccount.value = acc;
  showRemoveDialog.value = true;
}

async function doRemove() {
  const account = removingAccount.value ? { ...removingAccount.value } : null;
  if (!account || isSwitching.value) return;
  isSwitching.value = true;
  try {
    if (authStore.user?.id === account.id) await authStore.logout();
    const { useVaultStore } = await import('src/stores/vault');
    await useVaultStore().clearAllVaultDataForUser(account.id);
    const { useSecureStore } = await import('src/composables/useSecureStore');
    await useSecureStore().removeCredentials(account.username);
    await accountsStore.removeAccount(account.id);
    showRemoveDialog.value = false;
    removingAccount.value = null;
  } catch (error) {
    Notify.create({ type: 'negative', message: error instanceof Error ? error.message : 'Local account removal incomplete. Retry before removing the saved account.' });
  } finally { isSwitching.value = false; }
}
</script>

<style scoped lang="scss">
$border: rgba(255, 255, 255, 0.08);
$muted: rgba(255, 255, 255, 0.4);
$text: rgba(255, 255, 255, 0.9);
$accent: #ff0000;

.acct-switcher {
  font-family: monospace;
  min-width: 260px;
}

.acct-current-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  margin-bottom: 8px;
}

.acct-avatar {
  border: 1px solid $border;
  border-radius: 50%;
  flex-shrink: 0;
}

.acct-avatar-sm {
  border: 1px solid $border;
  border-radius: 50%;
  flex-shrink: 0;
}

.acct-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.acct-name {
  font-size: 12px;
  font-weight: 600;
  color: $text;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.acct-handle {
  font-size: 10px;
  color: $muted;
}

.acct-active-badge {
  font-size: 9px;
  color: $muted;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 2px 6px;
  border: 1px solid $border;
  border-radius: 2px;
  flex-shrink: 0;
}

.acct-section-label {
  display: block;
  padding: 4px 0;
  font-size: 9px;
  color: $muted;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.acct-row {
  display: flex;
  align-items: center;
  padding: 4px 0;
  transition: background 0.1s;
  border-radius: 2px;

  &:hover {
    background: rgba(255, 255, 255, 0.04);
  }
}

.acct-row-left {
  background: transparent;
  border: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
  padding: 4px;
}

.acct-row-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.acct-row-name {
  font-size: 11px;
  color: $text;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.acct-row-handle {
  font-size: 9px;
  color: $muted;
}

.acct-remove-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: none;
  border: none;
  color: $muted;
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.12s;

  &:hover {
    color: $accent;
  }
}

.acct-empty {
  font-size: 11px;
  color: $muted;
  padding: 12px 0;
  text-align: center;
}

.acct-sep {
  height: 1px;
  background: $border;
  margin: 8px 0;
}

.acct-action {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 4px;
  font-family: monospace;
  font-size: 11px;
  color: $text;
  background: none;
  border: none;
  cursor: pointer;
  border-radius: 2px;
  transition: background 0.1s;

  &:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  &--danger {
    color: $accent;

    &:hover {
      background: rgba(255, 0, 0, 0.06);
    }
  }
}

.acct-confirm-card {
  background: #0a0a0a !important;
  border: 1px solid $border;
  color: $text;
  font-family: monospace;
  width: 300px;
  min-width: 0;
  max-width: calc(100vw - 32px);
}

.acct-switcher button:focus-visible {
  outline: 2px solid $text;
  outline-offset: 3px;
}

.acct-confirm-title {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 8px;
}

.acct-confirm-desc {
  font-size: 11px;
  color: $muted;
  line-height: 1.5;
}

.acct-confirm-btn {
  font-family: monospace;
  font-size: 11px;
  color: $muted;

  &--danger {
    color: $accent;
  }
}
</style>
