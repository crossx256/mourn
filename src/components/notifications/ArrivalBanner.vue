<template>
  <transition name="arrival-banner">
    <div
      v-if="banner.current"
      class="arrival-banner"
      role="status"
      aria-live="polite"
      data-testid="arrival-banner"
      @click="openConversation"
      @touchstart.passive="onTouchStart"
      @touchend="onTouchEnd"
    >
      <div class="arrival-banner__row">
        <div class="arrival-banner__avatar">
          <img v-if="banner.current.avatarUrl" :src="banner.current.avatarUrl" alt="" />
          <q-icon v-else name="mdi-account-outline" size="20px" />
        </div>

        <div class="arrival-banner__copy">
          <div class="arrival-banner__title">{{ banner.current.title }}</div>
          <div class="arrival-banner__body">{{ banner.current.body }}</div>
        </div>
      </div>

      <!-- Expiry bar: drains from the right toward the left, then the banner goes. -->
      <div class="arrival-banner__progress">
        <span
          :key="banner.current.id"
          :style="{ animationDuration: `${banner.current.durationMs}ms` }"
          @animationend="dismissArrivalBanner(banner.current?.id)"
        />
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useArrivalBanner } from 'src/composables/useArrivalBanner';
import { useVaultStore } from 'src/stores/vault';

const { banner, dismissArrivalBanner } = useArrivalBanner();
const router = useRouter();

// Discord has no close button on this notification: a tap opens the conversation and
// a swipe up throws it away. Tracked here so a swipe does not also count as a tap.
let touchStartY = 0;
let touchHandled = false;

function onTouchStart(event: TouchEvent): void {
  touchStartY = event.changedTouches[0]?.clientY ?? 0;
  touchHandled = false;
}

function onTouchEnd(event: TouchEvent): void {
  const endY = event.changedTouches[0]?.clientY ?? 0;
  if (touchStartY - endY > 24) {
    // Swiped up: dismiss without opening anything.
    touchHandled = true;
    dismissArrivalBanner(banner.current?.id);
  }
}

/**
 * Tapping the banner opens the conversation it announced, the way Discord does.
 * Selecting the link is what drives the chat open (MessagingPage watches
 * `activeLinkId`); the route push only guarantees we are on the messages surface.
 */
async function openConversation(): Promise<void> {
  if (touchHandled) {
    // The gesture was a swipe, not a tap.
    touchHandled = false;
    return;
  }
  const current = banner.current;
  if (!current) return;
  dismissArrivalBanner(current.id);

  if (current.linkId) {
    try {
      useVaultStore().activeLinkId = current.linkId;
    } catch {
      /* store unavailable — the route push below still lands somewhere sane */
    }
  }

  try {
    if (router.currentRoute.value.name !== 'chains') await router.push({ name: 'chains' });
  } catch {
    /* nothing else to do */
  }
}
</script>

<style scoped>
.arrival-banner {
  position: fixed;
  /*
   * Must clear the frameless window chrome: `--shell-safe-top` is 0 on
   * web/mobile and the titlebar height (32px) in the Tauri shell, so the
   * banner lands at 42px there instead of inside the 0–32px titlebar band.
   * Mobile keeps its notch inset. z-index stays below the titlebar (99999) on
   * purpose — nothing in the app should ever cover the window controls.
   */
  top: calc(env(safe-area-inset-top, 0px) + var(--shell-safe-top, 0px) + 10px);
  left: 12px;
  right: 12px;
  z-index: 9500;
  background: #232428;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  box-shadow:
    0 10px 30px rgba(0, 0, 0, 0.55),
    0 2px 6px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  cursor: pointer;
}

.arrival-banner__row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px 10px 10px;
}

.arrival-banner__avatar {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.65);
}

.arrival-banner__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.arrival-banner__copy {
  flex: 1 1 auto;
  min-width: 0;
}

.arrival-banner__title {
  font-size: 13px;
  font-weight: 700;
  color: #ffffff;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.arrival-banner__body {
  margin-top: 2px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.72);
  line-height: 1.3;
  /* Discord shows two lines then clips. */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.arrival-banner__progress {
  height: 2px;
  background: rgba(255, 255, 255, 0.12);
}

.arrival-banner__progress span {
  display: block;
  height: 100%;
  width: 100%;
  background: var(--q-primary);
  /* Drain toward the LEFT: the bar holds its left edge and its right edge travels
     leftward until nothing is left, then the banner is dismissed. */
  transform-origin: left center;
  animation-name: arrival-banner-drain;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}

@keyframes arrival-banner-drain {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}

.arrival-banner-enter-active,
.arrival-banner-leave-active {
  transition:
    transform 180ms ease,
    opacity 180ms ease;
}

.arrival-banner-enter-from,
.arrival-banner-leave-to {
  transform: translateY(-14px);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .arrival-banner-enter-active,
  .arrival-banner-leave-active {
    transition: none;
  }
}
</style>
