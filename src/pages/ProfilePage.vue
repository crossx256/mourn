<template>
  <q-page class="profile-page" :style="pageStyle">
    <!-- ============================================================
         LOADING STATE
         ============================================================ -->
    <div v-if="store.loading" class="profile-loading">
      <q-spinner color="white" size="3em" />
    </div>

    <!-- ============================================================
         404 — USER NOT FOUND
         ============================================================ -->
    <div v-else-if="store.notFound" class="error-container">
      <div>
        <h1 class="error-404">404</h1>
        <p class="error-message">user not found</p>
        <router-link to="/" class="error-link">← back to home</router-link>
      </div>
    </div>

    <!-- ============================================================
         ERROR STATE
         ============================================================ -->
    <div v-else-if="store.error" class="error-container">
      <div>
        <h1 class="error-404">!</h1>
        <p class="error-message">{{ store.error }}</p>
        <router-link to="/" class="error-link">← back to home</router-link>
      </div>
    </div>

    <!-- ============================================================
         PROFILE CONTENT
         ============================================================ -->
    <template v-else-if="store.hasProfile && profile && profileUser">
      <!-- Entrance Overlay (client-side only) -->
      <q-no-ssr>
        <ProfileEntrance
          v-if="entranceEnabled && !entranceDismissed"
          :text="profile.entranceText || 'click to enter'"
          :font="profile.entranceTextFont ? profile.entranceTextFont : 'Courier New'"
          :text-color="profile.entranceTextColor || '#ffffff'"
          :overlay-color="profile.entranceOverlayColor || '#000000'"
          :overlay-opacity="profile.entranceOverlayOpacity ?? 0.9"
          @dismissed="handleEntranceDismissed"
        />
      </q-no-ssr>

      <!-- Main Container (SSR-rendered unconditionally so the server HTML is
           never empty and hydration has identical content on both sides.
           When an entrance overlay is active it is layered on top (fixed,
           opaque) until dismissed, so the content is visually behind it. -->
      <div :inert="entranceBlocking" :aria-hidden="entranceBlocking || undefined" class="profile-content">
      <main
        ref="mainRef"
        tabindex="-1"
        class="profile-container"
        :class="{ 'is-entrance-blocked': entranceEnabled && !entranceDismissed }"
        :style="containerStyle"
        :data-bg-type="bgType"
        :data-layout="profileLayout"
      >
        <!-- Video Background (client-only) -->
        <q-no-ssr>
          <video
            v-if="isVideo && bgUrl && !performanceModeEnabled"
            class="background-video"
            autoplay
            loop
            muted
            playsinline
            preload="metadata"
          >
            <source :src="bgUrl" :type="videoMimeType" />
          </video>
        </q-no-ssr>

        <!-- Profile Card (SSR: always render header, username, pic, stats, socials, badges) -->
        <article
          ref="cardRef"
          :class="cardClasses"
          :data-profile-animation="profileAnimation"
          :data-border-style="cardBorderStyleAttr"
          :data-tilt="profile.enableTiltEffect && showCard && !performanceModeEnabled ? '' : null"
        >
          <!-- Shimmer Glow Span -->
          <span v-if="showShimmerBorder" class="shimmer-glow" />

          <!-- Header: avatar, username, display name, username value (SSR) -->
          <ProfileHeader
            :profile="profile"
            :user="profileUser"
            :show-inner-borders="showInnerBorders"
            :disable-effects="performanceModeEnabled"
          />

          <!-- Bio (SSR) -->
          <ProfileBio
            v-if="profile.bio"
            :bio="profile.bio"
            :description-animation="profile.descriptionAnimation ?? null"
          />

          <!-- Profile links (v2, SSR) — "under the bio" slot. Only one of the three
               slots below renders; which one is a stored preference. -->
          <ProfileLinkList
            v-if="showLinkList && linksPosition === 'below-bio'"
            :links="profileLinks"
            :style="linkStyle"
          />

          <!-- Stats (SSR) -->
          <ProfileStats :profile="profile" :user="profileUser" />

          <!-- Profile links (v2, SSR) — "under the stats" slot -->
          <ProfileLinkList
            v-if="showLinkList && linksPosition === 'below-stats'"
            :links="profileLinks"
            :style="linkStyle"
          />

          <!-- Social Links (SSR) — the classic icon row. In classic display mode this is
               the page's link surface; in linktree mode it is opt-in, and it also acts as
               the fallback when the link list is empty. -->
          <ProfileSocials
            v-if="showClassicIcons"
            :social-links="socialLinksMap"
            :social-icons="profile.socialIcons"
            :hover-effect="profile.socialIconHoverEffect || 'static'"
          />

          <!-- Badges (SSR) -->
          <ProfileBadges
            v-if="profile.showBadges !== false"
            :badges="profile.badges"
            :hover-effect="profile.socialIconHoverEffect || 'static'"
          />

          <!-- Profile links (v2, SSR) — "bottom of the card" slot -->
          <ProfileLinkList
            v-if="showLinkList && linksPosition === 'bottom'"
            :links="profileLinks"
            :style="linkStyle"
          />
        </article>
      </main>

      <!-- Voting (client-only) -->
      <q-no-ssr>
        <ProfileVoting :username="profileUser.username" :profile-user-id="profileUser.id" />

        <!-- Report this profile (§4d). Hidden on your own profile: the server
             rejects self-reports anyway, and reporting yourself is meaningless. -->
        <div v-if="!isOwnProfile" class="profile-report-row">
          <button type="button" class="profile-report-btn" @click="onReportProfile">
            <q-icon name="mdi-alert-octagon-outline" size="14px" />
            <span>report this profile</span>
          </button>
        </div>

        <!-- Music (client-only) — blocked while entrance overlay is active -->
        <ProfileMusic
          v-if="profile.musicUrl"
          ref="musicRef"
          :music-url="profile.musicUrl"
          :music-volume="profile.musicVolume ?? 0.5"
          :autoplay="profile.musicAutoplay ?? false"
          :loop="profile.musicLoop ?? true"
          :blocked="entranceEnabled && !entranceDismissed"
        />
        <!-- Promo banner removed (krul directive) -->
      </q-no-ssr>
      </div>
    </template>
  </q-page>
</template>

<!-- ================================================================
     OPTIONS API BLOCK — preFetch (runs on server during SSR)
     ================================================================ -->
<script lang="ts">
import { usePublicProfileStore as useStore } from 'src/stores/publicProfile';

export default {
  async preFetch({
    store: pinia,
    currentRoute,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }: any) {
    const profileStore = useStore(pinia);
    const username = currentRoute.params.username as string;
    if (username) {
      await profileStore.fetchPublicProfile(username);
    }
  },
};
</script>

<!-- ================================================================
     SETUP SCRIPT — reactive logic, computed, useMeta
     ================================================================ -->
<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useMeta } from 'quasar';
import { useRouter } from 'vue-router';
import { useTitleGlitch } from 'src/composables/useTitleGlitch';
import { useViewTracking } from 'src/composables/useViewTracking';
import { useProfileGlitch } from 'src/composables/useProfileGlitch';
import { useCursorEffect } from 'src/composables/useCursorEffect';
import VanillaTilt from 'vanilla-tilt';
import { usePublicProfileStore } from 'src/stores/publicProfile';
import { useDevicePreferencesStore } from 'src/stores/devicePreferences';
import { useAuthStore } from 'src/stores/auth';
import { openTicketReport } from 'src/utils/ticketLinks';
import {
  syncGoogleFontsStylesheet,
  applyUploadedFont,
  resolveProfileFontFamily,
} from 'src/utils/googleFonts';

/* ---- Sub-components ---- */
import ProfileEntrance from 'src/components/profile/ProfileEntrance.vue';
import ProfileHeader from 'src/components/profile/ProfileHeader.vue';
import ProfileBio from 'src/components/profile/ProfileBio.vue';
import ProfileStats from 'src/components/profile/ProfileStats.vue';
import ProfileSocials from 'src/components/profile/ProfileSocials.vue';
import ProfileLinkList from 'src/components/profile/ProfileLinkList.vue';
import { linkStyleFromProfile } from 'src/utils/profileLinks';
import type { ProfileLink } from 'src/types/profile';
import ProfileBadges from 'src/components/profile/ProfileBadges.vue';
import ProfileMusic from 'src/components/profile/ProfileMusic.vue';
import ProfileVoting from 'src/components/profile/ProfileVoting.vue';

/* ================================================================
   STORE
   ================================================================ */
const store = usePublicProfileStore();
const devicePreferencesStore = useDevicePreferencesStore();
const authStore = useAuthStore();
const router = useRouter();

const profile = computed(() => store.profile);
const profileUser = computed(() => store.profileUser);
const performanceModeEnabled = computed(() => devicePreferencesStore.performanceMode);

const isOwnProfile = computed(
  () => Boolean(authStore.user?.id) && authStore.user?.id === profileUser.value?.id,
);

/**
 * Report this profile (§4d). The profile surface offers its own violation
 * sub-categories, so the composer is opened with `categoryScope: 'profile'`.
 */
function onReportProfile() {
  const user = profileUser.value;
  if (!user || isOwnProfile.value) return;
  void openTicketReport(router, {
    targetType: 'profile',
    targetRef: user.id,
    label: `Profile @${user.username}`,
    categoryScope: 'profile',
  });
}

const pageStyle = computed<Record<string, string>>(() => ({
  '--custom-font': resolveProfileFontFamily(
    profile.value?.customFontUrl,
    profile.value?.customFont,
  ),
}));

// onMounted logic for fallback fetch removed to prevent hydration wipe.
// The preFetch hook handles data loading.

/* refs & key computed moved to top to avoid TDZ when watchers/hooks run */
const cardRef = ref<HTMLElement | null>(null);
const mainRef = ref<HTMLElement | null>(null);
const clientMounted = ref(false);
const entranceDismissed = ref(false);
const entranceEnabled = computed(() => Boolean(profile.value?.showEntranceOverlay));
const entranceBlocking = computed(() => clientMounted.value && entranceEnabled.value && !entranceDismissed.value);
onMounted(() => { clientMounted.value = true; });
watch(() => profileUser.value?.id, () => { entranceDismissed.value = false; });

const showCard = computed(() => profile.value?.showProfileCard !== false);
const showCardBorders = computed(
  () => profile.value?.showCardBorders !== false && !performanceModeEnabled.value,
);
const showInnerBorders = computed(
  () => profile.value?.showBorders === true && !performanceModeEnabled.value,
);
const cardBorderWidth = computed(() => profile.value?.cardBorderWidth ?? 1);

watch(
  () => [profile.value?.customFont, profile.value?.customFontUrl],
  ([font, fontUrl]) => {
    if (!fontUrl) {
      syncGoogleFontsStylesheet(font);
    }
    applyUploadedFont(fontUrl);
  },
  { immediate: true },
);

const musicRef = ref<InstanceType<typeof ProfileMusic> | null>(null); // Reference to the music component

/**
 * Handles the transition from Overlay -> Content
 */
function handleEntranceDismissed() {
  entranceDismissed.value = true;
  musicRef.value?.playAfterEntrance();
  void nextTick(() => { mainRef.value?.focus({ preventScroll: true }); initTilt(); });
}

/* ================================================================
   3D TILT (VanillaTilt) — mirrors legacy EJS behavior
   ================================================================ */
type TiltElement = HTMLElement & { vanillaTilt?: { destroy: () => void } };

/* ================================================================
   CURSOR EFFECTS & CUSTOM CURSOR
   ================================================================ */

const cursorProfile = computed(() => {
  const p = profile.value;
  return p ? { cursorEffect: p.cursorEffect, customCursor: p.customCursor, cursorSize: p.cursorSize } : null;
});
useCursorEffect(cursorProfile);


function prefersReducedMotion() {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function initTilt() {
  const el = cardRef.value;
  if (!el) return;
  if (!profile.value?.enableTiltEffect || !showCard.value) return;
  if (performanceModeEnabled.value) return;
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

function destroyTilt() {
  const el = cardRef.value as TiltElement | null;
  if (el?.vanillaTilt) el.vanillaTilt.destroy();
}

/* ================================================================
   VIEW TRACKING — fire once per profile visit on the client
   ================================================================ */
const { trackView } = useViewTracking();

onMounted(() => {
  const username = profileUser.value?.username;
  if (username) {
    void trackView(username, store.viewToken);
  }

  // Only init tilt if entrance is not enabled or already dismissed
  if (!entranceEnabled.value || entranceDismissed.value) {
    initTilt();
  }
});

watch(
  () => profileUser.value?.username,
  (username) => {
    if (username) void trackView(username, store.viewToken);
  },
);

watch(
  () => [profile.value?.enableTiltEffect, showCard.value, performanceModeEnabled.value],
  () => {
    destroyTilt();
    initTilt();
  },
);

onUnmounted(() => {
  destroyTilt();
});

/* ================================================================
   TITLE GLITCH — per-profile opt-in
   When profile.titleGlitch is true, override the global glitch with
   this profile's SEO title / username.
   ================================================================ */
const profileGlitchTitle = computed(() => {
  const p = profile.value;
  const u = profileUser.value;
  if (!p || !u) return '';
  return p.seoTitle || `@${u.username}`;
});

const profileGlitchDelay = computed(() => {
  const speed = profile.value?.titleGlitchSpeed ?? 1.0;
  const baseDelay = 120;
  return Math.round(baseDelay / speed);
});

const { start: startGlitch, stop: stopGlitch } = useTitleGlitch({
  title: profileGlitchTitle,
  delay: profileGlitchDelay,
  immediate: false,
});

watch(
  () => profile.value?.titleGlitch,
  (enabled) => {
    if (typeof window !== 'undefined') {
      if (enabled) startGlitch();
      else stopGlitch();
    }
  },
  { immediate: true },
);
onUnmounted(() => stopGlitch());


/* ================================================================
   PROFILE ENTRANCE GLITCH — baffle.js effect (matches legacy EJS)
   ================================================================ */
const glitchEnabled = computed((): boolean =>
  Boolean(profile.value?.profileAnimation === 'glitch'),
);

useProfileGlitch(glitchEnabled);

/* ================================================================
   ENTRANCE OVERLAY
   ================================================================ */

/* ================================================================
   BACKGROUND HELPERS
   ================================================================ */
const bgUrl = computed(() => {
  const p = profile.value;
  if (!p) return '';
  const url = p.backgroundGif || p.backgroundImage || '';
  if (performanceModeEnabled.value && /\.(gif|mp4|webm)(\?|$)/i.test(url)) {
    return '';
  }
  return url;
});

const isVideo = computed(() => {
  const url = bgUrl.value;
  return Boolean(url && (/\.(mp4|webm)(\?|$)/i.test(url) || url.includes('video')));
});

const bgType = computed(() => {
  if (isVideo.value) return 'video';
  if (bgUrl.value) return 'image';
  return 'color';
});

const videoMimeType = computed(() => {
  const url = bgUrl.value;
  return url && /\.webm(\?|$)/i.test(url) ? 'video/webm' : 'video/mp4';
});

/* ================================================================
   CARD CLASSES & ATTRIBUTES
   ================================================================ */

const cardBorderStyle = computed(() => profile.value?.cardBorderStyle || 'solid');

const hasShimmerBorder = computed(() =>
  ['shimmer-spin', 'shimmer-wave', 'shimmer-throb'].includes(cardBorderStyle.value),
);

const showShimmerBorder = computed(
  () =>
    showCard.value && showCardBorders.value && hasShimmerBorder.value && cardBorderWidth.value > 0,
);

const cardBorderStyleAttr = computed(() => {
  if (
    cardBorderStyle.value &&
    cardBorderStyle.value !== 'solid' &&
    showCard.value &&
    showCardBorders.value
  ) {
    return cardBorderStyle.value;
  }
  return undefined;
});

const profileAnimation = computed(() => profile.value?.profileAnimation || 'none');

const profileLayout = computed(() => profile.value?.profileLayout || 'default');

// Legacy animation set: profile entrance none | fade | glitch (EJS profile-effects.js)
const cardClasses = computed(() => {
  const classes = ['profile-card'];
  if (!showCard.value) classes.push('no-card');
  if (!showCardBorders.value) classes.push('no-borders');
  if (!showInnerBorders.value) classes.push('inner-no-borders');
  if (profileAnimation.value === 'fade') classes.push('profile-anim-fade');
  if (profileAnimation.value === 'glitch') classes.push('profile-anim-glitch');
  return classes;
});

/* ================================================================
   SOCIAL LINKS
   ================================================================ */
const socialLinksMap = computed<Record<string, string>>(() => {
  const links = profile.value?.socialLinks;
  if (!links || typeof links !== 'object') return {};
  return links;
});

const hasSocialLinks = computed(() => Object.values(socialLinksMap.value).some((v) => Boolean(v)));

/* ================================================================
   PROFILE LINKS (v2 "Linktree-class")
   linksDisplay = 'classic' (default) keeps the icon row exactly as it always was;
   'linktree' renders the ordered link list instead.
   ================================================================ */
const profileLinks = computed<ProfileLink[]>(() => {
  const rows = profile.value?.profileLinks;
  return Array.isArray(rows) ? (rows as ProfileLink[]) : [];
});

const linkStyle = computed(() => linkStyleFromProfile(profile.value ?? {}));
const linksPosition = computed(() => linkStyle.value.position);
const linksDisplayMode = computed(() => profile.value?.linksDisplay ?? 'classic');

/** True when the page should render the link list: linktree mode with at least one
 *  visible row. SSR-safe: purely derived from the stored profile. */
const showLinkList = computed(
  () =>
    linksDisplayMode.value === 'linktree' &&
    profileLinks.value.some((row) => row.visible !== false),
);

/** The classic icon row: the primary surface in classic mode, opt-in in linktree mode,
 *  and always the fallback when there is no link list to show (never render nothing). */
const showClassicIcons = computed(() => {
  if (!hasSocialLinks.value) return false;
  if (linksDisplayMode.value === 'classic') return true;
  return linkStyle.value.showClassicIcons || !showLinkList.value;
});

/* ================================================================
   CSS VARIABLE INJECTION
   All profile customization is expressed as CSS custom properties
   applied to .profile-container via :style.
   ================================================================ */
const containerStyle = computed<Record<string, string>>(() => {
  const p = profile.value;
  const u = profileUser.value;

  // Hydration gap fallback: prevent gray screen if data is briefly missing
  if (!p || !u) {
    return {
      'background-color': '#0a0a0a',
      'min-height': 'var(--app-height, 100vh)',
      display: 'flex',
    };
  }

  if (!p || !u) return {};

  const shimmerColor = p.cardBorderColor || p.borderColor || '#ffffff';
  const glowColor = p.cardGlowColor || '#ffffff';

  const shadowPart = p.cardShadowEnabled
    ? `${p.cardShadowX ?? 0}px ${p.cardShadowY ?? 4}px ${p.cardShadowBlur ?? 10}px ${p.cardShadowSpread ?? 0}px ${p.cardShadowColor || '#000000'}`
    : '';

  const glowPart =
    p.cardGlowEnabled && p.cardGlowColor
      ? `0 0 ${p.cardGlowIntensity ?? 20}px ${p.cardGlowColor}`
      : '';

  const vars: Record<string, string> = {
    /* ---- Borders ---- */
    '--profile-border-color': p.borderColor || '#ffffff',
    '--profile-border-radius': p.borderRadius || '0px',
    '--profile-border-gradient': p.borderGradient || 'none',

    /* ---- Card borders ---- */
    '--profile-card-border-color': p.cardBorderColor || p.borderColor || '#ffffff',
    '--profile-card-border-radius': p.cardBorderRadius || '0px',
    '--profile-card-border-width': `${p.cardBorderWidth ?? 1}px`,
    '--profile-card-border-gradient': p.cardBorderGradient || p.borderGradient || 'none',
    '--profile-card-border-style': p.cardBorderStyle || p.borderStyle || 'solid',
    '--card-bg-color': p.cardBackgroundColor || '#000000',
    '--card-opacity': String(p.cardOpacity ?? 1),
    '--card-blur': `${p.cardBlur ?? 0}px`,

    /* ---- Card Shadow ---- */
    '--card-shadow': [shadowPart, glowPart].filter(Boolean).join(', ') || 'none',

    /* ---- Card Size & Position ---- */
    '--card-width': p.cardWidth || '100%',
    '--card-max-width': p.cardMaxWidth || '600px',
    '--card-padding': p.cardPadding || '3rem 2rem',
    '--card-margin': p.cardMargin || '0',

    /* ---- Social & badges ---- */
    '--social-icon-color': p.socialIconColor || '#ffffff',
    '--social-icon-size': `${p.socialIconSize ?? 50}px`,
    '--badge-color': p.badgeColor || '#cccccc',
    '--badge-size': `${p.badgeSize ?? 50}px`,

    /* ---- Username typography ---- */
    '--username-glow-color': p.usernameGlowColor || '#ffffff',
    '--username-text-color': p.usernameTextColor || '#ffffff',
    '--username-font-size': `${p.usernameFontSize ?? 32}px`,
    '--username-font-weight': String(p.usernameFontWeight ?? 700),
    '--username-letter-spacing': p.usernameLetterSpacing || 'normal',
    '--username-text-shadow': p.usernameEnableShadow
      ? `${p.usernameTextShadowX ?? 2}px ${p.usernameTextShadowY ?? 2}px ${p.usernameTextShadowBlur ?? 4}px ${p.usernameTextShadowColor || '#000000'}`
      : 'none',
    '--username-text-stroke': p.usernameTextStroke || 'initial',

    /* ---- Bio typography ---- */
    '--bio-text-color': p.bioTextColor || '#cccccc',
    '--bio-font-size': `${p.bioFontSize ?? 16}px`,
    '--bio-font-weight': String(p.bioFontWeight ?? 400),
    '--bio-line-height': String(p.bioLineHeight ?? 1.6),
    '--bio-letter-spacing': p.bioLetterSpacing || 'normal',
    '--bio-text-shadow': p.bioEnableShadow
      ? `${p.bioTextShadowX ?? 2}px ${p.bioTextShadowY ?? 2}px ${p.bioTextShadowBlur ?? 4}px ${p.bioTextShadowColor || '#000000'}`
      : 'none',
    '--bio-text-stroke': p.bioTextStroke || 'initial',

    /* ---- Reputation voting ---- */
    '--rep-hover-color': p.usernameTextColor || '#ffffff',
    '--rep-active-color': p.usernameTextColor || '#ffffff',

    /* ---- Shimmer / glow ---- */
    '--shimmer-color': shimmerColor,
    '--shimmer-border-color': `${shimmerColor}40`,
    '--profile-glow-color': glowColor,

    /* ---- Background ---- */
    '--bg-opacity': String(p.backgroundOpacity ?? 1),
    '--bg-blur': `${p.backgroundBlur ?? 0}px`,
  };

  // XSS-sanitized URL for CSS - strict character whitelist
  const sanitizeCssUrl = (u: string): string => {
    // Allow only safe URL characters: alphanumeric, common path chars, data: URLs
    // Block: quotes, parens, backslashes, newlines, control chars, script/protocol patterns
    const cleaned = String(u).replace(/['"\\();\n\r]/g, '');
    // Filter out control chars (0-31 and 127) using charCodeAt to avoid ESLint errors
    const noControl = cleaned
      .split('')
      .filter((c) => {
        const code = c.charCodeAt(0);
        return code > 31 && code !== 127;
      })
      .join('');
    return noControl.replace(/^(javascript|data:text\/html|data:text\/javascript|vbscript):/i, '');
  };

  /* Background image / color inline styles */
  if (!isVideo.value && bgUrl.value) {
    vars['background-image'] = `url('${sanitizeCssUrl(bgUrl.value)}')`;
    vars['background-size'] = 'cover';
    vars['background-position'] = 'center';
    vars['background-attachment'] = 'fixed';
  } else if (!bgUrl.value) {
    vars['background-color'] = p.backgroundColor || '#1a1a1a';
  }


  return vars;
});

/* ================================================================
   SEO / META — useMeta (runs during SSR & client)
   ================================================================ */
useMeta(() => {
  const p = profile.value;
  const u = profileUser.value;
  if (!p || !u) return {};

  const title = p.seoTitle || `@${u.username}`;
  const description = p.seoDescription || p.bio || 'View my profile on mourn.bio';
  const image = p.profilePicture || '';

  const meta: Record<string, { property?: string; name?: string; content: string }> = {
    ogTitle: { property: 'og:title', content: title },
    ogDescription: { property: 'og:description', content: description },
    ogImage: { property: 'og:image', content: image },
    ogType: { property: 'og:type', content: 'profile' },
    themeColor: {
      name: 'theme-color',
      content: p.backgroundColor || '#1a1a1a',
    },
    twitterCard: { name: 'twitter:card', content: 'summary_large_image' },
    twitterTitle: { name: 'twitter:title', content: u.username },
    twitterDescription: {
      name: 'twitter:description',
      content: description,
    },
    twitterImage: { name: 'twitter:image', content: image },
  };

  return {
    title,
    meta,
  };
});
</script>

<!-- ================================================================
     STYLES — imports the ported profile stylesheet (non-scoped so
     it can reach sub-components and pseudo-elements)
     ================================================================ -->
<style lang="scss">
@import 'src/css/profile.scss';
</style>
