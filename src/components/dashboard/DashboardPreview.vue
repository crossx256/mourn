<template>
  <div v-if="dashboardStore.profile.id" class="h-full flex flex-col font-mono" :style="previewFont">
    <!-- Preview Header -->
    <div
      class="flex items-center justify-between px-3 py-2 border-b border-solid border-dash-border"
    >
      <span class="text-[10px] text-dash-muted uppercase tracking-[2px] font-semibold">
        preview
      </span>
      <div class="flex gap-1">
        <q-btn
          flat
          dense
          round
          icon="mdi-cellphone"
          :color="previewMode === 'mobile' ? 'primary' : 'grey-7'"
          size="xs"
          @click="previewMode = 'mobile'"
        >
          <q-tooltip>Mobile</q-tooltip>
        </q-btn>
        <q-btn
          flat
          dense
          round
          icon="mdi-monitor"
          :color="previewMode === 'desktop' ? 'primary' : 'grey-7'"
          size="xs"
          @click="previewMode = 'desktop'"
        >
          <q-tooltip>Desktop</q-tooltip>
        </q-btn>
        <q-btn
          flat
          dense
          round
          icon="fas fa-external-link-alt"
          color="grey-7"
          size="xs"
          @click="openProfile"
        >
          <q-tooltip>Open</q-tooltip>
        </q-btn>
      </div>
    </div>

    <!-- Preview Body -->
    <div class="preview-body" :style="[bgStyle, cursorStyle]">
      <!-- Video Background -->
      <video
        v-if="isVideo"
        class="preview-bg-video"
        autoplay
        loop
        muted
        playsinline
        preload="metadata"
      >
        <source :src="bgUrl" :type="videoMimeType" />
      </video>
      <!-- Image Background -->
      <div
        v-else-if="p.backgroundImage || p.backgroundGif"
        class="preview-bg-overlay"
        :style="bgImageStyle"
      />

      <div class="preview-scroll-layer">
        <div
          class="preview-profile-area"
          :class="previewMode === 'mobile' ? 'max-w-[375px]' : 'max-w-[600px]'"
        >
          <div
            ref="previewCardRef"
            class="preview-card profile-card"
            :class="[
              profileAnimClass,
              profileLayoutClass,
              {
                'no-card': !p.showProfileCard,
                'no-borders': p.showCardBorders === false,
                'is-transparent': !p.showProfileCard,
              },
            ]"
            :style="cardStyle"
            :data-tilt="p.enableTiltEffect ? '' : null"
            :data-border-style="previewBorderStyleAttr"
          >
            <span v-if="showPreviewShimmerBorder" class="shimmer-glow" />
            <!-- Avatar -->
            <div v-if="p.showProfilePicture !== false" class="mb-3">
              <div
                class="preview-avatar"
                :class="previewMode === 'mobile' ? 'w-16 h-16' : 'w-20 h-20'"
                :style="avatarShapeStyle"
              >
                <img v-if="p.profilePicture" :src="p.profilePicture" :style="avatarImgStyle" />
                <q-icon
                  v-else
                  name="fas fa-user"
                  :size="previewMode === 'mobile' ? '20px' : '28px'"
                  color="grey-6"
                />
              </div>
            </div>

            <div
              class="preview-displayname"
              :class="[previewMode === 'mobile' ? 'text-lg' : '']"
              :style="nameStyle"
            >
              <span
                :class="effectClass"
                :data-text="p.displayName || dashboardStore.username || 'username'"
              >
                {{ p.displayName || dashboardStore.username || 'username' }}
              </span>
            </div>
            <!-- Handle -->
            <div
              v-if="p.showHandle !== false"
              class="preview-handle"
              :class="previewMode === 'mobile' ? 'text-[11px]' : ''"
            >
              <span>@{{ dashboardStore.username || 'username' }}</span>
            </div>

            <!-- Bio -->
            <div v-if="p.bio" class="preview-bio-section">
              <div class="preview-section-label">ABOUT ME</div>
              <!-- Typewriter bio (matches ProfileBio.vue on the public profile) -->
              <div v-if="isTypewriterBio" class="typewriter-container">
                <span
                  class="typewriter-text preview-bio-text"
                  :class="previewMode === 'mobile' ? 'text-xs' : ''"
                  :style="bioTextStyle"
                  >{{ displayedBio }}</span
                >
                <span class="typewriter-cursor">|</span>
              </div>
              <p
                v-else
                class="preview-bio-text"
                :class="[descriptionAnimClass, previewMode === 'mobile' ? 'text-xs' : '']"
                :style="bioTextStyle"
              >
                {{ p.bio }}
              </p>
            </div>

            <!-- Stats -->
            <div
              v-if="p.showViews || p.showReputation || p.showReferrals"
              class="preview-stats"
              :class="[
                previewMode === 'mobile' ? 'gap-3' : 'gap-5',
                statsPositionClass,
                statsSizeClass,
              ]"
            >
              <div v-if="p.showViews" class="preview-stat">
                <div
                  class="preview-stat-value"
                  :class="previewMode === 'mobile' ? 'text-sm' : 'text-base'"
                >
                  {{ (p.views ?? 0).toLocaleString() }}
                </div>
                <div class="preview-stat-label">views</div>
              </div>
              <div v-if="p.showReputation" class="preview-stat">
                <div
                  class="preview-stat-value"
                  :class="previewMode === 'mobile' ? 'text-sm' : 'text-base'"
                >
                  {{ p.reputation ?? 0 }}
                </div>
                <div class="preview-stat-label">rep</div>
              </div>
              <div v-if="p.showReferrals" class="preview-stat">
                <div
                  class="preview-stat-value"
                  :class="previewMode === 'mobile' ? 'text-sm' : 'text-base'"
                >
                  {{ dashboardStore.user?.referralCount ?? 0 }}
                </div>
                <div class="preview-stat-label">refs</div>
              </div>
            </div>

            <!-- Join Date -->
            <div v-if="p.showMemberSince" class="preview-join-date">
              <span>member since</span>
              <span>{{ joinDate }}</span>
            </div>

            <!-- Profile links (v2) — "under the bio" slot, mirrors ProfilePage.vue -->
            <div
              v-if="showPreviewLinkList && previewLinkPosition === 'below-bio'"
              class="preview-links"
            >
              <ProfileLinkList
                :links="previewLinks"
                :style="previewLinkStyle"
                aria-label="link preview"
              />
            </div>

            <!-- Social Icons (classic row) -->
            <div v-if="previewClassicIcons" class="preview-socials">
              <div
                v-for="(_, key) in filteredSocials"
                :key="key"
                class="preview-social-icon"
                :class="`hover-${p.socialIconHoverEffect || 'static'}`"
                :style="{ color: p.socialIconColor || '#ffffff' }"
              >
                <q-icon
                  :name="socialIcon(key as string)"
                  :size="`${(p.socialIconSize ?? 50) * 0.6}px`"
                />
              </div>
            </div>

            <!-- Profile links (v2) — "under the stats" slot -->
            <div
              v-if="showPreviewLinkList && previewLinkPosition === 'below-stats'"
              class="preview-links"
            >
              <ProfileLinkList
                :links="previewLinks"
                :style="previewLinkStyle"
                aria-label="link preview"
              />
            </div>

            <!-- Badges (mirrors ProfileBadges.vue on the real profile page) -->
            <div v-if="p.showBadges !== false && hasPreviewBadges" class="preview-badges">
              <q-icon
                v-for="badge in previewBadges"
                :key="badge.key"
                :name="badge.icon"
                :class="`hover-${p.socialIconHoverEffect || 'static'}`"
                :size="`${(p.badgeSize ?? 50) * 0.6}px`"
                :style="{ color: p.badgeColor || '#cccccc' }"
                :title="badge.label"
              />
            </div>

            <!-- Profile links (v2) — "bottom of the card" slot -->
            <div
              v-if="showPreviewLinkList && previewLinkPosition === 'bottom'"
              class="preview-links"
            >
              <ProfileLinkList
                :links="previewLinks"
                :style="previewLinkStyle"
                aria-label="link preview"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Loading state -->
  <div v-else class="h-full flex flex-col items-center justify-center bg-dash-bg">
    <q-spinner color="primary" size="40px" />
    <div class="text-dash-muted text-xs mt-3 font-mono">loading preview...</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useDashboardStore } from 'src/stores/dashboard';
import { BADGE_DEFINITIONS, isBadgeKey } from 'src/constants/badges';
import ProfileLinkList from 'src/components/profile/ProfileLinkList.vue';
import { PLATFORM_ICONS } from 'src/utils/socialLinks';
import { linkStyleFromProfile } from 'src/utils/profileLinks';
import type { ProfileLink } from 'src/types/profile';
import VanillaTilt from 'vanilla-tilt';
import {
  syncGoogleFontsStylesheet,
  applyUploadedFont,
  resolveProfileFontFamily,
} from 'src/utils/googleFonts';

const dashboardStore = useDashboardStore();
const router = useRouter();
const previewMode = ref<'mobile' | 'desktop'>('desktop');
const previewCardRef = ref<HTMLElement | null>(null);
type TiltElement = HTMLElement & { vanillaTilt?: { destroy: () => void } };

// Direct reactive reference to profile — no snapshot, instant updates
const p = computed(() => dashboardStore.profile);

const previewBorderStyle = computed(() => p.value.cardBorderStyle || 'solid');

const previewBorderWidth = computed(() => p.value.cardBorderWidth ?? 1);

const hasPreviewShimmerBorder = computed(() =>
  ['shimmer-spin', 'shimmer-wave', 'shimmer-throb'].includes(previewBorderStyle.value),
);

const showPreviewShimmerBorder = computed(
  () =>
    p.value.showCardBorders !== false &&
    hasPreviewShimmerBorder.value &&
    previewBorderWidth.value > 0,
);

const previewBorderStyleAttr = computed(() => {
  if (
    previewBorderStyle.value &&
    previewBorderStyle.value !== 'solid' &&
    p.value.showCardBorders !== false
  ) {
    return previewBorderStyle.value;
  }
  return undefined;
});

function prefersReducedMotion() {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function initPreviewTilt() {
  const el = previewCardRef.value;
  if (!el) return;
  if (!p.value.enableTiltEffect) return;
  if (prefersReducedMotion()) return;
  if ((el as TiltElement).vanillaTilt) return;

  VanillaTilt.init(el, {
    max: 28,
    perspective: 1600,
    scale: 1.04,
    speed: 1200,
    easing: 'cubic-bezier(.02,.98,.4,1)',
    gyroscope: false,
    glare: false,
    reset: true,
    transition: true,
  });
}

function destroyPreviewTilt() {
  const el = previewCardRef.value as TiltElement | null;
  if (el?.vanillaTilt) el.vanillaTilt.destroy();
}

onMounted(() => {
  initPreviewTilt();
});

watch(
  () => p.value.enableTiltEffect,
  () => {
    destroyPreviewTilt();
    initPreviewTilt();
  },
);

onUnmounted(() => {
  destroyPreviewTilt();
});

// Dynamic Google Font / uploaded font loading for preview
watch(
  () => [p.value.customFont, p.value.customFontUrl],
  ([fontName, fontUrl]) => {
    // Uploaded font (customFontUrl) takes priority; only load Google when no
    // uploaded font is set.
    if (!fontUrl) {
      syncGoogleFontsStylesheet(fontName);
    }
    applyUploadedFont(fontUrl);
  },
  { immediate: true },
);

// -----------------------------------------------------------------------
// Computed styles — all read directly from p (reactive)
// -----------------------------------------------------------------------

const previewFont = computed(() => {
  return { fontFamily: resolveProfileFontFamily(p.value.customFontUrl, p.value.customFont) };
});

const bgUrl = computed(() => {
  return p.value.backgroundGif || p.value.backgroundImage || '';
});

const isVideo = computed(() => {
  const url = bgUrl.value;
  return Boolean(url && (/\.(mp4|webm)(\?|$)/i.test(url) || url.includes('video')));
});

const videoMimeType = computed(() => {
  const url = bgUrl.value;
  return url && /\.webm(\?|$)/i.test(url) ? 'video/webm' : 'video/mp4';
});

const bgStyle = computed(() => ({
  backgroundColor: p.value.backgroundColor || '#1a1a1a',
}));

const bgImageStyle = computed(() => {
  const url = p.value.backgroundGif || p.value.backgroundImage;
  if (!url) return {};
  return {
    backgroundImage: `url(${url})`,
    opacity: String(p.value.backgroundOpacity ?? 1),
    filter: (p.value.backgroundBlur ?? 0) > 0 ? `blur(${p.value.backgroundBlur}px)` : undefined,
  };
});

const cardStyle = computed(() => {
  const s: Record<string, string> = {};

  // Check if we should actually show the card "box"
  const isCardVisible = p.value.showProfileCard !== false;

  const bg = p.value.cardBackgroundColor || '#0a0a0a';
  const opacity = p.value.cardOpacity ?? 1;
  const bgColor = rgba(bg, opacity);
  const borderRadius = p.value.cardBorderRadius || p.value.borderRadius || '0px';
  const cardShadow = p.value.cardShadowEnabled
    ? `${p.value.cardShadowX ?? 0}px ${p.value.cardShadowY ?? 4}px ${p.value.cardShadowBlur ?? 10}px ${p.value.cardShadowSpread ?? 0}px ${p.value.cardShadowColor || '#000000'}`
    : 'none';

  // ---- Shimmer / border CSS variables (mirrors ProfilePage.vue's containerStyle) ----
  // NOTE: intentionally independent of the "glow effect" toggle (cardGlowColor/cardGlowEnabled),
  // which is a separate feature and must not drive the shimmer border color.
  s['--card-bg-color'] = bg;
  s['--card-opacity'] = String(opacity);
  s['--card-blur'] = `${p.value.cardBlur ?? 0}px`;
  s['--card-shadow'] = cardShadow;
  s['--card-width'] = p.value.cardWidth || '100%';
  s['--card-max-width'] = p.value.cardMaxWidth || '600px';
  s['--card-padding'] = p.value.cardPadding || '3rem 2rem';
  s['--card-margin'] = p.value.cardMargin || '0';
  s['--profile-card-border-radius'] = borderRadius;
  s['--profile-card-border-gradient'] =
    p.value.cardBorderGradient || p.value.borderGradient || 'none';
  const shimmerColor = p.value.cardBorderColor || p.value.borderColor || '#ffffff';
  s['--shimmer-color'] = shimmerColor;
  s['--shimmer-border-color'] = `${shimmerColor}40`;
  s['--profile-glow-color'] = p.value.cardGlowColor || '#ffffff';
  s['--profile-card-border-width'] = `${previewBorderWidth.value}px`;
  s['--profile-card-border-color'] = p.value.cardBorderColor || p.value.borderColor || '#ffffff';

  // Only apply background if card is visible
  if (isCardVisible) {
    const borderStyle = previewBorderStyle.value;
    const isGradient = borderStyle === 'gradient';
    if (!isGradient) {
      s.backgroundColor = bgColor;
    }

    // Borders
    if (p.value.showCardBorders || p.value.showBorders) {
      const bc = p.value.cardBorderColor || p.value.borderColor || '#1a1a1a';
      const bs = borderStyle || p.value.borderStyle || 'solid';
      const borderWidth = previewBorderWidth.value;
      const isSpecialBorder = [
        'shimmer-spin',
        'shimmer-wave',
        'shimmer-throb',
        'gradient',
      ].includes(borderStyle);

      if (!isSpecialBorder) {
        s.border = borderWidth > 0 ? `${borderWidth}px ${bs} ${bc}` : 'none';
      }
      // When isSpecialBorder is true, deliberately don't set `border` here —
      // profile.scss's [data-border-style='shimmer-*'] rule handles it via
      // var(--profile-card-border-width) / var(--shimmer-border-color).
    }

    // Shadow / Glow
    if (p.value.cardShadowEnabled) {
      const sx = p.value.cardShadowX ?? 0;
      const sy = p.value.cardShadowY ?? 4;
      const sb = p.value.cardShadowBlur ?? 10;
      const ss = p.value.cardShadowSpread ?? 0;
      const sc = p.value.cardShadowColor || '#000000';
      s.boxShadow = `${sx}px ${sy}px ${sb}px ${ss}px ${sc}`;
    }

    if (p.value.cardGlowEnabled && p.value.cardGlowColor) {
      const gi = p.value.cardGlowIntensity ?? 20;
      const glow = `0 0 ${gi}px ${p.value.cardGlowColor}`;
      s.boxShadow = s.boxShadow ? `${s.boxShadow}, ${glow}` : glow;
    }

    if (p.value.cardBlur) s.backdropFilter = `blur(${p.value.cardBlur}px)`;
  } else {
    // If card is hidden, ensure it has no background or border but stays in layout
    s.backgroundColor = 'transparent';
    s.border = 'none';
    s.boxShadow = 'none';
    s.backdropFilter = 'none';
  }

  // Always keep these for layout consistency
  s.borderRadius = borderRadius;
  s.width = p.value.cardWidth || '100%';
  s.maxWidth = p.value.cardMaxWidth || '600px';
  s.padding = p.value.cardPadding || '3rem 2rem';
  s.margin = p.value.cardMargin || '0';

  return s;
});

const avatarShapeStyle = computed(() => {
  const shape = p.value.profilePictureShape || 'circle';
  const radius =
    shape === 'circle' ? '50%' : shape === 'rounded' ? '12px' : p.value.profilePictureRadius || '0';
  return {
    borderRadius: radius,
    border:
      p.value.profilePictureBorder !== false
        ? `2px solid ${p.value.borderColor || '#1a1a1a'}`
        : 'none',
    overflow: 'hidden' as const,
  };
});

const avatarImgStyle = computed(() => {
  const shape = p.value.profilePictureShape || 'circle';
  const radius =
    shape === 'circle' ? '50%' : shape === 'rounded' ? '12px' : p.value.profilePictureRadius || '0';
  return { borderRadius: radius };
});

const nameStyle = computed(() => {
  const s: Record<string, string> = {
    color: p.value.usernameTextColor || '#ffffff',
    fontSize: `${p.value.usernameFontSize ?? 24}px`,
    fontWeight: String(p.value.usernameFontWeight ?? 700),
    letterSpacing: p.value.usernameLetterSpacing || 'normal',
  };

  // Apply explicit text shadow only when username's text-shadow setting is enabled
  if (p.value.usernameEnableShadow) {
    s.textShadow = `${p.value.usernameTextShadowX ?? 2}px ${p.value.usernameTextShadowY ?? 2}px ${p.value.usernameTextShadowBlur ?? 4}px ${p.value.usernameTextShadowColor || '#000'}`;
  }

  // Expose --username-glow-color for CSS-based glow/shimmer to consume when
  // the selected username effect requires it (glow OR shimmer variants).
  const effect = p.value.usernameEffects || '';
  const usesGlowVar = ['glow', 'shimmer-spin', 'shimmer-wave', 'shimmer-throb'].includes(effect);
  if (usesGlowVar && p.value.usernameGlowColor) {
    s['--username-glow-color'] = p.value.usernameGlowColor;
  }

  // Keep text-stroke if configured
  if (p.value.usernameTextStroke && p.value.usernameTextStroke !== 'none') {
    s.webkitTextStroke = p.value.usernameTextStroke;
  }

  return s;
});

const effectClass = computed(() => {
  const e = p.value.usernameEffects;
  return e && e !== 'none' ? `effect-${e}` : '';
});

// Legacy: profile entrance uses profile-anim-* classes (not anim-*)
const profileAnimClass = computed(() => {
  const a = p.value.profileAnimation;
  if (!a || a === 'none') return '';
  // Legacy EJS uses profile-anim-fade and profile-anim-glitch
  return `profile-anim-${a}`;
});

const descriptionAnimClass = computed(() => {
  const a = p.value.descriptionAnimation;
  return a && a !== 'none' ? `anim-${a}` : '';
});

// ---- Typewriter bio (mirrors ProfileBio.vue) ----
const isTypewriterBio = computed(() => (p.value.descriptionAnimation || 'none') === 'typewriter');

const displayedBio = ref('');
let bioTypewriterTimer: ReturnType<typeof setInterval> | null = null;

function stopBioTypewriter() {
  if (bioTypewriterTimer) {
    clearTimeout(bioTypewriterTimer);
    bioTypewriterTimer = null;
  }
}

function startBioTypewriter() {
  stopBioTypewriter();
  const text = p.value.bio || '';
  let charIndex = 0;
  const delay = 75;
  const pauseDuration = 2000;

  function type() {
    if (charIndex < text.length) {
      displayedBio.value = text.substring(0, charIndex + 1);
      charIndex++;
      bioTypewriterTimer = setTimeout(type, delay);
    } else {
      bioTypewriterTimer = setTimeout(deleteText, pauseDuration);
    }
  }

  function deleteText() {
    if (charIndex > 0) {
      charIndex--;
      displayedBio.value = text.substring(0, charIndex);
      bioTypewriterTimer = setTimeout(deleteText, delay);
    } else {
      bioTypewriterTimer = setTimeout(type, delay);
    }
  }

  if (!text) {
    displayedBio.value = '';
    return;
  }
  bioTypewriterTimer = setTimeout(type, delay);
}

watch(
  () => [p.value.descriptionAnimation, p.value.bio],
  () => {
    if (isTypewriterBio.value) startBioTypewriter();
    else {
      stopBioTypewriter();
      displayedBio.value = p.value.bio || '';
    }
  },
  { immediate: true },
);

onUnmounted(() => stopBioTypewriter());

const profileLayoutClass = computed(() => {
  const l = p.value.profileLayout;
  return l && l !== 'default' ? `layout-${l}` : '';
});

const statsPositionClass = computed(() => {
  const pos = p.value.statsPosition;
  return pos && pos !== 'default' ? `stats-pos-${pos}` : '';
});

const statsSizeClass = computed(() => {
  const sz = p.value.statsSize;
  return sz && sz !== 'normal' ? `stats-size-${sz}` : '';
});

const cursorStyle = computed(() => {
  const cursor = p.value.customCursor;
  if (!cursor) return {};
  // Custom cursor. Browsers render raster cursor images at their intrinsic
  // size (capped ~32px); the configured size is honored where the browser
  // supports CSS `cursor` image sizing.
  const s: Record<string, string> = { cursor: `url('${cursor}') 0 0, auto` };
  const size = Math.min(96, Math.max(8, p.value.cursorSize ?? 32));
  s['--cursor-size'] = `${size}px`;
  return s;
});

const bioTextStyle = computed(() => {
  const s: Record<string, string> = {
    color: p.value.bioTextColor || '#888',
    fontSize: `${p.value.bioFontSize ?? 14}px`,
    fontWeight: String(p.value.bioFontWeight ?? 400),
    letterSpacing: p.value.bioLetterSpacing || 'normal',
    lineHeight: String(p.value.bioLineHeight ?? 1.4),
  };
  if (p.value.bioEnableShadow) {
    s.textShadow = `${p.value.bioTextShadowX ?? 2}px ${p.value.bioTextShadowY ?? 2}px ${p.value.bioTextShadowBlur ?? 4}px ${p.value.bioTextShadowColor || '#000'}`;
  }
  return s;
});

const joinDate = computed(() => {
  if (!dashboardStore.user?.createdAt) return 'unknown';
  return new Date(dashboardStore.user.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
});

const filteredSocials = computed(() => {
  const sl = p.value.socialLinks;
  if (!sl) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sl)) {
    if (v && typeof v === 'string' && v.trim()) out[k] = v;
  }
  return out;
});
const hasSocials = computed(() => Object.keys(filteredSocials.value).length > 0);

/* ── v2 profile links (mirrors ProfilePage.vue's slot logic) ───────────── */
const previewLinks = computed<ProfileLink[]>(() => {
  const rows = p.value.profileLinks;
  return Array.isArray(rows) ? (rows as ProfileLink[]) : [];
});
const previewLinkStyle = computed(() => linkStyleFromProfile(p.value));
const previewLinkPosition = computed(() => previewLinkStyle.value.position);
const previewLinksMode = computed(() => p.value.linksDisplay ?? 'classic');
const showPreviewLinkList = computed(
  () =>
    previewLinksMode.value === 'linktree' &&
    previewLinks.value.some((row) => row.visible !== false),
);
const previewClassicIcons = computed(() => {
  if (!hasSocials.value) return false;
  if (previewLinksMode.value === 'classic') return true;
  return previewLinkStyle.value.showClassicIcons || !showPreviewLinkList.value;
});

const previewBadges = computed(() =>
  (p.value.badges ?? []).filter(isBadgeKey).map((key) => ({
    key,
    ...BADGE_DEFINITIONS[key],
  })),
);
const hasPreviewBadges = computed(() => previewBadges.value.length > 0);

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function rgba(hex: string, a: number): string {
  const c = hex.replace('#', '');
  return `rgba(${parseInt(c.substring(0, 2), 16) || 0}, ${parseInt(c.substring(2, 4), 16) || 0}, ${parseInt(c.substring(4, 6), 16) || 0}, ${a})`;
}

// The classic row's glyphs come from the shared platform table so the preview can
// never drift from ProfileSocials.vue / the real profile page.
function socialIcon(key: string) {
  return PLATFORM_ICONS[key] || 'fas fa-link';
}

function openProfile() {
  const u = dashboardStore.user?.username;
  if (u) {
    void router.push(`/${u}`);
  }
}
</script>

<style lang="scss">
@import 'src/css/profile.scss';
</style>
