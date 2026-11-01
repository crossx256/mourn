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
            links
          </h1>
        </div>
        <p class="text-muted text-xs m-0">everything you want to point people at</p>
      </div>
    </div>

    <!-- ── Display mode ─────────────────────────────────────────────── -->
    <q-card flat bordered dark class="dash-card mb-5" data-field="links-display">
      <q-card-section>
        <div class="dash-section-title">display</div>
        <p class="text-muted text-xs mb-4">
          how your links appear on your page — you can switch back at any time, nothing is deleted.
        </p>

        <div class="mode-grid" role="radiogroup" aria-label="how links appear on your page">
          <button
            v-for="mode in displayModes"
            :key="mode.value"
            type="button"
            class="mode-tile"
            :class="{ 'is-active': linksDisplay === mode.value }"
            role="radio"
            :aria-checked="linksDisplay === mode.value"
            @click="setLinkStyle('linksDisplay', mode.value)"
          >
            <span class="mode-tile-top">
              <span class="mode-tile-icon"><q-icon :name="mode.icon" /></span>
              <span v-if="linksDisplay === mode.value" class="mode-tile-current">
                <q-icon name="mdi-check-circle" /> current
              </span>
            </span>
            <span class="mode-tile-label">{{ mode.label }}</span>
            <span class="mode-tile-hint">{{ mode.hint }}</span>
          </button>
        </div>

        <q-toggle
          v-if="linksDisplay === 'linktree'"
          v-model="showClassicIcons"
          label="also show the classic icon row underneath"
          dense
          dark
          class="mt-3"
        />
      </q-card-section>
    </q-card>

    <!-- ── Links list ───────────────────────────────────────────────── -->
    <q-card
      v-if="linksDisplay === 'linktree'"
      flat
      bordered
      dark
      class="dash-card mb-5"
      data-field="profile-links"
    >
      <q-card-section>
        <div class="dash-section-title">links</div>
        <p class="text-muted text-xs mb-3">
          the order here is the order on your page · {{ links.length }} / {{ linkCap }} used ·
          {{ unrecognizedCount }} / {{ MAX_UNRECOGNIZED_LINKS }} outside the recognized platforms
        </p>

        <form class="flex items-start gap-2" @submit.prevent="addSingleLink">
          <q-input
            v-model="newUrl"
            type="url"
            label="link url"
            placeholder="https://example.com/you"
            dark
            filled
            square
            dense
            class="flex-1"
            :error="!!inputError"
            :error-message="inputError"
            @update:model-value="inputError = ''"
          />
          <q-btn type="submit" label="add" color="primary" no-caps :disable="!newUrl.trim()" />
        </form>

        <q-expansion-item
          dense
          dark
          icon="mdi-content-paste"
          label="paste several at once"
          caption="one per line — title | https://link"
          class="link-bulk mt-3"
        >
          <q-input
            v-model="bulkText"
            type="textarea"
            autogrow
            dark
            filled
            square
            dense
            placeholder="my tape | https://youtube.com/@me&#10;https://github.com/someone"
            class="mt-2"
          />
          <div class="flex items-center gap-2 mt-2 flex-wrap">
            <q-btn
              label="add all"
              color="primary"
              no-caps
              :disable="!bulkText.trim()"
              @click="addBulkLinks"
            />
            <q-btn flat label="clear" no-caps @click="clearBulk" />
            <span class="text-xs text-muted">titles and icons are filled in for you</span>
          </div>
        </q-expansion-item>

        <p role="status" class="text-xs mt-2 mb-0">{{ status }}</p>
        <ul v-if="bulkReasons.length" class="link-reasons">
          <li v-for="reason in bulkReasons" :key="reason">{{ reason }}</li>
        </ul>

        <p v-if="links.length > 1" class="text-xs text-muted mt-3 mb-0">
          drag the handle to reorder — the order here is the order on your page
        </p>
        <ul v-if="links.length" class="link-list" :class="{ 'is-sorting': dragIndex !== null }">
          <li
            v-for="(link, index) in links"
            :key="link.id"
            :ref="(element) => setRowRef(element as HTMLElement | null, index)"
            class="link-row"
            :class="{ 'is-dragging': dragIndex === index }"
          >
            <button
              type="button"
              class="link-row-handle"
              :aria-label="`drag ${link.title || 'link'} to reorder`"
              @pointerdown="(event: PointerEvent) => sort.onPointerdown(event, index)"
            >
              <q-icon name="mdi-drag-vertical" />
            </button>
            <span class="link-row-index">{{ index + 1 }}</span>

            <span class="link-row-icon" aria-hidden="true">
              <span v-if="display(link).kind === 'emoji'">{{ display(link).text }}</span>
              <img v-else-if="display(link).kind === 'image'" :src="display(link).src" alt="" />
              <q-icon v-else :name="display(link).icon" />
            </span>

            <span class="link-row-text">
              <span class="link-row-title" :class="{ 'is-muted': link.kind === 'header' }">
                {{ link.title || '(untitled)' }}
              </span>
              <span v-if="link.kind === 'header'" class="link-row-tag">section</span>
              <span v-else class="link-row-host">{{ linkHost(link.url ?? '') }}</span>
            </span>

            <span v-if="!isRecognized(link)" class="link-row-tag link-row-tag-warn"
              >unrecognized</span
            >
            <span v-if="!link.visible" class="link-row-tag link-row-tag-hidden">hidden</span>
            <span v-if="link.featured" class="link-row-tag link-row-tag-featured">featured</span>

            <span class="link-row-actions">
              <q-btn
                flat
                round
                dense
                icon="mdi-arrow-up"
                :disable="index === 0"
                :aria-label="`move ${link.title} up`"
                @click="reorder(link.id, -1)"
              />
              <q-btn
                flat
                round
                dense
                icon="mdi-arrow-down"
                :disable="index === links.length - 1"
                :aria-label="`move ${link.title} down`"
                @click="reorder(link.id, 1)"
              />
              <q-btn
                flat
                round
                dense
                icon="mdi-arrow-collapse-up"
                :disable="index === 0"
                :aria-label="`move ${link.title} to the top`"
                @click="promote(link.id)"
              />
              <q-btn
                flat
                round
                dense
                icon="mdi-tune"
                :aria-label="`edit ${link.title}`"
                @click="openEditor(link)"
              />
            </span>
          </li>
        </ul>
        <p v-else class="text-muted text-xs">no links added yet</p>

        <q-btn
          flat
          dense
          no-caps
          icon="mdi-plus"
          label="add a section heading"
          class="mt-2"
          @click="addHeader"
        />
      </q-card-section>
    </q-card>

    <!-- ── Recognized platforms (domain requests) ───────────────────── -->
    <q-card flat bordered dark class="dash-card mb-5" data-field="domain-requests">
      <q-card-section>
        <div class="dash-section-title">recognized platforms</div>
        <p class="text-muted text-xs mb-3">
          a link outside the recognized platforms shows visitors a warning. ask for its domain to be
          verified and, once approved, it works normally for everyone — no warning, and it stops
          using your one unverified link.
        </p>

        <form class="flex items-start gap-2" @submit.prevent="submitDomainRequest">
          <q-input
            v-model="domainInput"
            label="domain"
            placeholder="example.com"
            dark
            filled
            square
            dense
            class="flex-1"
            :error="!!domainError"
            :error-message="domainError"
            :disable="domainStore.submitting"
            @update:model-value="domainError = ''"
          />
          <q-btn
            type="submit"
            label="request"
            color="primary"
            no-caps
            :disable="!domainInput.trim()"
            :loading="domainStore.submitting"
          />
        </form>

        <p v-if="unknownHost" class="text-xs text-muted mt-2 mb-0">
          your unverified link is <span class="domain-host">{{ unknownHost }}</span> — get it
          approved and the warning disappears for everyone
        </p>
        <p role="status" class="text-xs mt-2 mb-0">{{ domainFeedback }}</p>

        <ul v-if="domainStore.submissions.length" class="link-list">
          <li v-for="request in domainStore.submissions" :key="request.id" class="link-row">
            <span class="link-row-icon" aria-hidden="true">
              <q-icon :name="statusIcon(request.status)" />
            </span>
            <span class="link-row-text">
              <span class="link-row-title">{{ request.domain }}</span>
              <span class="link-row-host">{{ request.note || statusHint(request) }}</span>
            </span>
            <span class="link-row-tag" :class="`domain-status-${request.status.toLowerCase()}`">
              {{ statusLabel(request.status) }}
            </span>
          </li>
        </ul>
        <p v-else class="text-muted text-xs">
          {{ domainStore.loading ? 'loading your requests…' : 'no requests yet' }}
        </p>
      </q-card-section>
    </q-card>

    <!-- ── Layout ───────────────────────────────────────────────────── -->
    <q-card
      v-if="linksDisplay === 'linktree'"
      flat
      bordered
      dark
      class="dash-card mb-5"
      data-field="links-layout"
    >
      <q-card-section>
        <div class="dash-section-title">layout</div>

        <div class="grid grid-cols-2 gap-4 mb-4">
          <q-select
            v-model="layout"
            :options="layoutOptions"
            label="layout"
            dark
            filled
            square
            dense
            emit-value
            map-options
          />
          <q-select
            v-model="position"
            :options="positionOptions"
            label="position on page"
            dark
            filled
            square
            dense
            emit-value
            map-options
          />
          <q-select
            v-model="iconPosition"
            :options="iconPositionOptions"
            label="icon position"
            dark
            filled
            square
            dense
            emit-value
            map-options
          />
          <q-select
            v-model="hoverEffect"
            :options="hoverEffectOptions"
            label="hover effect"
            dark
            filled
            square
            dense
            emit-value
            map-options
          />
        </div>

        <div class="flex flex-wrap items-center gap-6 mb-4">
          <div>
            <div class="text-xs text-muted mb-2">align</div>
            <q-btn-toggle
              v-model="align"
              :options="[
                { label: 'center', value: 'center' },
                { label: 'left', value: 'left' },
              ]"
              dense
              no-caps
              toggle-color="primary"
              color="dark"
              text-color="grey-5"
            />
          </div>
          <div>
            <div class="text-xs text-muted mb-2">width</div>
            <q-btn-toggle
              v-model="width"
              :options="[
                { label: 'narrow', value: 'narrow' },
                { label: 'default', value: 'default' },
                { label: 'wide', value: 'wide' },
              ]"
              dense
              no-caps
              toggle-color="primary"
              color="dark"
              text-color="grey-5"
            />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4 mb-4">
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted">text colour</span>
            <q-input v-model="color" dark filled square dense class="flex-1">
              <template #prepend>
                <div
                  class="w-4 h-4 rounded-sm"
                  :style="{ background: color || 'transparent' }"
                ></div>
              </template>
              <template #append>
                <q-icon name="mdi-eyedropper" class="cursor-pointer">
                  <q-popup-proxy><q-color v-model="color" dark /></q-popup-proxy>
                </q-icon>
              </template>
            </q-input>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted">button colour</span>
            <q-input v-model="bgColor" dark filled square dense class="flex-1">
              <template #prepend>
                <div
                  class="w-4 h-4 rounded-sm"
                  :style="{ background: bgColor || 'transparent' }"
                ></div>
              </template>
              <template #append>
                <q-icon name="mdi-eyedropper" class="cursor-pointer">
                  <q-popup-proxy><q-color v-model="bgColor" dark /></q-popup-proxy>
                </q-icon>
              </template>
            </q-input>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4 mb-4">
          <div>
            <div class="text-xs text-muted mb-2">corner radius: {{ radiusLabel }}</div>
            <q-slider
              :model-value="radiusNumber"
              :min="0"
              :max="32"
              :step="2"
              dark
              color="primary"
              thumb-size="12px"
              track-size="4px"
              @update:model-value="onRadiusChange"
            />
          </div>
          <div>
            <div class="text-xs text-muted mb-2">spacing: {{ gap }}px</div>
            <q-slider
              v-model="gap"
              :min="0"
              :max="32"
              :step="2"
              dark
              color="primary"
              thumb-size="12px"
              track-size="4px"
            />
          </div>
        </div>

        <div class="flex flex-wrap gap-5">
          <q-toggle v-model="showTitles" label="show titles" dense dark />
          <q-toggle v-model="showThumbs" label="show thumbnails" dense dark />
          <q-toggle v-model="openNewTab" label="open in a new tab" dense dark />
        </div>
      </q-card-section>
    </q-card>

    <!-- ── Classic social row ───────────────────────────────────────── -->
    <q-card flat bordered dark class="dash-card mb-5" data-field="social-links">
      <q-card-section>
        <div class="dash-section-title">social icons (classic)</div>
        <p class="text-muted text-xs mb-4">
          {{
            linksDisplay === 'classic'
              ? 'shown on your page: one icon per platform'
              : 'only shown on your page if you enable it above'
          }}
        </p>

        <div @mouseleave="showDomains = infoFocused">
          <div class="flex items-center gap-2 mb-4">
            <span class="text-xs text-muted">one link per platform, plus one other URL</span>
            <q-btn
              flat
              round
              dense
              icon="mdi-information-outline"
              aria-label="recognized social domains"
              :aria-expanded="showDomains"
              :aria-controls="domainsId"
              @mouseenter="showDomains = true"
              @focus="
                infoFocused = true;
                showDomains = true;
              "
              @blur="
                infoFocused = false;
                showDomains = false;
              "
              @click="showDomains = true"
              @keydown.esc="showDomains = false"
            />
          </div>
          <div
            v-if="showDomains"
            :id="domainsId"
            class="text-xs mb-4"
            role="region"
            aria-label="recognized social domains"
          >
            <p>recognized domains (including subdomains). recognition does not guarantee safety.</p>
            <ul class="domain-list">
              <li v-for="(domains, platform) in SOCIAL_DOMAINS" :key="platform">
                {{ platform }}: {{ domains.join(', ') }}
              </li>
            </ul>
          </div>
        </div>

        <form class="flex items-start gap-2" @submit.prevent="addSocialProfile">
          <q-input
            v-model="newSocialUrl"
            type="url"
            label="social profile URL"
            placeholder="https://example.com/you"
            dark
            filled
            square
            dense
            class="flex-1"
            :error="!!socialInputError"
            :error-message="socialInputError"
            @update:model-value="socialInputError = ''"
          />
          <q-btn
            type="submit"
            label="add"
            color="primary"
            no-caps
            :disable="!newSocialUrl.trim()"
          />
        </form>
        <p role="status" class="text-xs">{{ socialStatus }}</p>
        <ul v-if="addedSocialLinks.length" class="link-list">
          <li v-for="link in addedSocialLinks" :key="link.key" class="link-row">
            <span class="link-row-icon" aria-hidden="true">
              <img
                v-if="iconFor(link).kind === 'image'"
                :src="iconFor(link).src"
                alt=""
                class="row-custom-icon"
              />
              <span v-else-if="iconFor(link).kind === 'emoji'">{{ iconFor(link).text }}</span>
              <q-icon v-else :name="iconFor(link).icon" />
            </span>
            <span class="link-row-text">
              <span class="link-row-title">{{ link.url || link.raw }}</span>
            </span>
            <span
              v-if="!link.recognized"
              class="text-negative"
              role="img"
              :aria-label="
                link.url
                  ? 'unrecognized domain — visitors will see a warning'
                  : 'invalid URL — not shown on your profile'
              "
            >
              <q-icon name="mdi-alert" aria-hidden="true" />
              <q-tooltip>{{
                link.url
                  ? 'unrecognized domain — visitors will see a warning'
                  : 'invalid URL — not shown on your profile'
              }}</q-tooltip>
            </span>
            <span class="link-row-actions">
              <q-btn
                flat
                round
                dense
                :icon="socialIcons[link.key] ? 'mdi-image-edit' : 'mdi-image-edit-outline'"
                :color="socialIcons[link.key] ? 'primary' : undefined"
                :aria-label="`custom icon for ${link.platform || link.key}`"
                @click="openIconDialog(link)"
              >
                <q-tooltip>custom icon</q-tooltip>
              </q-btn>
              <q-btn
                flat
                round
                dense
                icon="mdi-close"
                :aria-label="`remove ${link.url || link.raw}`"
                @click="clearSocialLink(link.key)"
              />
            </span>
          </li>
        </ul>
        <p v-else class="text-muted text-xs">no social links added yet</p>

        <div class="grid grid-cols-2 gap-4 mt-4">
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted">icon color:</span>
            <q-input v-model="socialIconColor" dark filled square dense class="flex-1">
              <template #prepend>
                <div
                  class="w-4 h-4 rounded-sm"
                  :style="{ background: socialIconColor || '#ffffff' }"
                ></div>
              </template>
              <template #append>
                <q-icon name="mdi-eyedropper" class="cursor-pointer">
                  <q-popup-proxy><q-color v-model="socialIconColor" dark /></q-popup-proxy>
                </q-icon>
              </template>
            </q-input>
          </div>

          <q-select
            v-model="socialIconHoverEffect"
            :options="classicHoverOptions"
            placeholder="hover effect"
            dark
            filled
            square
            dense
            class="dashboard-no-label-field"
            emit-value
            map-options
          />
        </div>

        <div class="mt-4">
          <div class="text-xs text-muted mb-2">icon size: {{ socialIconSize }}px</div>
          <q-slider
            v-model="socialIconSize"
            :min="30"
            :max="100"
            dark
            color="primary"
            :label-value="socialIconSize + 'px'"
            thumb-size="12px"
            track-size="4px"
          />
        </div>
      </q-card-section>
    </q-card>

    <!-- ── Preview ──────────────────────────────────────────────────── -->
    <q-card flat bordered dark class="dash-card">
      <q-card-section>
        <div class="dash-section-title">preview</div>

        <div class="preview-surface">
          <ProfileLinkList
            v-if="linksDisplay === 'linktree' && links.length"
            :links="links"
            :style="previewStyle"
            aria-label="link preview"
          />

          <ProfileSocials
            v-if="linksDisplay === 'classic' || showClassicIcons"
            :social-links="socialLinks"
            :social-icons="socialIcons"
            :hover-effect="socialIconHoverEffect"
            :style="iconPreviewStyle"
            class="preview-classic"
          />

          <div v-if="linksDisplay === 'linktree' && !links.length" class="text-hellamuted text-xs">
            no links yet — your page keeps showing the classic icon row until you add some
          </div>
        </div>
      </q-card-section>
    </q-card>

    <SocialIconDialog
      v-model="iconDialogOpen"
      :platform-key="iconDialogKey"
      :platform-label="iconDialogLabel"
      :current="iconDialogCurrent"
      @save="saveSocialIcon"
    />

    <LinkEditorDialog
      v-model="editorOpen"
      :link="editing"
      :validate="validateLink"
      @apply="applyEditedLink"
      @remove="removeEditedLink"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, useId } from 'vue';
import { useQuasar } from 'quasar';
import { useDashboardStore } from 'src/stores/dashboard';
import ProfileSocials from 'src/components/profile/ProfileSocials.vue';
import ProfileLinkList from 'src/components/profile/ProfileLinkList.vue';
import LinkEditorDialog from 'src/components/dashboard/LinkEditorDialog.vue';
import SocialIconDialog from 'src/components/dashboard/SocialIconDialog.vue';
import {
  SOCIAL_DOMAINS,
  addSocialLink,
  socialIconDisplay,
  socialLinkEntries,
} from 'src/utils/socialLinks';
import { useDomainRequestsStore } from 'src/stores/domainRequests';
import { useApprovedDomainsStore } from 'src/stores/approvedDomains';
import { createPointerSort } from 'src/composables/usePointerSort';
import { hapticSelect, hapticTap } from 'src/composables/useHaptics';
import { moveItem } from 'src/utils/listDrag';
import {
  MAX_LINKS,
  MAX_UNRECOGNIZED_LINKS,
  linkHost,
  linkStyleFromProfile,
  makeHeaderLink,
  makeProfileLink,
  moveLink,
  moveLinkToTop,
  parseBulkLinks,
  removeLink,
  resolveIconDisplay,
  unrecognizedConflict,
  unrecognizedLinks,
  updateLink,
} from 'src/utils/profileLinks';
import { isRecognizedHost } from 'src/utils/socialLinks';
import type { LinksLayout, ProfileLink } from 'src/types/profile';

const dashboardStore = useDashboardStore();
const $q = useQuasar();

const displayModes = [
  {
    value: 'classic' as const,
    label: 'classic icon row',
    hint: 'the icons you already have, one per platform',
    icon: 'mdi-share-variant',
  },
  {
    value: 'linktree' as const,
    label: 'link list',
    hint: 'titled links you can order, icon and style',
    icon: 'mdi-format-list-bulleted-square',
  },
];

const profile = computed(() => dashboardStore.profile);
const linkCap = computed(() => (dashboardStore.isDonator ? MAX_LINKS.donator : MAX_LINKS.standard));
const links = computed<ProfileLink[]>(() => profile.value.profileLinks ?? []);
const previewStyle = computed(() => linkStyleFromProfile(profile.value));

const linksDisplay = computed(() => profile.value.linksDisplay ?? 'classic');
const showClassicIcons = computed({
  get: () => profile.value.linksShowClassicIcons ?? false,
  set: (value: boolean) => dashboardStore.setLinkStyle('linksShowClassicIcons', value),
});
const layout = computed({
  get: () => profile.value.linksLayout ?? 'stack',
  set: (value: LinksLayout) => dashboardStore.setLinkStyle('linksLayout', value),
});
const align = computed({
  get: () => profile.value.linksAlign ?? 'center',
  set: (value: 'center' | 'left') => dashboardStore.setLinkStyle('linksAlign', value),
});
const width = computed({
  get: () => profile.value.linksWidth ?? 'default',
  set: (value: 'narrow' | 'default' | 'wide') => dashboardStore.setLinkStyle('linksWidth', value),
});
const color = computed({
  get: () => profile.value.linksColor ?? null,
  set: (value: string | null) => dashboardStore.setLinkStyle('linksColor', value || null),
});
const bgColor = computed({
  get: () => profile.value.linksBgColor ?? null,
  set: (value: string | null) => dashboardStore.setLinkStyle('linksBgColor', value || null),
});
const hoverEffect = computed({
  get: () => profile.value.linksHoverEffect ?? 'inherit',
  set: (value: string) => dashboardStore.setLinkStyle('linksHoverEffect', value),
});
const iconPosition = computed({
  get: () => profile.value.linksIconPosition ?? 'left',
  set: (value: 'left' | 'top' | 'right') => dashboardStore.setLinkStyle('linksIconPosition', value),
});
const position = computed({
  get: () => profile.value.linksPosition ?? 'below-bio',
  set: (value: 'below-bio' | 'below-stats' | 'bottom') =>
    dashboardStore.setLinkStyle('linksPosition', value),
});
const showTitles = computed({
  get: () => profile.value.linksShowTitles ?? true,
  set: (value: boolean) => dashboardStore.setLinkStyle('linksShowTitles', value),
});
const showThumbs = computed({
  get: () => profile.value.linksShowThumbs ?? true,
  set: (value: boolean) => dashboardStore.setLinkStyle('linksShowThumbs', value),
});
const openNewTab = computed({
  get: () => profile.value.linksOpenNewTab ?? true,
  set: (value: boolean) => dashboardStore.setLinkStyle('linksOpenNewTab', value),
});
const gap = computed({
  get: () => profile.value.linksGap ?? 10,
  set: (value: number) => dashboardStore.setLinkStyle('linksGap', value),
});
const radiusNumber = computed(() => parseInt(profile.value.linksRadius ?? '10', 10) || 0);
const radiusLabel = computed(() => profile.value.linksRadius || 'default');

function onRadiusChange(value: number | null) {
  dashboardStore.setLinkStyle('linksRadius', `${value ?? 0}px`);
}

const layoutOptions = [
  { label: 'stacked buttons', value: 'stack' },
  { label: 'cards', value: 'cards' },
  { label: 'compact list', value: 'list' },
  { label: '2-column grid', value: 'grid' },
];
const positionOptions = [
  { label: 'under the bio', value: 'below-bio' },
  { label: 'under the stats', value: 'below-stats' },
  { label: 'bottom of the card', value: 'bottom' },
];
const iconPositionOptions = [
  { label: 'left of the title', value: 'left' },
  { label: 'above the title', value: 'top' },
  { label: 'right of the title', value: 'right' },
];
const hoverEffectOptions = [
  { label: 'follow page', value: 'inherit' },
  { label: 'none', value: 'static' },
  { label: 'bounce', value: 'bounce' },
  { label: 'glow', value: 'glow' },
  { label: 'scale', value: 'scale' },
];
const classicHoverOptions = [
  { label: 'none', value: 'static' },
  { label: 'bounce', value: 'bounce' },
  { label: 'glow', value: 'glow' },
  { label: 'scale', value: 'scale' },
];

type LinkStyleField =
  | 'linksDisplay'
  | 'linksLayout'
  | 'linksAlign'
  | 'linksWidth'
  | 'linksRadius'
  | 'linksColor'
  | 'linksBgColor'
  | 'linksHoverEffect'
  | 'linksPosition'
  | 'linksIconPosition'
  | 'linksGap'
  | 'linksShowTitles'
  | 'linksShowThumbs'
  | 'linksOpenNewTab'
  | 'linksShowClassicIcons';

function setLinkStyle(field: LinkStyleField, value: string | number | boolean | null) {
  dashboardStore.setLinkStyle(field, value);
}

function display(link: ProfileLink) {
  return resolveIconDisplay(link);
}

/** Recognised platform hosts are unlimited; only N link(s) may sit outside the list. */
function isRecognized(link: ProfileLink): boolean {
  return link.kind === 'header' || (!!link.url && isRecognizedHost(link.url));
}

const unrecognizedCount = computed(() => unrecognizedLinks(links.value).length);

/** Passed to the link dialog so an edit that breaks the rule is refused before it saves. */
function validateLink(next: ProfileLink): string | null {
  return unrecognizedConflict(updateLink(links.value, next.id, next));
}

/* ── link list editing ──────────────────────────────────────────── */
const newUrl = ref('');
const inputError = ref('');
const status = ref('');
const bulkText = ref('');
const bulkReasons = ref<string[]>([]);
const editorOpen = ref(false);
const editing = ref<ProfileLink | null>(null);

/* ── drag to reorder ───────────────────────────────────────────────
   Pointer-driven (mouse + touch + pen) via usePointerSort; the arrow buttons stay for
   keyboard and screen-reader users, so reordering never depends on a gesture. */
const dragIndex = ref<number | null>(null);
const rowElements = ref<Array<HTMLElement | null>>([]);

function setRowRef(element: HTMLElement | null, index: number) {
  rowElements.value[index] = element;
}

const sort = createPointerSort({
  elements: () => {
    rowElements.value.length = links.value.length;
    return rowElements.value;
  },
  onStart: (index) => {
    dragIndex.value = index;
    void hapticSelect();
  },
  onMove: (fromIndex, toIndex) => {
    commit(moveItem(links.value, fromIndex, toIndex));
    // The DOM order changed: keep the ref list in step with the new indices.
    rowElements.value = moveItem(rowElements.value, fromIndex, toIndex);
    dragIndex.value = toIndex;
  },
  onEnd: () => {
    dragIndex.value = null;
    status.value = 'order updated';
    void hapticTap();
  },
});

function commit(next: ProfileLink[]) {
  dashboardStore.setProfileLinks(next);
}

function addSingleLink() {
  const row = makeProfileLink(newUrl.value.trim());
  if (!row) {
    inputError.value = 'enter a full http:// or https:// URL (max 500 characters)';
    status.value = '';
    return;
  }
  if (links.value.some((link) => link.url === row.url)) {
    inputError.value = 'this link is already added';
    return;
  }
  if (links.value.length >= linkCap.value) {
    inputError.value = `you have reached ${linkCap.value} links`;
    return;
  }
  const conflict = unrecognizedConflict([...links.value, row]);
  if (conflict) {
    inputError.value = conflict;
    status.value = '';
    return;
  }
  commit([...links.value, row]);
  newUrl.value = '';
  inputError.value = '';
  status.value = `added ${row.title}`;
}

function addBulkLinks() {
  const { rows, skipped } = parseBulkLinks(bulkText.value, {
    existing: links.value,
    max: linkCap.value,
    maxUnrecognized: MAX_UNRECOGNIZED_LINKS,
  });
  if (rows.length) commit([...links.value, ...rows]);
  bulkReasons.value = skipped.slice(0, 6);
  status.value = rows.length
    ? `added ${rows.length} link${rows.length === 1 ? '' : 's'}${
        skipped.length ? `, skipped ${skipped.length}` : ''
      }`
    : 'nothing added';
  if (rows.length) bulkText.value = '';
}

function clearBulk() {
  bulkText.value = '';
  bulkReasons.value = [];
}

function addHeader() {
  if (links.value.length >= linkCap.value) {
    status.value = `you have reached ${linkCap.value} links`;
    return;
  }
  const header = makeHeaderLink('new section');
  commit([...links.value, header]);
  editing.value = header;
  editorOpen.value = true;
}

function reorder(id: string, delta: number) {
  commit(moveLink(links.value, id, delta));
}

function promote(id: string) {
  commit(moveLinkToTop(links.value, id));
}

function openEditor(link: ProfileLink) {
  editing.value = link;
  editorOpen.value = true;
}

function applyEditedLink(next: ProfileLink) {
  commit(updateLink(links.value, next.id, next));
  status.value = 'link updated';
}

function removeEditedLink(id: string) {
  commit(removeLink(links.value, id));
  status.value = 'link removed';
}

/* ── per-platform custom icons (classic row) ────────────────────── */
const socialIcons = computed(() => profile.value.socialIcons ?? {});
const iconDialogOpen = ref(false);
const iconDialogKey = ref('');
const iconDialogLabel = ref('');
const iconDialogCurrent = computed(() => socialIcons.value[iconDialogKey.value] ?? null);

function iconFor(link: { key: string; icon: string }) {
  return socialIconDisplay(socialIcons.value[link.key] ?? null, link.icon);
}

function openIconDialog(link: { key: string; platform: string | null }) {
  iconDialogKey.value = link.key;
  iconDialogLabel.value = link.platform || (link.key === 'custom' ? 'other link' : link.key);
  iconDialogOpen.value = true;
}

function saveSocialIcon(icon: Parameters<typeof dashboardStore.setSocialIcon>[1]) {
  dashboardStore.setSocialIcon(iconDialogKey.value, icon);
}

/* ── recognized platforms (domain requests) ─────────────────────── */
const domainStore = useDomainRequestsStore();
const approvedDomainsStore = useApprovedDomainsStore();
const domainInput = ref('');
const domainError = ref('');

// `unrecognizedLinks` reads a module-level approved set (registered by the
// approvedDomains store), so this computed has to READ the reactive domain list
// too — otherwise an approval that lands while the links tab is open refreshes
// the set but leaves the "your unverified link is …" line stale until a reload.
const unknownLink = computed(() => {
  void approvedDomainsStore.domains;
  return unrecognizedLinks(links.value)[0] ?? null;
});
const unknownHost = computed(() =>
  unknownLink.value ? linkHost(unknownLink.value.url ?? '') : '',
);
const domainFeedback = computed(() => domainError.value || domainStore.error || domainStore.notice);

function statusLabel(status: string): string {
  return status.toLowerCase();
}

function statusIcon(status: string): string {
  if (status === 'APPROVED') return 'mdi-check-circle';
  if (status === 'REJECTED') return 'mdi-close-circle';
  return 'mdi-clock-outline';
}

function statusHint(request: { status: string; reviewedAt: string | null }): string {
  if (request.status === 'PENDING') return 'waiting for review';
  if (request.status === 'APPROVED') return 'recognized for everyone';
  return 'rejected — you can ask again';
}

async function submitDomainRequest() {
  const value = domainInput.value.trim();
  if (!value) return;
  domainError.value = '';
  const row = await domainStore.submit(value);
  if (!row) return;
  domainInput.value = '';
  // An approval can land while the user is here: refresh the recognition overlay so the
  // warning and the one-unverified-link count follow the decision.
  await approvedDomainsStore.refresh();
}

onMounted(async () => {
  await Promise.all([domainStore.fetchMine(), approvedDomainsStore.ensureLoaded()]);
  // Offer the domain they are actually blocked on, unless they already asked about it.
  if (unknownHost.value && !domainStore.statusOf(unknownHost.value)) {
    domainInput.value = unknownHost.value;
  }
});

/* ── classic social icons ───────────────────────────────────────── */
const showDomains = ref(false);
const infoFocused = ref(false);
const domainsId = useId();
const newSocialUrl = ref('');
const socialInputError = ref('');
const socialStatus = ref('');
const socialLinks = computed(() => (profile.value.socialLinks as Record<string, string>) || {});
const addedSocialLinks = computed(() => socialLinkEntries(socialLinks.value));
const socialIconColor = computed({
  get: () => profile.value.socialIconColor || '#ffffff',
  set: (value: string) => dashboardStore.updateField('socialIconColor', value),
});
const socialIconHoverEffect = computed({
  get: () => profile.value.socialIconHoverEffect,
  set: (value: string) => dashboardStore.updateField('socialIconHoverEffect', value),
});
const socialIconSize = computed({
  get: () => profile.value.socialIconSize,
  set: (value: number) => dashboardStore.updateField('socialIconSize', value),
});
const iconPreviewStyle = computed(() => ({
  color: socialIconColor.value,
  fontSize: `${socialIconSize.value}px`,
}));

function addSocialProfile() {
  try {
    dashboardStore.updateField('socialLinks', addSocialLink(socialLinks.value, newSocialUrl.value));
    newSocialUrl.value = '';
    socialInputError.value = '';
    socialStatus.value = 'link added';
  } catch (error) {
    socialInputError.value = error instanceof Error ? error.message : 'unable to add link';
    socialStatus.value = '';
  }
}

function clearSocialLink(key: string) {
  const next = { ...socialLinks.value };
  delete next[key];
  dashboardStore.updateField('socialLinks', Object.keys(next).length ? next : null);
  socialStatus.value = 'link removed';
}
</script>

<style scoped>
.mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.mode-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
  padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: transparent;
  color: #ddd;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
}

.mode-tile:hover {
  border-color: #f00;
}

.mode-tile:focus-visible {
  outline: 2px solid #f00;
  outline-offset: 2px;
}

.mode-tile.is-active {
  border-color: #f00;
  background: rgba(255, 0, 0, 0.08);
  color: #fff;
}

.mode-tile-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.mode-tile-icon {
  font-size: 18px;
}

.mode-tile-current {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #f55;
}

.mode-tile.is-active .mode-tile-label {
  color: #fff;
}

.mode-tile-label {
  font-size: 13px;
  font-weight: 600;
}

.mode-tile-hint {
  font-size: 11px;
  opacity: 0.6;
  line-height: 1.3;
}

.link-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
}

.link-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  min-height: 40px;
}

.link-row:last-child {
  border-bottom: none;
}

/* Drag handle: only the handle claims a drag, so the page still scrolls normally. */
.link-row-handle {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 32px;
  margin-right: -4px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #bbb;
  font-size: 15px;
  opacity: 0.5;
  cursor: grab;
  touch-action: none; /* the browser must not scroll while we own the gesture */
  transition:
    opacity 0.15s ease,
    color 0.15s ease;
}

.link-row-handle:hover {
  opacity: 0.95;
  color: #f55;
}

.link-row-handle:focus-visible {
  outline: 2px solid #f00;
  outline-offset: 1px;
  opacity: 1;
}

.link-row.is-dragging {
  position: relative;
  z-index: 2;
  border-bottom-color: transparent;
  border-radius: 6px;
  background: rgba(255, 0, 0, 0.06);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
}

.link-row.is-dragging .link-row-handle {
  cursor: grabbing;
  opacity: 1;
  color: #f00;
}

.link-list.is-sorting {
  user-select: none;
}

.link-row-index {
  flex: 0 0 18px;
  font-size: 10px;
  opacity: 0.45;
  text-align: right;
}

.link-row-icon {
  flex: 0 0 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  opacity: 0.9;
}

.link-row-icon img {
  width: 18px;
  height: 18px;
  object-fit: contain;
  border-radius: 3px;
}

.link-row-text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.link-row-title {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-row-title.is-muted {
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 11px;
  opacity: 0.8;
}

.link-row-host {
  font-size: 11px;
  opacity: 0.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-row-tag {
  flex: 0 0 auto;
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 1px 5px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 3px;
  opacity: 0.7;
}

.row-custom-icon {
  width: 1em;
  height: 1em;
  object-fit: contain;
  border-radius: 2px;
}

.domain-host {
  color: #fff;
}

.domain-status-pending {
  border-color: #f59e0b;
  color: #f59e0b;
}

.domain-status-approved {
  border-color: #22c55e;
  color: #22c55e;
}

.domain-status-rejected {
  border-color: #ef4444;
  color: #ef4444;
}

.link-row-tag-warn {
  border-color: #f59e0b;
  color: #f59e0b;
}

.link-row-tag-featured {
  border-color: #f00;
  color: #f55;
  opacity: 0.9;
}

.link-row-tag-hidden {
  opacity: 0.5;
}

.link-row-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
}

.link-reasons {
  margin: 4px 0 0;
  padding-left: 16px;
  font-size: 11px;
  opacity: 0.65;
}

.domain-list {
  margin: 6px 0 0;
  padding-left: 16px;
  max-height: 160px;
  overflow-y: auto;
}

.preview-surface {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 20px 16px;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 8px;
  min-height: 120px;
}

.preview-classic {
  margin-bottom: 0;
}

@media (max-width: 599px) {
  .mode-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
