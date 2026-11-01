<template>
  <nav
    v-if="rows.length"
    class="profile-links"
    :class="[
      `layout-${style.layout}`,
      `align-${style.align}`,
      `width-${style.width}`,
      `icons-${style.iconPosition}`,
      `hover-${hoverEffect}`,
      { 'hide-titles': !style.showTitles },
    ]"
    :style="cssVars"
    :aria-label="ariaLabel"
  >
    <template v-for="link in rows" :key="link.id">
      <div v-if="link.kind === 'header'" class="profile-links-header" role="presentation">
        <span class="profile-links-header-text">{{ link.title }}</span>
      </div>

      <a
        v-else
        class="profile-link"
        :class="[`style-${resolvedStyle(link)}`, { 'is-featured': link.featured }]"
        :style="linkStyleVars(link)"
        :href="isRecognized(link) ? (link.url ?? undefined) : undefined"
        :role="isRecognized(link) ? undefined : 'button'"
        :tabindex="isRecognized(link) ? undefined : 0"
        :aria-haspopup="isRecognized(link) ? undefined : 'dialog'"
        :aria-label="linkAriaLabel(link)"
        :target="isRecognized(link) && style.openNewTab ? '_blank' : undefined"
        :rel="isRecognized(link) && style.openNewTab ? 'noopener noreferrer' : undefined"
        @click="(event: Event) => activateLink(event, link)"
        @auxclick="(event: Event) => activateLink(event, link)"
        @keydown.enter="(event: Event) => activateLink(event, link)"
        @keydown.space="(event: Event) => activateLink(event, link)"
      >
        <span v-if="hasThumb(link)" class="profile-link-thumb">
          <img :src="link.thumb as string" alt="" loading="lazy" decoding="async" />
        </span>

        <span class="profile-link-icon" aria-hidden="true">
          <span v-if="display(link).kind === 'emoji'" class="profile-link-emoji">
            {{ display(link).text }}
          </span>
          <img
            v-else-if="display(link).kind === 'image'"
            :src="display(link).src"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <q-icon v-else :name="display(link).icon" />
        </span>

        <span class="profile-link-text">
          <span class="profile-link-title">{{ link.title }}</span>
          <span v-if="link.subtitle" class="profile-link-subtitle">{{ link.subtitle }}</span>
        </span>
      </a>
    </template>

    <!-- The one link that may sit outside the recognised platforms opens this instead of
         navigating: the full destination is shown and continuing is the visitor's call. -->
    <q-dialog
      v-model="showWarning"
      :aria-labelledby="titleId"
      :aria-describedby="descriptionId"
      @hide="reset"
    >
      <q-card dark style="width: 440px; max-width: 92vw">
        <q-card-section>
          <h2 :id="titleId" class="text-h6">unrecognized external link</h2>
          <p :id="descriptionId">
            this domain is not on our recognized domains list. it may be unsafe. only continue if
            you trust the destination.
          </p>
          <p class="warning-destination">{{ pendingUrl }}</p>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn v-close-popup flat label="cancel" autofocus />
          <q-btn
            :href="pendingUrl"
            target="_blank"
            rel="noopener noreferrer"
            color="negative"
            label="continue to site"
            @click="showWarning = false"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { LinkStyleConfig, ProfileLink } from 'src/types/profile';
import { LINK_WIDTHS, resolveIconDisplay } from 'src/utils/profileLinks';
import { isRecognizedHost } from 'src/utils/socialLinks';
import { useExternalLinkWarning } from 'src/composables/useExternalLinkWarning';

const props = defineProps<{
  links: ProfileLink[];
  style: LinkStyleConfig;
  /** Screen-reader label for the whole list ("links", "my links", …). */
  ariaLabel?: string;
}>();

const rows = computed(() => props.links.filter((link) => link.visible !== false));
const ariaLabel = computed(() => props.ariaLabel || 'links');

/** A per-row hover effect of "inherit" follows the profile's choice. */
const hoverEffect = computed(() =>
  props.style.hoverEffect === 'inherit' ? 'static' : props.style.hoverEffect,
);

const cssVars = computed(() => ({
  '--links-gap': `${props.style.gap}px`,
  '--links-radius': props.style.radius || '10px',
  '--links-max-width': LINK_WIDTHS[props.style.width] || LINK_WIDTHS.default,
  ...(props.style.color ? { '--links-color': props.style.color } : {}),
  ...(props.style.backgroundColor ? { '--links-bg': props.style.backgroundColor } : {}),
}));

function display(link: ProfileLink) {
  return resolveIconDisplay(link);
}

const { showWarning, pendingUrl, titleId, descriptionId, activate, reset } =
  useExternalLinkWarning();

/**
 * Recognised hosts navigate normally; anything else asks first. The server's verdict wins
 * when present (so SSR output and the client agree, approved domains included); drafts in
 * the dashboard have no verdict yet and fall back to local recognition.
 */
function isRecognized(link: ProfileLink): boolean {
  if (typeof link.recognized === 'boolean') return link.recognized;
  return !!link.url && isRecognizedHost(link.url);
}

function activateLink(event: Event, link: ProfileLink) {
  activate(event, link.url, isRecognized(link));
}

function linkAriaLabel(link: ProfileLink): string | undefined {
  if (isRecognized(link)) return undefined;
  return `${link.title || 'external link'}: ${link.url} (opens warning)`;
}

function resolvedStyle(link: ProfileLink): string {
  return link.style && link.style !== 'inherit' ? link.style : 'button';
}

function hasThumb(link: ProfileLink): boolean {
  return Boolean(link.thumb && style_showsThumbs());
}

function style_showsThumbs(): boolean {
  return props.style.showThumbs !== false && props.style.layout !== 'list';
}

function linkStyleVars(link: ProfileLink) {
  return link.accent ? { '--link-accent': link.accent } : {};
}
</script>

<style scoped>
.profile-links {
  display: flex;
  flex-direction: column;
  gap: var(--links-gap, 10px);
  width: 100%;
  max-width: var(--links-max-width, 420px);
  margin: 0 auto 2rem;
  position: relative;
  z-index: 1;
  container-type: inline-size;
}

.profile-links.layout-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: stretch;
}

.profile-links.layout-cards,
.profile-links.layout-stack {
  flex-direction: column;
}

.profile-links.align-left {
  margin-left: 0;
  margin-right: auto;
}

/* ---- section dividers ---- */
.profile-links-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  color: var(--links-color, rgba(255, 255, 255, 0.55));
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.profile-links-header-text {
  flex: 0 0 auto;
  opacity: 0.9;
}

.profile-links-header::after {
  content: '';
  flex: 1 1 auto;
  height: 1px;
  background: currentColor;
  opacity: 0.25;
}

/* ---- rows ---- */
.profile-link {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--profile-card-border-color, rgba(255, 255, 255, 0.14));
  border-radius: var(--links-radius, 10px);
  background: var(--links-bg, transparent);
  color: var(--links-color, var(--bio-text-color, #eee));
  text-decoration: none;
  font-size: 14px;
  line-height: 1.35;
  text-align: left;
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    transform 0.18s ease,
    color 0.18s ease;
  min-height: 44px;
  overflow: hidden;
}

.profile-link:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}

.profile-link:hover {
  border-color: var(--link-accent, #f00);
  color: var(--links-color, var(--bio-text-color, #fff));
  transform: translateY(-1px);
}

.profile-link.hover-bounce:hover {
  animation: links-bounce 0.5s ease;
}
.profile-link.hover-glow:hover {
  filter: drop-shadow(0 0 5px var(--link-accent, #f00));
}
.profile-link.hover-scale:hover {
  transform: scale(1.015);
}
.profile-link.hover-static:hover {
  transform: none;
}

.profile-link.is-featured {
  border-color: var(--link-accent, #f00);
  box-shadow: inset 0 0 0 1px var(--link-accent, #f00);
}

/* ---- icon ---- */
.profile-link-icon {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  font-size: 18px;
  color: inherit;
}

.profile-link-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 4px;
}

.profile-link-emoji {
  font-size: 18px;
  line-height: 1;
}

/* ---- text ---- */
.profile-link-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.profile-link-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-link-subtitle {
  font-size: 11px;
  opacity: 0.65;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Profile-level "show titles" off: icon-only rows (the title stays in the DOM for
   screen readers, it is only visually collapsed). */
.profile-links.hide-titles .profile-link-title {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.profile-links.hide-titles .profile-link.style-button,
.profile-links.hide-titles .profile-link.style-card {
  justify-content: center;
}
.profile-links.hide-titles .profile-link-icon {
  position: static;
}

/* ---- per-row style variants ---- */
.profile-links.layout-stack .profile-link.style-button .profile-link-text,
.profile-links.layout-grid .profile-link.style-button .profile-link-text {
  align-items: center;
  text-align: center;
}
.profile-links.layout-stack .profile-link.style-button,
.profile-links.layout-grid .profile-link.style-button {
  justify-content: center;
}
.profile-links.layout-stack .profile-link.style-button .profile-link-icon,
.profile-links.layout-grid .profile-link.style-button .profile-link-icon {
  position: absolute;
  left: 14px;
}
.profile-links.layout-stack .profile-link.style-button,
.profile-links.layout-grid .profile-link.style-button {
  position: relative;
}

.profile-link.style-text {
  border-color: transparent;
  background: transparent;
  padding: 8px 4px;
  min-height: 0;
}
.profile-link.style-text:hover {
  border-color: transparent;
  text-decoration: underline;
  transform: none;
}

.profile-link.style-icon {
  justify-content: center;
  padding: 10px;
  min-height: 0;
}
.profile-link.style-icon .profile-link-text {
  display: none;
}

.profile-link.style-card {
  align-items: stretch;
  padding: 0;
  min-height: 0;
}
.profile-link.style-card .profile-link-text {
  padding: 12px 14px;
  justify-content: center;
}
.profile-link.style-card .profile-link-icon {
  margin: 0 0 0 14px;
}
.profile-links.layout-cards .profile-link.style-card,
.profile-links.layout-stack .profile-link.style-card,
.profile-links.layout-grid .profile-link.style-card {
  flex-direction: row;
}

.profile-link-thumb {
  flex: 0 0 auto;
  width: 64px;
  align-self: stretch;
  min-height: 64px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
}
.profile-link-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* ---- icon position (stack + cards) ---- */
.profile-links.icons-top .profile-link:not(.style-icon):not(.style-text) {
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
}
.profile-links.icons-top .profile-link-text {
  align-items: center;
}
.profile-links.icons-right .profile-link:not(.style-icon):not(.style-text) {
  flex-direction: row-reverse;
  justify-content: flex-start;
  text-align: right;
}
.profile-links.icons-right .profile-link-text {
  align-items: flex-end;
}

/* ---- list layout: one compact line per link ---- */
.profile-links.layout-list {
  max-width: var(--links-max-width, 420px);
}
.profile-links.layout-list .profile-link {
  padding: 7px 2px;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0;
  min-height: 36px;
  background: transparent;
}
.profile-links.layout-list .profile-link:last-child {
  border-bottom: none;
}
.profile-links.layout-list .profile-link:hover {
  transform: none;
  padding-left: 6px;
  border-color: rgba(255, 255, 255, 0.08);
  border-bottom-color: var(--link-accent, #f00);
}
.profile-links.layout-list .profile-link-icon {
  width: 16px;
  height: 16px;
  font-size: 14px;
}
.profile-links.layout-list .profile-link-subtitle {
  display: none;
}

@keyframes links-bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-3px);
  }
}

.warning-destination {
  overflow-wrap: anywhere;
}

@media (prefers-reduced-motion: reduce) {
  .profile-link,
  .profile-link:hover {
    transition: none;
    transform: none;
    animation: none;
  }
}

@container (max-width: 340px) {
  .profile-links.layout-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .profile-link-thumb {
    width: 48px;
    min-height: 48px;
  }
}

/* Mobile: keep the tap targets honest and stop the longest titles from wrapping */
@media (max-width: 480px) {
  .profile-links {
    gap: max(var(--links-gap, 10px), 8px);
  }
  .profile-link {
    padding: 11px 12px;
  }
  .profile-links.icons-top .profile-link {
    padding: 14px 12px;
  }
  .profile-link-title {
    font-size: 13px;
  }
}
</style>
