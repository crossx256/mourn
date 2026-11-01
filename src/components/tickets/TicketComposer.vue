<template>
  <div class="ticket-composer" :class="{ 'ticket-composer--embedded': embedded }">
    <!-- Result / confirmation -->
    <section v-if="submittedTicket" class="ticket-submitted" role="status">
      <q-icon name="mdi-check-circle-outline" size="40px" class="ticket-submitted-icon" />
      <h3 class="ticket-submitted-title">ticket submitted</h3>
      <p class="ticket-submitted-text">
        your {{ submittedTicket.type }} ticket has been submitted. reference
        <span class="ticket-mono">#{{ submittedTicket.reference }}</span>
      </p>
      <p class="ticket-submitted-note">
        you'll get an in-app notification when it's resolved, plus an email if one is on file.
      </p>
      <div class="ticket-submitted-actions">
        <q-btn
          unelevated
          dense
          label="view my tickets"
          icon="mdi-ticket-account"
          class="ticket-primary-btn"
          @click="emit('viewMine')"
        />
        <q-btn flat dense label="submit another" class="ticket-secondary-btn" @click="reset" />
        <q-btn
          v-if="!embedded"
          flat
          dense
          label="close"
          class="ticket-secondary-btn"
          @click="emit('cancel')"
        />
      </div>
    </section>

    <template v-else>
      <!-- 1. ticket type -->
      <section class="ticket-step">
        <h3 class="ticket-step-title">1 · what do you need?</h3>
        <div class="ticket-type-cards">
          <button
            v-for="option in typeCards"
            :key="option.value"
            type="button"
            class="ticket-type-card"
            :class="{ 'ticket-type-card--on': type === option.value }"
            @click="setType(option.value)"
          >
            <q-icon :name="option.icon" size="22px" />
            <span class="ticket-type-card-label">{{ option.label }}</span>
            <span class="ticket-type-card-hint">{{ option.hint }}</span>
          </button>
        </div>
      </section>

      <!-- 2. report target -->
      <section v-if="type === 'report'" class="ticket-step">
        <h3 class="ticket-step-title">2 · what are you reporting?</h3>

        <!-- Scope notice: reports are policy enforcement, not personal
             mediation. Keeps expectations honest before the reporter fills the
             form in. -->
        <div class="ticket-scope-notice" role="note">
          <q-icon name="mdi-information-outline" size="15px" />
          <span>
            reports are reviewed against the community guidelines. content that you find personally
            offensive or disagreeable is not, by itself, a violation, and we may be unable to act on
            it — we can only take action on content that breaches policy.
          </span>
        </div>

        <div v-if="lockedTarget" class="ticket-locked-target">
          <q-icon name="mdi-crosshairs-gps" size="16px" />
          <span>{{ lockedTargetLabel }}</span>
          <q-btn flat dense label="change" class="ticket-secondary-btn" @click="clearTarget" />
        </div>

        <!-- A message that was reported from a chat arrives pre-set, seeded with
             that message's text. The reporter can still widen the report to
             other messages in the same conversation via the thread picker. -->
        <div v-if="lockedTarget && targetKind === 'message'" class="ticket-target-body">
          <div class="ticket-message-tools">
            <q-btn
              dense
              unelevated
              icon="mdi-format-list-checks"
              label="select messages"
              class="ticket-secondary-btn"
              @click="openThreadPicker"
            />
            <span class="ticket-hint">
              {{
                selectedMessageCount > 0
                  ? `${selectedMessageCount} message(s) selected`
                  : 'add or remove messages from this conversation'
              }}
            </span>
          </div>

          <label class="ticket-field-label" for="ticket-message-text-locked">
            message content (editable)
          </label>
          <textarea
            id="ticket-message-text-locked"
            v-model="messageContent"
            class="ticket-native-textarea"
            rows="5"
            maxlength="8000"
            placeholder="the message text the reviewer will read"
          />
        </div>

        <template v-if="!lockedTarget">
          <div class="ticket-target-cards">
            <button
              v-for="option in targetCards"
              :key="option.value"
              type="button"
              class="ticket-target-card"
              :class="{ 'ticket-target-card--on': targetKind === option.value }"
              @click="setTargetKind(option.value)"
            >
              <q-icon :name="option.icon" size="18px" />
              <span>{{ option.label }}</span>
            </button>
          </div>

          <!-- messages -->
          <div v-if="targetKind === 'message'" class="ticket-target-body">
            <label class="ticket-field-label" for="ticket-chat">conversation</label>
            <select id="ticket-chat" v-model="selectedLinkId" class="ticket-native-select">
              <option value="">select a conversation…</option>
              <option v-for="chain in chatChains" :key="chain.id" :value="chain.id">
                {{ chatLabel(chain) }}
              </option>
            </select>

            <div v-if="selectedLinkId" class="ticket-message-tools">
              <q-btn
                dense
                unelevated
                icon="mdi-format-list-checks"
                label="select messages"
                class="ticket-secondary-btn"
                @click="openThreadPicker"
              />
              <span class="ticket-hint">
                {{
                  selectedMessageCount > 0
                    ? `${selectedMessageCount} message(s) selected`
                    : 'pick which messages the reviewer sees'
                }}
              </span>
            </div>

            <label class="ticket-field-label" for="ticket-message-text">
              message content (editable)
            </label>
            <textarea
              id="ticket-message-text"
              v-model="messageContent"
              class="ticket-native-textarea"
              rows="5"
              maxlength="8000"
              placeholder="paste the message text, or select messages above"
            />
          </div>

          <!-- suites -->
          <div v-else-if="targetKind === 'suite'" class="ticket-target-body">
            <label class="ticket-field-label" for="ticket-suite">suite</label>
            <input
              id="ticket-suite"
              v-model="suiteQuery"
              class="ticket-native-input"
              type="text"
              placeholder="search your suites…"
              maxlength="80"
            />
            <div v-if="suiteMatches.length" class="ticket-result-list">
              <button
                v-for="suite in suiteMatches"
                :key="suite.id"
                type="button"
                class="ticket-result"
                :class="{ 'ticket-result--on': targetRef === suite.id }"
                @click="chooseSuite(suite.id, suite.name)"
              >
                {{ suite.name }}
              </button>
            </div>
            <p v-else-if="suiteQuery.length >= 2" class="ticket-hint">no suites match.</p>
          </div>

          <!-- graveyard letters -->
          <div v-else-if="targetKind === 'letter'" class="ticket-target-body">
            <label class="ticket-field-label" for="ticket-letter">graveyard letter</label>
            <input
              id="ticket-letter"
              v-model="letterQuery"
              class="ticket-native-input"
              type="text"
              placeholder="search serial id or alias…"
              maxlength="60"
            />
            <div v-if="letterMatches.length" class="ticket-result-list">
              <button
                v-for="letter in letterMatches"
                :key="letter.id"
                type="button"
                class="ticket-result"
                :class="{ 'ticket-result--on': targetRef === letter.id }"
                @click="chooseLetter(letter)"
              >
                #{{ padSerial(letter.serialId) }} · {{ letter.alias || 'anonymous' }}
              </button>
            </div>
            <p v-else-if="letterQuery.length >= 2" class="ticket-hint">no letters match.</p>
            <p class="ticket-hint">only approved letters can be reported.</p>
          </div>

          <!-- profiles -->
          <div v-else-if="targetKind === 'profile'" class="ticket-target-body">
            <label class="ticket-field-label" for="ticket-profile">username</label>
            <input
              id="ticket-profile"
              v-model="userQuery"
              class="ticket-native-input"
              type="text"
              placeholder="search a username…"
              maxlength="30"
              @input="onUserQuery"
            />
            <div v-if="userResults.length" class="ticket-result-list">
              <button
                v-for="user in userResults"
                :key="user.id"
                type="button"
                class="ticket-result"
                :class="{ 'ticket-result--on': targetRef === user.id }"
                @click="chooseUser(user)"
              >
                @{{ user.username }}
              </button>
            </div>
            <p v-else-if="userQuery.length >= 2 && !userSearching" class="ticket-hint">
              no profiles match.
            </p>
          </div>
        </template>
      </section>

      <!-- 3. category -->
      <section class="ticket-step">
        <h3 class="ticket-step-title">{{ type === 'report' ? '3' : '2' }} · category</h3>
        <div class="ticket-categories">
          <button
            v-for="category in availableCategories"
            :key="category"
            type="button"
            class="ticket-category"
            :class="{ 'ticket-category--on': selectedCategory === category }"
            @click="selectedCategory = category"
          >
            {{ category.replace(/_/g, ' ') }}
          </button>
        </div>
        <div v-if="selectedCategory === 'other'" class="ticket-other">
          <label class="ticket-field-label" for="ticket-custom-category">
            what category best describes this?
          </label>
          <input
            id="ticket-custom-category"
            v-model="customCategory"
            class="ticket-native-input"
            type="text"
            maxlength="80"
            placeholder="required"
          />
        </div>
      </section>

      <!-- 4. description -->
      <section class="ticket-step">
        <h3 class="ticket-step-title">{{ type === 'report' ? '4' : '3' }} · description</h3>
        <textarea
          v-model="description"
          class="ticket-native-textarea"
          rows="5"
          :maxlength="TICKET_DESCRIPTION_MAX"
          placeholder="what happened? include any context the reviewer needs."
        />
        <div class="ticket-counter" :class="{ 'ticket-counter--bad': descriptionTooShort }">
          {{ description.trim().length }} / {{ TICKET_DESCRIPTION_MAX }} (minimum
          {{ TICKET_DESCRIPTION_MIN }})
        </div>
      </section>

      <!-- 5. screenshots -->
      <section class="ticket-step">
        <h3 class="ticket-step-title">{{ type === 'report' ? '5' : '4' }} · screenshots</h3>

        <div class="ticket-upload-row">
          <label class="ticket-file-btn">
            <q-icon name="mdi-image-plus-outline" size="16px" />
            <span>choose images</span>
            <input
              class="ticket-file-input"
              type="file"
              accept="image/*"
              :multiple="true"
              @change="onFilesPicked($event, false)"
            />
          </label>
          <!-- Mobile: allow camera capture for screenshots (§9c). -->
          <label class="ticket-file-btn ticket-file-btn--capture">
            <q-icon name="mdi-camera-outline" size="16px" />
            <span>take photo</span>
            <input
              class="ticket-file-input"
              type="file"
              accept="image/*"
              capture="environment"
              @change="onFilesPicked($event, true)"
            />
          </label>
          <span class="ticket-hint"> up to {{ MAX_TICKET_ATTACHMENTS }} images, 5MB each </span>
        </div>

        <div v-if="pendingFiles.length" class="ticket-previews">
          <div
            v-for="(entry, index) in pendingFiles"
            :key="`${entry.file.name}-${index}`"
            class="ticket-preview"
          >
            <img :src="entry.preview" :alt="entry.file.name" />
            <button
              type="button"
              class="ticket-preview-remove"
              :aria-label="`remove ${entry.file.name}`"
              @click="removeFile(index)"
            >
              <q-icon name="mdi-close" size="14px" />
            </button>
          </div>
        </div>
      </section>

      <div v-if="formError" class="ticket-error" role="alert">
        <q-icon name="mdi-alert-outline" size="16px" />
        <span>{{ formError }}</span>
      </div>

      <div class="ticket-submit-row">
        <q-btn
          unelevated
          dense
          icon="mdi-send"
          label="submit ticket"
          class="ticket-primary-btn"
          :loading="store.submitting"
          :disable="!canSubmit"
          @click="submit"
        />
        <span v-if="!embedded" class="ticket-hint">
          <q-btn flat dense label="cancel" class="ticket-secondary-btn" @click="emit('cancel')" />
        </span>
      </div>
    </template>

    <!-- Thread message selection popup (§7) -->
    <TicketThreadPicker
      v-model="threadPickerOpen"
      :messages="threadPickerMessages"
      @confirm="applyThreadSelection"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { Notify } from 'quasar';
import TicketThreadPicker, {
  type ThreadPickerMessage,
} from 'src/components/tickets/TicketThreadPicker.vue';
import { useTicketsStore } from 'src/stores/tickets';
import { useLinksStore } from 'src/stores/links';
import { useVaultStore } from 'src/stores/vault';
import { useGroupStore } from 'src/stores/groupStore';
import { useGraveyardStore } from 'src/stores/graveyard';
import { useAuthStore } from 'src/stores/auth';
import type { Link } from 'src/types/links';
import {
  MAX_TICKET_ATTACHMENTS,
  PROFILE_REPORT_CATEGORIES,
  REPORT_CATEGORIES,
  SUPPORT_CATEGORIES,
  TICKET_DESCRIPTION_MAX,
  TICKET_DESCRIPTION_MIN,
  type Ticket,
  type TicketTargetPrefill,
  type TicketTargetType,
  type TicketType,
} from 'src/types/ticket';

const props = withDefaults(
  defineProps<{
    prefill?: TicketTargetPrefill | null;
    /** Embedded in a page (no dialog chrome) vs shown inside a modal. */
    embedded?: boolean;
    /** Deep-link (`/tickets?type=report`) preselect of the ticket type. */
    initialType?: TicketType | null;
  }>(),
  { prefill: null, embedded: false, initialType: null },
);

const emit = defineEmits<{
  (event: 'submitted', ticket: Ticket): void;
  (event: 'cancel'): void;
  (event: 'viewMine'): void;
}>();

const store = useTicketsStore();
const linksStore = useLinksStore();
const vaultStore = useVaultStore();
const groupStore = useGroupStore();
const graveyardStore = useGraveyardStore();
const authStore = useAuthStore();

const type = ref<TicketType>('support');
const targetKind = ref<TicketTargetType | null>(null);
const targetRef = ref('');
const targetLabel = ref('');
const messageContent = ref('');
const selectedLinkId = ref('');
const selectedMessageIds = ref<string[]>([]);
/** Conversation whose messages `messageContent` quotes; '' when nothing is captured. */
const capturedLinkId = ref('');
const suiteQuery = ref('');
const letterQuery = ref('');
const userQuery = ref('');
const userResults = ref<Array<{ id: string; username: string }>>([]);
const userSearching = ref(false);
const selectedCategory = ref('');
const customCategory = ref('');
const description = ref('');
const pendingFiles = ref<Array<{ file: File; preview: string }>>([]);
const formError = ref('');
const submittedTicket = ref<Ticket | null>(null);
const threadPickerOpen = ref(false);
const lockedTarget = ref<TicketTargetPrefill | null>(null);

const typeCards = [
  {
    value: 'support' as TicketType,
    label: 'support',
    hint: 'account issues, bugs, questions, feature requests',
    icon: 'mdi-lifebuoy',
  },
  {
    value: 'report' as TicketType,
    label: 'report',
    hint: 'someone or something violates policy',
    icon: 'mdi-alert-octagon-outline',
  },
];

const targetCards: Array<{ value: TicketTargetType; label: string; icon: string }> = [
  { value: 'message', label: 'messages', icon: 'mdi-message-text-outline' },
  { value: 'suite', label: 'suite', icon: 'mdi-account-group-outline' },
  { value: 'letter', label: 'graveyard star', icon: 'mdi-star-four-points-outline' },
  { value: 'profile', label: 'user profile', icon: 'mdi-account-outline' },
];

const chatChains = computed<Link[]>(() => linksStore.chatChains);

const availableCategories = computed<string[]>(() => {
  if (type.value === 'support') return [...SUPPORT_CATEGORIES];
  // §4d — a profile report offers its own sub-categories.
  if (targetKind.value === 'profile' || lockedTarget.value?.categoryScope === 'profile') {
    return [...PROFILE_REPORT_CATEGORIES];
  }
  return [...REPORT_CATEGORIES];
});

const descriptionTooShort = computed(
  () =>
    description.value.trim().length > 0 && description.value.trim().length < TICKET_DESCRIPTION_MIN,
);

const canSubmit = computed(() => {
  if (description.value.trim().length < TICKET_DESCRIPTION_MIN) return false;
  if (!selectedCategory.value) return false;
  if (selectedCategory.value === 'other' && !customCategory.value.trim()) return false;
  if (type.value === 'report') {
    if (!targetKind.value || !targetRef.value) return false;
    // A message report needs something for the reviewer to actually read.
    if (targetKind.value === 'message' && !messageContent.value.trim()) return false;
  }
  return true;
});

const suiteMatches = computed(() => {
  const query = suiteQuery.value.trim().toLowerCase();
  const suites = groupStore.groupsList.map((group) => ({ id: group.id, name: group.name }));
  if (query.length < 2) return suites.slice(0, 8);
  return suites.filter((suite) => suite.name.toLowerCase().includes(query)).slice(0, 12);
});

const letterMatches = computed(() => {
  const query = letterQuery.value.trim().toLowerCase();
  if (query.length < 2) return [];
  const asNumber = /^\d+$/.test(query) ? Number(query) : null;
  return graveyardStore.approvedLetters
    .filter((letter) => {
      const alias = (letter.alias || '').toLowerCase();
      if (alias.includes(query)) return true;
      return asNumber !== null && letter.serialId === asNumber;
    })
    .slice(0, 12);
});

/** Messages of the chosen chat, from the reporter's own decrypted vault. */
const threadMessages = computed(() => {
  const linkId = selectedLinkId.value;
  if (!linkId) return [];
  return vaultStore.messages[linkId] ?? [];
});

const threadPickerMessages = computed<ThreadPickerMessage[]>(() =>
  threadMessages.value.map((message) => ({
    id: message.id,
    plaintext: message.plaintext,
    timestamp: message.timestamp,
    senderLabel:
      message.senderId === authStore.user?.id ? 'you' : chatCounterpartyLabel(selectedLinkId.value),
  })),
);

const selectedMessageCount = computed(() => selectedMessageIds.value.length);

/** Human label for a pre-set target handed in by an entry point. */
const lockedTargetLabel = computed(() => {
  const locked = lockedTarget.value;
  if (!locked) return '';
  if (locked.label) return locked.label;
  const kindLabel: Record<TicketTargetType, string> = {
    message: 'message',
    suite: 'suite',
    letter: 'graveyard letter',
    profile: 'profile',
  };
  return kindLabel[locked.targetType] ?? locked.targetType;
});

function setType(next: TicketType) {
  type.value = next;
  selectedCategory.value = '';
  customCategory.value = '';
  if (next === 'support') clearTarget();
}

function setTargetKind(kind: TicketTargetType) {
  targetKind.value = kind;
  targetRef.value = '';
  targetLabel.value = '';
  messageContent.value = '';
  selectedCategory.value = '';
  customCategory.value = '';
}

function clearTarget() {
  targetKind.value = null;
  targetRef.value = '';
  targetLabel.value = '';
  messageContent.value = '';
  selectedLinkId.value = '';
  selectedMessageIds.value = [];
  capturedLinkId.value = '';
  lockedTarget.value = null;
}

function chatCounterparty(linkId: string): string {
  const link = linksStore.links.find((candidate) => candidate.id === linkId);
  if (!link) return 'unknown';
  const myId = authStore.user?.id;
  const other = link.senderId === myId ? link.receiver : link.sender;
  return other?.username ? `@${other.username}` : 'unknown';
}

function chatCounterpartyLabel(linkId: string): string {
  return chatCounterparty(linkId);
}

function chatLabel(link: Link): string {
  return chatCounterparty(link.id);
}

function openThreadPicker() {
  if (threadMessages.value.length === 0) {
    formError.value =
      'no loaded messages in this conversation — open the chat first, or paste the text below.';
    return;
  }
  formError.value = '';
  threadPickerOpen.value = true;
}

/**
 * §7 — only the CHECKED messages' text is captured, delimited so the reviewer
 * can tell them apart (timestamp + sender per block). The capture belongs to the
 * conversation it was taken from; `watch(selectedLinkId)` below discards it when
 * the reporter switches chats, so a report never quotes another conversation.
 */
function applyThreadSelection(ids: string[]) {
  targetRef.value = selectedLinkId.value;
  capturedLinkId.value = selectedLinkId.value;
  selectedMessageIds.value = ids;
  const blocks = threadMessages.value
    .filter((message) => ids.includes(message.id))
    .map((message) => {
      const sender =
        message.senderId === authStore.user?.id
          ? 'reporter'
          : chatCounterparty(selectedLinkId.value);
      const when = new Date(message.timestamp).toLocaleString();
      return `--- ${sender} · ${when} ---\n${message.plaintext}`;
    });
  messageContent.value = blocks.join('\n\n');
}

function chooseSuite(id: string, name: string) {
  targetRef.value = id;
  targetLabel.value = `Suite "${name}"`;
}

function chooseLetter(letter: { id: string; serialId: number | null; alias?: string | null }) {
  targetRef.value = letter.id;
  targetLabel.value = `Letter #${padSerial(letter.serialId)}${
    letter.alias ? ` (${letter.alias})` : ''
  }`;
}

function chooseUser(user: { id: string; username: string }) {
  targetRef.value = user.id;
  targetLabel.value = `Profile @${user.username}`;
}

function padSerial(id: number | null): string {
  if (id == null) return '0000';
  return String(id).padStart(4, '0');
}

let userSearchToken = 0;
async function onUserQuery() {
  const token = ++userSearchToken;
  const query = userQuery.value.trim();
  if (query.length < 2) {
    userSearching.value = false;
    userResults.value = [];
    return;
  }
  userSearching.value = true;
  try {
    const results = await store.searchUsers(query);
    // Ignore a stale response if the user kept typing.
    if (token === userSearchToken) userResults.value = results;
  } catch {
    if (token === userSearchToken) userResults.value = [];
  } finally {
    if (token === userSearchToken) userSearching.value = false;
  }
}

function onFilesPicked(event: Event, fromCamera: boolean) {
  formError.value = '';
  const input = event.target as HTMLInputElement;
  const incoming = Array.from(input.files ?? []);
  // Reset so picking the same file twice still fires a change event.
  input.value = '';

  const accepted: Array<{ file: File; preview: string }> = [];
  for (const file of incoming) {
    if (!file.type.startsWith('image/')) {
      formError.value = 'only image screenshots can be attached.';
      continue;
    }
    if (file.size > 5 * 1024 * 1024) {
      formError.value = `${file.name} is larger than 5MB.`;
      continue;
    }
    if (pendingFiles.value.length + accepted.length >= MAX_TICKET_ATTACHMENTS) {
      formError.value = 'The screenshot limit has been reached.';
      continue;
    }
    accepted.push({ file, preview: URL.createObjectURL(file) });
  }

  const combined = [...pendingFiles.value, ...accepted];
  if (combined.length > MAX_TICKET_ATTACHMENTS) {
    formError.value = `a maximum of ${MAX_TICKET_ATTACHMENTS} screenshots is allowed.`;
    pendingFiles.value = combined.slice(0, MAX_TICKET_ATTACHMENTS);
  } else {
    pendingFiles.value = combined;
  }

  if (fromCamera && accepted.length > 0) {
    Notify.create({ type: 'info', message: 'screenshot captured', position: 'bottom' });
  }
}

function removeFile(index: number) {
  const [removed] = pendingFiles.value.splice(index, 1);
  if (removed) URL.revokeObjectURL(removed.preview);
}

async function submit() {
  formError.value = '';

  if (!canSubmit.value) {
    formError.value = 'fill in the required fields before submitting.';
    return;
  }

  const generation = authStore.authOperationGeneration;
  const submission = { type: type.value, category: selectedCategory.value, customCategory: customCategory.value.trim(), description: description.value.trim() };
  const files = pendingFiles.value.map((entry) => entry.file);
  const effectiveTargetType = lockedTarget.value?.targetType ?? targetKind.value;
  const effectiveTargetRef = effectiveTargetType === 'message' ? selectedLinkId.value : (lockedTarget.value?.targetRef ?? targetRef.value);
  // Defence in depth for the capture rule above: a quoted thread is only attached
  // when it came from the conversation this report names.
  const captureMatchesTarget =
    !capturedLinkId.value || capturedLinkId.value === effectiveTargetRef;
  if (effectiveTargetType === 'message' && !captureMatchesTarget) {
    formError.value = 'the selected messages belong to another conversation — pick them again.';
    return;
  }
  const effectiveMessageContent = messageContent.value;
  try {
    const attachments = files.length ? await store.uploadAttachments(files) : [];
    if (generation !== authStore.authOperationGeneration) return;

    const ticket = await store.submitTicket({
      type: submission.type,
      category: submission.category,
      ...(submission.category === 'other' ? { customCategory: submission.customCategory } : {}),
      description: submission.description,
      ...(submission.type === 'report' && effectiveTargetType
        ? { targetType: effectiveTargetType, targetRef: effectiveTargetRef }
        : {}),
      ...(effectiveMessageContent && effectiveTargetType === 'message'
        ? { messageContent: effectiveMessageContent }
        : {}),
      ...(attachments.length ? { attachments } : {}),
    });

    if (generation !== authStore.authOperationGeneration) return;
    submittedTicket.value = ticket;
    emit('submitted', ticket);
  } catch (error) {
    formError.value = (error as Error)?.message || 'ticket submission failed';
  }
}

function reset() {
  submittedTicket.value = null;
  type.value = 'support';
  clearTarget();
  selectedCategory.value = '';
  customCategory.value = '';
  description.value = '';
  suiteQuery.value = '';
  letterQuery.value = '';
  userQuery.value = '';
  userResults.value = [];
  pendingFiles.value.forEach((entry) => URL.revokeObjectURL(entry.preview));
  pendingFiles.value = [];
  formError.value = '';
}

onBeforeUnmount(() => {
  pendingFiles.value.forEach((entry) => URL.revokeObjectURL(entry.preview));
  pendingFiles.value = [];
});

// A thread capture belongs to one conversation. Switching the target chat must
// discard it: otherwise the ticket would name the new chat while quoting the old
// one's private messages. Re-selecting the same id is a no-op.
watch(selectedLinkId, (next) => {
  if (capturedLinkId.value && capturedLinkId.value !== next) {
    messageContent.value = '';
    selectedMessageIds.value = [];
  }
});

// Deep links can preselect the ticket type (the nav's "report something" opens
// /tickets?type=report). Declared BEFORE the prefill watcher so a pre-set
// target — which always means a report — wins over the query param.
watch(
  () => props.initialType,
  (next) => {
    if (next !== 'report' && next !== 'support') return;
    if (props.prefill) return;
    setType(next);
  },
  { immediate: true },
);

// Entry points hand in a pre-set target; lock it so the user can see (and
// change) exactly what is being reported.
watch(
  () => props.prefill,
  (prefill) => {
    if (!prefill) { clearTarget(); messageContent.value = ''; return; }
    lockedTarget.value = prefill;
    type.value = 'report';
    targetKind.value = prefill.targetType;
    targetRef.value = prefill.targetRef;
    targetLabel.value = prefill.label ?? '';
    if (prefill.messageContent) {
      messageContent.value = prefill.messageContent;
      // The seeded text quotes the reported conversation itself.
      capturedLinkId.value = prefill.targetType === 'message' ? prefill.targetRef : '';
    }
    // A message report's targetRef IS the conversation id, so point the thread
    // picker at it — that lets the reporter widen the report beyond the single
    // message the entry point seeded.
    if (prefill.targetType === 'message') selectedLinkId.value = prefill.targetRef;
    selectedCategory.value = '';
    customCategory.value = '';
  },
  { immediate: true },
);
</script>

<style scoped>
.ticket-composer {
  font-family: 'Courier New', monospace;
  color: var(--dash-text, rgb(var(--m-text-rgb)));
}

.ticket-composer--embedded {
  width: 100%;
}

.ticket-step {
  margin-bottom: 1.5rem;
}

.ticket-step-title {
  margin: 0 0 0.65rem;
  color: var(--dash-muted, rgb(var(--m-textMuted-rgb)));
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: lowercase;
}

.ticket-type-cards,
.ticket-target-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.ticket-type-card {
  display: flex;
  min-width: 220px;
  flex: 1;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.85rem;
  border: 1px solid var(--dash-border, rgb(var(--m-border-rgb)));
  border-radius: 0;
  background: var(--dash-card, rgb(var(--m-card-rgb)));
  color: var(--dash-text, rgb(var(--m-text-rgb)));
  font-family: 'Courier New', monospace;
  text-align: left;
  cursor: pointer;
}

.ticket-type-card--on {
  border-color: var(--primary, rgb(var(--m-accent-rgb)));
  background: rgb(var(--m-accent-rgb) / 0.08);
}

.ticket-type-card-label {
  font-size: 0.82rem;
  font-weight: 600;
}

.ticket-type-card-hint {
  color: var(--dash-muted, rgb(var(--m-textMuted-rgb)));
  font-size: 0.68rem;
  line-height: 1.5;
}

.ticket-target-card {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--dash-border, rgb(var(--m-border-rgb)));
  border-radius: 0;
  background: var(--dash-card, rgb(var(--m-card-rgb)));
  color: var(--dash-text, rgb(var(--m-text-rgb)));
  font-family: 'Courier New', monospace;
  font-size: 0.72rem;
  cursor: pointer;
}

.ticket-target-card--on {
  border-color: var(--primary, rgb(var(--m-accent-rgb)));
  color: var(--primary, rgb(var(--m-accent-rgb)));
}

.ticket-target-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.ticket-locked-target {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--primary, rgb(var(--m-accent-rgb)));
  border-radius: 0;
  background: rgb(var(--m-accent-rgb) / 0.08);
  font-size: 0.74rem;
}

.ticket-scope-notice {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin-bottom: 0.9rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--dash-border, rgb(var(--m-border-rgb)));
  border-left: 2px solid var(--dash-muted, rgb(var(--m-textMuted-rgb)));
  border-radius: 0;
  background: var(--dash-card, rgb(var(--m-card-rgb)));
  color: var(--dash-muted, rgb(var(--m-textMuted-rgb)));
  font-size: 0.7rem;
  line-height: 1.6;
}

.ticket-scope-notice .q-icon {
  margin-top: 0.15rem;
  flex-shrink: 0;
}

.ticket-field-label {
  color: var(--dash-muted, rgb(var(--m-textMuted-rgb)));
  font-size: 0.68rem;
  text-transform: lowercase;
}

.ticket-native-input,
.ticket-native-textarea,
.ticket-native-select {
  width: 100%;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--dash-border, rgb(var(--m-border-rgb)));
  border-radius: 0;
  background: var(--dash-bg, #000000);
  color: var(--dash-text, rgb(var(--m-text-rgb)));
  font-family: 'Courier New', monospace;
  font-size: 0.75rem;
}

/* Native select: the OS widget ignores the dark palette unless the appearance
   is reset, so the collapsed control (and its popup list) rendered white.
   Mirrors the app-wide `.mourn-select` pattern: no native chrome, hairline
   border, custom chevron, and explicitly dark options. */
.ticket-native-select {
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  padding-right: 2rem;
  cursor: pointer;
  outline: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23555' stroke-width='1.5'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.7rem center;
}

.ticket-native-select:hover,
.ticket-native-select:focus {
  border-color: var(--primary, rgb(var(--m-accent-rgb)));
}

.ticket-native-select option {
  background: var(--dash-bg, #000000);
  color: var(--dash-text, rgb(var(--m-text-rgb)));
}

.ticket-native-select option:checked {
  background: var(--dash-card, rgb(var(--m-card-rgb)));
  color: var(--dash-text, rgb(var(--m-text-rgb)));
}

.ticket-native-textarea {
  resize: vertical;
  line-height: 1.6;
}

.ticket-result-list {
  display: flex;
  max-height: 190px;
  flex-direction: column;
  overflow-y: auto;
  border: 1px solid var(--dash-border, rgb(var(--m-border-rgb)));
  border-radius: 0;
  background: var(--dash-bg, #000000);
}

.ticket-result {
  padding: 0.45rem 0.7rem;
  border: none;
  border-bottom: 1px solid var(--dash-border, rgb(var(--m-border-rgb)));
  background: transparent;
  color: var(--dash-text, rgb(var(--m-text-rgb)));
  font-family: 'Courier New', monospace;
  font-size: 0.72rem;
  text-align: left;
  cursor: pointer;
}

.ticket-result:last-child {
  border-bottom: none;
}

.ticket-result:hover,
.ticket-result--on {
  background: rgb(var(--m-accent-rgb) / 0.1);
  color: var(--primary, rgb(var(--m-accent-rgb)));
}

.ticket-categories {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.ticket-category {
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--dash-border, rgb(var(--m-border-rgb)));
  border-radius: 0;
  background: var(--dash-card, rgb(var(--m-card-rgb)));
  color: var(--dash-muted, rgb(var(--m-textMuted-rgb)));
  font-family: 'Courier New', monospace;
  font-size: 0.68rem;
  cursor: pointer;
}

.ticket-category--on {
  border-color: var(--primary, rgb(var(--m-accent-rgb)));
  background: var(--primary, rgb(var(--m-accent-rgb)));
  color: #ffffff;
}

.ticket-other {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-top: 0.6rem;
}

.ticket-counter {
  margin-top: 0.3rem;
  color: var(--dash-muted, rgb(var(--m-textMuted-rgb)));
  font-size: 0.66rem;
}

.ticket-counter--bad {
  color: var(--primary, rgb(var(--m-accent-rgb)));
}

.ticket-upload-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}

.ticket-file-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--dash-border, rgb(var(--m-border-rgb)));
  border-radius: 0;
  background: var(--dash-card, rgb(var(--m-card-rgb)));
  color: var(--dash-text, rgb(var(--m-text-rgb)));
  font-size: 0.7rem;
  cursor: pointer;
}

.ticket-file-btn:hover {
  border-color: var(--primary, rgb(var(--m-accent-rgb)));
  color: var(--primary, rgb(var(--m-accent-rgb)));
}

.ticket-file-input {
  display: none;
}

.ticket-previews {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.7rem;
}

.ticket-preview {
  position: relative;
  width: 96px;
  height: 96px;
  border: 1px solid var(--dash-border, rgb(var(--m-border-rgb)));
  border-radius: 0;
  overflow: hidden;
}

.ticket-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ticket-preview-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 1px solid var(--dash-border, rgb(var(--m-border-rgb)));
  border-radius: 0;
  background: rgba(0, 0, 0, 0.75);
  color: var(--primary, rgb(var(--m-accent-rgb)));
  cursor: pointer;
}

.ticket-hint {
  color: var(--dash-muted, rgb(var(--m-textMuted-rgb)));
  font-size: 0.68rem;
}

.ticket-message-tools {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.ticket-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--primary, rgb(var(--m-accent-rgb)));
  border-radius: 0;
  background: rgba(255, 0, 0, 0.12);
  color: var(--primary, rgb(var(--m-accent-rgb)));
  font-size: 0.72rem;
}

.ticket-submit-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.ticket-primary-btn,
.ticket-secondary-btn {
  border-radius: 0 !important;
  font-family: 'Courier New', monospace;
  font-size: 0.72rem;
  text-transform: lowercase;
}

.ticket-primary-btn {
  border: 1px solid var(--primary, rgb(var(--m-accent-rgb))) !important;
  background: var(--primary, rgb(var(--m-accent-rgb))) !important;
  color: #ffffff !important;
}

.ticket-secondary-btn {
  border: 1px solid var(--dash-border, rgb(var(--m-border-rgb))) !important;
  background: var(--dash-card, rgb(var(--m-card-rgb))) !important;
  color: var(--dash-text, rgb(var(--m-text-rgb))) !important;
}

.ticket-secondary-btn:hover {
  border-color: var(--primary, rgb(var(--m-accent-rgb))) !important;
  color: var(--primary, rgb(var(--m-accent-rgb))) !important;
}

.ticket-mono {
  color: var(--primary, rgb(var(--m-accent-rgb)));
}

.ticket-submitted {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem 1rem;
  text-align: center;
}

.ticket-submitted-icon {
  color: var(--dash-success, #00ff00);
}

.ticket-submitted-title {
  margin: 0;
  font-size: 0.95rem;
  text-transform: lowercase;
}

.ticket-submitted-text {
  margin: 0;
  font-size: 0.78rem;
}

.ticket-submitted-note {
  margin: 0;
  color: var(--dash-muted, rgb(var(--m-textMuted-rgb)));
  font-size: 0.7rem;
}

.ticket-submitted-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
</style>
