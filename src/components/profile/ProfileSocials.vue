<template>
  <div class="social-links">
    <a
      v-for="link in activeLinks"
      :key="link.key"
      :href="link.recognized ? (link.url ?? undefined) : undefined"
      :role="link.recognized ? undefined : 'button'"
      :tabindex="link.recognized ? undefined : 0"
      :aria-haspopup="link.recognized ? undefined : 'dialog'"
      :aria-label="`${link.platform || 'external link'}: ${link.url}${link.recognized ? '' : ' (opens warning)'}`"
      :target="link.recognized ? '_blank' : undefined"
      rel="noopener noreferrer"
      class="social-link"
      :class="[link.platform || 'custom', `hover-${hoverEffect}`]"
      @click="activate($event, link)"
      @auxclick="activate($event, link)"
      @keydown.enter="activate($event, link)"
      @keydown.space="activate($event, link)"
    >
      <img
        v-if="link.display.kind === 'image'"
        :src="link.display.src"
        alt=""
        class="social-custom-icon"
      />
      <span v-else-if="link.display.kind === 'emoji'" class="social-emoji" aria-hidden="true">{{
        link.display.text
      }}</span>
      <svg
        v-else-if="link.platform === 'roblox' && !link.iconOverride"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          d="M5.164 0L.16 18.928l18.78 5.072L24 5.072 5.164 0zM14.8 15.616l-5.872-1.584 1.584-5.872 5.872 1.584-1.584 5.872z"
        />
      </svg>
      <q-icon v-else :name="link.display.icon" aria-hidden="true" />
    </a>
    <q-dialog
      v-model="showWarning"
      :aria-labelledby="titleId"
      :aria-describedby="descriptionId"
      @hide="pendingUrl = ''"
    >
      <q-card dark style="width: 440px; max-width: 92vw">
        <q-card-section>
          <h2 :id="titleId" class="text-h6">unrecognized external link</h2>
          <p :id="descriptionId">
            this domain is not on our recognized social domains list. it may be unsafe. only
            continue if you trust the destination.
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { socialIconDisplay, socialLinkEntries } from 'src/utils/socialLinks';
import { useExternalLinkWarning } from 'src/composables/useExternalLinkWarning';
import { useApprovedDomainsStore } from 'src/stores/approvedDomains';

// Classic rows recognise approved domains too: without this the `custom` slot would warn
// about a domain an admin already verified.
const approvedDomains = useApprovedDomainsStore();
onMounted(() => {
  void approvedDomains.ensureLoaded();
});

const props = defineProps<{
  socialLinks: Record<string, string>;
  /** Per-platform custom icons for this row (uploaded image, glyph or emoji). */
  socialIcons?: Record<
    string,
    { kind: 'platform' | 'icon' | 'emoji' | 'image'; value: string }
  > | null;
  hoverEffect: string;
}>();
const activeLinks = computed(() =>
  socialLinkEntries(props.socialLinks, props.socialIcons)
    .filter((link) => link.url)
    .map((link) => ({ ...link, display: socialIconDisplay(link.iconOverride, link.icon) })),
);

// Shared with the v2 link list: one implementation of the unrecognised-link warning.
const {
  showWarning,
  pendingUrl,
  titleId,
  descriptionId,
  activate: warnOnUnrecognized,
} = useExternalLinkWarning();

function activate(event: Event, link: ReturnType<typeof socialLinkEntries>[number]) {
  warnOnUnrecognized(event, link.url, link.recognized);
}
</script>

<style scoped>
.social-link[role='button'] {
  cursor: pointer;
}
.social-link:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 4px;
}
.social-custom-icon {
  display: block;
  width: 1em;
  height: 1em;
  object-fit: contain;
  border-radius: 2px;
}
.social-emoji {
  line-height: 1;
}
.warning-destination {
  overflow-wrap: anywhere;
}
</style>
