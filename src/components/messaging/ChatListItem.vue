<template>
  <div
    class="vault-swipe-wrap"
    @touchstart.passive="swipeHandlers.onTouchstart"
    @touchmove.passive="swipeHandlers.onTouchmove"
    @touchend="swipeHandlers.onTouchend"
    @touchcancel="swipeHandlers.onTouchcancel"
  >
    <!-- Actions revealed by swiping the row right — the same set the long-press
         menu offers, ordered by how often they are wanted. Only rendered while the
         row is open or being dragged: the row has no background of its own, so a
         permanently-mounted strip would show through the list. -->
    <div
      v-if="swipeRevealed"
      class="vault-swipe-actions"
      :style="{ width: swipeActionsWidth + 'px' }"
    >
      <button
        v-if="isUnread"
        type="button"
        class="vault-swipe-action"
        aria-label="Mark as read"
        @click="runSwipeAction('mark-read')"
      >
        <q-icon name="mdi-check-all" size="16px" />
      </button>
      <button
        type="button"
        class="vault-swipe-action"
        :aria-label="isChatMuted ? 'Unmute' : 'Mute'"
        @click="runSwipeAction('toggle-mute')"
      >
        <q-icon :name="isChatMuted ? 'mdi-volume-off' : 'mdi-volume-mute'" size="16px" />
      </button>
      <button
        v-if="link.status === 'ESTABLISHED' || link.status === 'ANCHORED'"
        type="button"
        class="vault-swipe-action"
        :aria-label="link.status === 'ANCHORED' ? 'Unpin' : 'Pin'"
        @click="runSwipeAction(link.status === 'ANCHORED' ? 'unanchor' : 'anchor')"
      >
        <q-icon
          :name="link.status === 'ANCHORED' ? 'mdi-link-variant-off' : 'mdi-link-lock'"
          size="16px"
        />
      </button>
    </div>

    <div
      :class="[
        'vault-chat-item',
        {
          'vault-chat-item--active': isActive,
          'vault-chat-item--anchored': link.status === 'ANCHORED',
          'vault-chat-item--severed': link.status === 'SEVERED',
          'vault-chat-item--unread': isUnread,
        },
      ]"
      :style="[decayStyle, swipeStyle]"
      @click="onRowClick"
      @contextmenu.prevent="onContextMenu"
    >
    <!-- Right-click context menu -->
    <q-menu context-menu @show="selectChatOnMenu">
      <q-list class="vault-ctx-menu" style="min-width: 200px">
        <q-item v-if="isUnread" clickable v-close-popup @click="$emit('mark-read', link)">
          <q-item-section avatar style="min-width: 0">
            <q-icon name="mdi-check-all" size="14px" />
          </q-item-section>
          <q-item-section>Mark as Read</q-item-section>
        </q-item>
        <q-item clickable v-close-popup @click="$emit('toggle-mute', link)">
          <q-item-section avatar style="min-width: 0">
            <q-icon :name="isChatMuted ? 'mdi-volume-off' : 'mdi-volume-mute'" size="14px" />
          </q-item-section>
          <q-item-section>{{ isChatMuted ? 'Unmute Chat' : 'Mute Chat' }}</q-item-section>
        </q-item>
        <q-separator />
        <q-item v-if="showVaultSync" clickable v-close-popup @click="$emit('vault-sync', link)">
          <q-item-section avatar style="min-width: 0">
            <q-icon name="mdi-sync" size="14px" />
          </q-item-section>
          <q-item-section>Sync Messages</q-item-section>
        </q-item>
        <q-item
          v-if="link.status === 'ESTABLISHED'"
          clickable
          v-close-popup
          @click="$emit('anchor', link)"
        >
          <q-item-section avatar style="min-width: 0">
            <q-icon name="mdi-link-lock" size="14px" />
          </q-item-section>
          <q-item-section>Pin</q-item-section>
        </q-item>
        <q-item
          v-if="link.status === 'ANCHORED'"
          clickable
          v-close-popup
          @click="$emit('unanchor', link)"
        >
          <q-item-section avatar style="min-width: 0">
            <q-icon name="mdi-link-variant-off" size="14px" />
          </q-item-section>
          <q-item-section>Unpin</q-item-section>
        </q-item>
        <q-separator v-if="separatorBeforeActions" />
        <template v-if="link.status === 'SEVERED'">
          <q-item clickable v-close-popup @click="$emit('purge', link)">
            <q-item-section avatar style="min-width: 0">
              <q-icon name="mdi-delete" size="14px" class="text-[var(--dash-accent)]" />
            </q-item-section>
            <q-item-section class="text-[var(--dash-accent)]">Remove</q-item-section>
          </q-item>
          <q-item clickable v-close-popup @click="$emit('request-relink', link)">
            <q-item-section avatar style="min-width: 0">
              <q-icon name="mdi-link-plus" size="14px" />
            </q-item-section>
            <q-item-section>Reconnect</q-item-section>
          </q-item>
        </template>
        <template v-else>
          <q-item v-if="canSeverLink" clickable v-close-popup @click="$emit('sever', link)">
            <q-item-section avatar style="min-width: 0">
              <q-icon name="mdi-link-off" size="14px" />
            </q-item-section>
            <q-item-section>Close</q-item-section>
          </q-item>
          <q-item
            v-if="canLocalPurgeOpenLink"
            clickable
            v-close-popup
            @click="$emit('purge', link)"
          >
            <q-item-section avatar style="min-width: 0">
              <q-icon name="mdi-delete" size="14px" class="text-[var(--dash-accent)]" />
            </q-item-section>
            <q-item-section class="text-[var(--dash-accent)]">Clear History</q-item-section>
          </q-item>
          <q-item
            v-if="showDeleteLocal"
            clickable
            v-close-popup
            @click="$emit('delete-local', link)"
          >
            <q-item-section avatar style="min-width: 0">
              <q-icon name="mdi-delete-variant" size="14px" />
            </q-item-section>
            <q-item-section>Delete Local</q-item-section>
          </q-item>
        </template>
      </q-list>
    </q-menu>

    <q-avatar size="38px" class="vault-chat-avatar">
      <img
        v-if="otherUser.profile?.profilePicture"
        :src="otherUser.profile.profilePicture"
        :alt="otherUser.username"
      />
      <q-icon v-else name="mdi-account" size="18px" color="grey-6" />
    </q-avatar>

    <div class="vault-chat-info">
      <div class="vault-chat-name-row">
        <span class="vault-chat-display">
          {{ otherUser.profile?.displayName || otherUser.username }}
        </span>
        <q-icon
          v-if="otherUser.isDonator"
          name="mdi-crown"
          size="10px"
          color="amber"
        />
        <q-icon
          v-if="link.status === 'ANCHORED'"
          name="mdi-pin"
          size="10px"
          class="text-[var(--dash-accent)]"
        />
        <q-icon
          v-if="link.status === 'SEVERED'"
          name="mdi-link-off"
          size="10px"
          class="text-[var(--dash-accent)]"
        />
        <q-icon v-if="isCompromised" name="mdi-shield-alert" size="10px" color="orange" />
        <q-icon
          v-if="isChatMuted"
          name="mdi-volume-off"
          size="10px"
          class="text-[var(--dash-muted)]"
        />
      </div>
      <span class="vault-chat-handle">@{{ otherUser.username }}</span>
    </div>

    <div class="vault-chat-side">
      <q-badge
        v-if="unreadCount > 0"
        color="primary"
        rounded
        class="vault-chat-unread-badge text-center"
      >
        {{ unreadCount > 99 ? '99+' : unreadCount }}
      </q-badge>
      <template v-if="link.status === 'ESTABLISHED'">
        <span
          v-if="!isExpired"
          :class="['vault-chat-timer', { 'vault-chat-timer--urgent': isUrgent }]"
        >
          {{ timeRemaining }}
        </span>
        <span v-else class="vault-chat-timer vault-chat-timer--urgent">EXP</span>
      </template>
      <span v-else-if="link.status === 'PENDING'" class="vault-chat-pending">PENDING</span>
    </div>
  </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { useAuthStore } from 'stores/auth';
import { useVaultStore } from 'stores/vault';
import type { Link } from 'src/types/links';
import { createSwipeHandlers } from 'src/composables/useSwipeGesture';

const props = defineProps<{
  link: Link;
  isActive: boolean;
}>();

const emit = defineEmits<{
  select: [link: Link];
  'mark-read': [link: Link];
  'toggle-mute': [link: Link];
  'vault-sync': [link: Link];
  anchor: [link: Link];
  unanchor: [link: Link];
  sever: [link: Link];
  purge: [link: Link];
  'delete-local': [link: Link];
  'request-relink': [link: Link];
}>();

const authStore = useAuthStore();
const vaultStore = useVaultStore();

const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

/** Local cache of the chat's mute flag (loaded from the store on mount). */
const chatMuted = ref(false);
const isChatMuted = computed(
  () => chatMuted.value || vaultStore.activeSettings[props.link.id]?.muted === true,
);

async function refreshMuteState() {
  chatMuted.value = (await vaultStore.isChatMuted(props.link.id)) === true;
}

onMounted(async () => {
  await refreshMuteState();
  // Update every 10s for the decay timer
  timer = setInterval(() => {
    now.value = Date.now();
  }, 10_000);
});

// Keep the mute badge in sync if settings change elsewhere (e.g. the header menu).
watch(
  () => vaultStore.activeSettings[props.link.id]?.muted,
  (muted) => {
    chatMuted.value = muted === true;
  },
);

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

/** The other participant in this link */
const otherUser = computed(() => {
  const myId = authStore.user?.id;
  return props.link.senderId === myId ? props.link.receiver : props.link.sender;
});

/** Milliseconds remaining before expiry */
const msRemaining = computed(() => {
  if (!props.link.expiresAt) return Infinity;
  return new Date(props.link.expiresAt).getTime() - now.value;
});

const isExpired = computed(() => msRemaining.value <= 0);

/** Less than 6 hours */
const isUrgent = computed(() => msRemaining.value < 6 * 60 * 60 * 1000);

/** Human-readable countdown e.g. "42h 13m" */
const timeRemaining = computed(() => {
  const ms = msRemaining.value;
  if (ms <= 0) return '0h';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
});

/** Opacity decay: 1.0 at 72h, fading to 0.4 near 0 */
const decayOpacity = computed(() => {
  if (props.link.status !== 'ESTABLISHED' || !props.link.expiresAt) return 1;
  const total = 72 * 60 * 60 * 1000;
  const remaining = Math.max(0, msRemaining.value);
  return 0.4 + 0.6 * (remaining / total);
});

const decayStyle = computed(() => {
  if (props.link.status !== 'ESTABLISHED') return {};
  return { opacity: decayOpacity.value };
});

const isUnread = computed(() => vaultStore.unreadLinks[props.link.id] === true);
const unreadCount = computed(() => vaultStore.unreadMessageCounts[props.link.id] || 0);
const isCompromised = computed(() => vaultStore.compromisedLinks[props.link.id] === true);

const showVaultSync = computed(
  () =>
    props.link.status === 'ESTABLISHED' ||
    props.link.status === 'ANCHORED' ||
    props.link.status === 'SEVERED',
);

const canSeverLink = computed(
  () => props.link.status === 'ESTABLISHED' || props.link.status === 'ANCHORED',
);

/** Clear messages on this device only while the link stays open */
const canLocalPurgeOpenLink = computed(
  () => props.link.status === 'ESTABLISHED' || props.link.status === 'ANCHORED',
);

const showDeleteLocal = computed(() => props.link.status !== 'SEVERED');

/** Between sync/anchor row and sever / purge / severed actions */
const separatorBeforeActions = computed(() => {
  const hasTop =
    props.link.status === 'ESTABLISHED' || props.link.status === 'ANCHORED' || showVaultSync.value;
  if (props.link.status === 'SEVERED') {
    return hasTop;
  }
  return hasTop && (canSeverLink.value || canLocalPurgeOpenLink.value || showDeleteLocal.value);
});

function onContextMenu() {
  // Context menu handler - the QMenu handles the display
  // Just need to emit select event to activate chat if not already
}

function selectChatOnMenu() {
  // Select the chat when menu opens (if not already selected)
  // This ensures the chat is active before actions are taken
  // Emit handled by the menu items themselves
}

/**
 * Swipe-right reveal.
 *
 * The gesture is claimed by useSwipeGesture only once it is unambiguously
 * horizontal, so the list keeps its vertical scroll. 44px per action = the touch
 * minimum; the strip is only mounted while open/dragging because the row itself has
 * no background (a mounted strip would show through the list).
 */
const SWIPE_ACTION_PX = 44;
const swipeOffset = ref(0);
const swipeDragging = ref(false);

const swipeActionCount = computed(() => {
  let count = 1; // mute/unmute is always available
  if (isUnread.value) count += 1;
  if (props.link.status === 'ESTABLISHED' || props.link.status === 'ANCHORED') count += 1;
  return count;
});
const swipeActionsWidth = computed(() => swipeActionCount.value * SWIPE_ACTION_PX);
const swipeRevealed = computed(() => swipeOffset.value > 0 || swipeDragging.value);
const swipeStyle = computed(() => ({
  transform: `translateX(${swipeOffset.value}px)`,
  transition: swipeDragging.value ? 'none' : 'transform 0.18s ease',
}));

const swipeHandlers = createSwipeHandlers({
  axis: 'x',
  threshold: 40,
  onMove: (delta) => {
    if (delta <= 0) return;
    swipeDragging.value = true;
    swipeOffset.value = Math.min(delta, swipeActionsWidth.value);
  },
  onPositive: () => {
    swipeDragging.value = false;
    swipeOffset.value = swipeActionsWidth.value;
  },
  onNegative: () => {
    swipeDragging.value = false;
    swipeOffset.value = 0;
  },
  onCancel: () => {
    swipeDragging.value = false;
    swipeOffset.value = 0;
  },
});

function runSwipeAction(action: 'mark-read' | 'toggle-mute' | 'anchor' | 'unanchor'): void {
  swipeOffset.value = 0;
  swipeDragging.value = false;
  if (action === 'mark-read') emit('mark-read', props.link);
  else if (action === 'toggle-mute') emit('toggle-mute', props.link);
  else if (action === 'anchor') emit('anchor', props.link);
  else emit('unanchor', props.link);
}

/** A tap while the actions are open closes them instead of opening the chat. */
function onRowClick(): void {
  if (swipeOffset.value > 0) {
    swipeOffset.value = 0;
    return;
  }
  emit('select', props.link);
}
</script>

<style scoped>
/* Swipe container: clips the row as it slides, so the action strip stays inside
   the row's own footprint. */
.vault-swipe-wrap {
  position: relative;
  overflow: hidden;
}

.vault-swipe-actions {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: stretch;
  z-index: 0;
}

.vault-swipe-action {
  width: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-right: 1px solid #1a1a1a;
  background: #111111;
  color: rgb(var(--m-accent-rgb, 255 0 0));
  cursor: pointer;
  padding: 0;
}

.vault-swipe-action:active {
  background: #1c1c1c;
}

/* The row must sit above the revealed strip. */
.vault-swipe-wrap > .vault-chat-item {
  position: relative;
  z-index: 1;
  background: #000;
}

.vault-chat-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  cursor: pointer;
  border-left: 2px solid transparent;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  transition: all 0.12s;
}

.vault-chat-item:hover {
  background: rgba(255, 255, 255, 0.03);
}

.vault-chat-item--active {
  background: rgba(255, 255, 255, 0.05);
  border-left-color: rgb(var(--m-accent-rgb, 255 0 0));
}

.vault-chat-item--anchored {
  border-left-color: rgb(var(--m-accent-rgb, 255 0 0) / 0.4);
}

.vault-chat-item--unread {
  border-left-color: rgb(var(--m-accent-rgb, 255 0 0));
}

.vault-chat-item--unread .vault-chat-display {
  color: #ffffff;
}

.vault-chat-item--severed {
  opacity: 0.5;
}

.vault-chat-avatar {
  flex-shrink: 0;
  border: 1px solid #1a1a1a;
  border-radius: 50%;
}

.vault-chat-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.vault-chat-name-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.vault-chat-display {
  font-family: monospace;
  font-size: 12px;
  font-weight: 600;
  color: #cccccc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vault-chat-handle {
  font-family: monospace;
  font-size: 10px;
  color: rgb(var(--m-textDim-rgb));
}

.vault-chat-side {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-width: 44px;
}

.vault-chat-unread-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 18px;
  font-weight: 700;
}

.vault-chat-timer {
  font-family: monospace;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--m-textDim-rgb));
}

.vault-chat-timer--urgent {
  color: #ff0000;
}

.vault-chat-pending {
  font-family: monospace;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 5px;
  color: rgb(var(--m-warning-rgb));
  background: rgba(255, 170, 0, 0.12);
  border: 1px solid rgba(255, 170, 0, 0.25);
}

/* Context menu styling */
:deep(.vault-ctx-menu) {
  background: #0c0c0c;
  color: rgb(var(--m-text-rgb));
}

:deep(.vault-ctx-menu .q-item) {
  padding: 8px 12px;
  font-family: monospace;
  font-size: 12px;
  color: rgb(var(--m-text-rgb));
  height: auto;
  min-height: 28px;
}

:deep(.vault-ctx-menu .q-item:hover) {
  background: rgba(255, 255, 255, 0.08);
}

:deep(.vault-ctx-menu .q-item__section--avatar) {
  padding-right: 8px;
}

:deep(.vault-ctx-menu .q-separator) {
  background: #1a1a1a;
  margin: 2px 0;
}
</style>
