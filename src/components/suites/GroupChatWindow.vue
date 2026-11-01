<template>
  <div
    class="group-chat-window"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div v-if="!groupStore.activeGroup" class="group-chat-empty">
      <q-icon name="mdi-office-building-outline" size="48px" class="group-chat-empty-icon" />
      <span class="group-chat-empty-label">SELECT A SUITE</span>
      <span class="group-chat-empty-sub">Choose a group from the sidebar</span>
    </div>

    <template v-else>
      <div class="group-chat-header">
        <!-- Mobile only: the chat covers the whole viewport, so the header owns
             the way back to the conversation list (same affordance as the 1:1
             chat header's .vault-back-btn). -->
        <button
          v-if="isMobile"
          class="chat-mobile-back-btn"
          type="button"
          aria-label="Back to conversations"
          @click="emit('close')"
        >
          <q-icon name="mdi-arrow-left" size="16px" />
        </button>
        <div class="group-chat-header-info">
          <q-avatar size="36px" class="group-chat-avatar">
            <img
              v-if="groupStore.activeGroup.avatarUrl"
              :src="groupStore.activeGroup.avatarUrl"
              :alt="groupStore.activeGroup.name"
            />
            <q-icon v-else name="mdi-shape" size="20px" color="grey-6" />
          </q-avatar>
          <div class="group-chat-header-text">
            <span class="group-chat-header-name">{{ groupStore.activeGroup.name }}</span>
            <span class="group-chat-header-meta">
              {{ groupStore.activeGroup.memberCount ?? groupStore.activeGroup.members.length }}
              members · Epoch
              {{ groupStore.activeGroup.epoch }}
            </span>
          </div>
        </div>
        <div class="group-chat-header-actions">
          <q-btn
            v-if="canInvite"
            flat
            round
            dense
            icon="mdi-account-plus"
            size="sm"
            class="btn-secondary suite-header-button"
            @click="$emit('invite')"
          >
            <q-tooltip class="font-mono text-[10px]">Invite</q-tooltip>
          </q-btn>
          <q-btn
            flat
            round
            dense
            icon="mdi-cog-outline"
            size="sm"
            class="btn-secondary suite-header-button"
            @click="$emit('openSettings')"
          >
            <q-tooltip class="font-mono text-[10px]">Suite Settings</q-tooltip>
          </q-btn>
          <q-btn
            flat
            round
            dense
            icon="mdi-exit-to-app"
            size="sm"
            class="btn-danger-outline suite-header-button"
            @click="$emit('leave')"
          >
            <q-tooltip class="font-mono text-[10px]">Leave Suite</q-tooltip>
          </q-btn>
          <q-btn
            v-if="canTogglePanel"
            flat
            round
            dense
            :icon="rightPanelOpen ? 'mdi-dock-right' : 'mdi-dock-right'"
            size="sm"
            class="btn-secondary suite-header-button"
            @click="$emit('toggle-right-panel')"
          >
            <q-tooltip class="font-mono text-[10px]">{{
              rightPanelOpen ? 'Hide Panel' : 'Show Panel'
            }}</q-tooltip>
          </q-btn>
        </div>
      </div>

      <!-- A suite whose MLS state could not be rebuilt renders an empty/undecryptable
           thread. Say so, and give the retry a home instead of leaving a blank page. -->
      <div v-if="groupStore.activeGroupMlsState === 'unavailable'" class="group-mls-warning">
        <q-icon name="mdi-alert-outline" size="14px" />
        <span class="group-mls-warning-text">
          This suite's encryption state could not be restored — messages may not decrypt.
        </span>
        <button type="button" class="group-mls-warning-btn" @click="retryMlsRestore">
          Retry
        </button>
      </div>

      <q-scroll-area ref="messagesScrollRef" class="group-chat-messages">
        <div
          v-if="groupStore.messagesLoading && groupStore.activeGroupMessages.length === 0"
          class="group-chat-loading"
        >
          <q-spinner color="primary" size="24px" />
        </div>
        <div
          v-else-if="groupStore.activeGroupMessages.length === 0"
          class="group-chat-empty-messages"
        >
          <span class="group-chat-empty-messages-text">No messages yet</span>
        </div>
        <div v-else class="group-chat-messages-list">
          <div
            v-for="message in groupStore.activeGroupMessages"
            :key="message.id"
            :data-msg-id="message.id"
            :class="[
              'vault-msg',
              isOwnMessage(message) ? 'vault-msg--sent' : 'vault-msg--recv',
              { 'vault-msg--reply-to-me': isReplyToMe(message) },
            ]"
            @mouseenter="hoveredMessageId = message.id"
            @mouseleave="hoveredMessageId = null"
            @dblclick="groupStore.canSendMessages && startReply(message)"
            @contextmenu.prevent="openContextMenu($event, message)"
          >
            <q-avatar size="40px" class="vault-msg-avatar">
              <img
                v-if="messageAvatar(message)"
                :src="messageAvatar(message)!"
                :alt="messageSenderName(message)"
              />
              <q-icon v-else name="mdi-account" size="18px" color="grey-6" />
            </q-avatar>

            <div class="vault-msg-body">
              <div class="vault-msg-meta">
                <span class="vault-msg-sender">{{ messageSenderName(message) }}</span>
                <span class="vault-msg-time">{{ formatTime(message.createdAt) }}</span>
              </div>

              <MessageReplyReference
                v-if="message.replyTo"
                :reference="message.replyTo"
                @navigate="scrollToMessage"
              />

              <div
                v-if="hasSuiteBubbleContent(message)"
                :class="[
                  'vault-msg-bubble',
                  isOwnMessage(message) ? 'vault-msg-bubble--sent' : 'vault-msg-bubble--recv',
                ]"
              >
                <img
                  v-if="isGifUrl(message.content)"
                  :src="message.content"
                  alt="GIF"
                  class="group-message-gif"
                  loading="lazy"
                />
                <p v-else-if="message.content && message.content.trim()" class="group-message-text">
                  <span
                    v-for="(segment, index) in messageSegments(message.content)"
                    :key="index"
                    :class="{ 'group-message-mention': segment.mention }"
                    >{{ segment.text }}</span
                  >
                </p>
              </div>

              <!-- Encrypted blob attachment (Suite file/image sharing).
                   Mirrors the 1:1 chat exactly: image/video render as ONE media box
                   with no filename/size strip, audio gets an inline player, and any
                   other file is an always-visible row (a hover-revealed row can never
                   be revealed on a touch device). -->
              <div
                v-if="messageAttachment(message)"
                class="vault-blob-attachment"
                @mouseenter="void ensurePreview(messageAttachment(message))"
              >
                <!-- IMAGE — one box, no metadata strip -->
                <div
                  v-if="isBlobImage(messageAttachment(message)!.mimetype)"
                  class="vault-blob-media vault-blob-media--image"
                >
                  <img
                    v-if="blobPreviewUrls[messageAttachment(message)!.blobId]"
                    :src="blobPreviewUrls[messageAttachment(message)!.blobId]"
                    :alt="messageAttachment(message)!.filename"
                    loading="lazy"
                  />
                  <div
                    v-else-if="blobAttachmentErrors[messageAttachment(message)!.blobId]"
                    class="vault-blob-media-loading vault-blob-media-unavailable"
                  >
                    <q-icon name="mdi-image-off-outline" size="26px" />
                    <span class="vault-blob-unavailable-text">No longer available</span>
                  </div>
                  <div v-else class="vault-blob-media-loading">
                    <q-spinner color="primary" size="28px" />
                  </div>
                  <button
                    type="button"
                    class="vault-blob-media-save"
                    :disabled="!!downloadingBlobs[messageAttachment(message)!.blobId]"
                    title="Download"
                    @click.stop="void saveAttachment(messageAttachment(message))"
                  >
                    <q-icon
                      :name="
                        downloadingBlobs[messageAttachment(message)!.blobId]
                          ? 'mdi-loading'
                          : savedBlobSuccess[messageAttachment(message)!.blobId]
                            ? 'mdi-check-circle'
                            : 'mdi-download'
                      "
                      size="16px"
                      :class="{
                        'vault-blob-spinner':
                          !!downloadingBlobs[messageAttachment(message)!.blobId],
                      }"
                    />
                  </button>
                </div>

                <!-- VIDEO — one box, no metadata strip -->
                <div
                  v-else-if="isBlobVideo(messageAttachment(message)!.mimetype)"
                  class="vault-blob-media vault-blob-media--video"
                >
                  <video
                    v-if="blobPreviewUrls[messageAttachment(message)!.blobId]"
                    :src="blobPreviewUrls[messageAttachment(message)!.blobId]"
                    class="vault-video-el"
                    controls
                    preload="metadata"
                  />
                  <div
                    v-else-if="blobAttachmentErrors[messageAttachment(message)!.blobId]"
                    class="vault-blob-media-loading vault-blob-media-unavailable"
                  >
                    <q-icon name="mdi-image-off-outline" size="26px" />
                    <span class="vault-blob-unavailable-text">No longer available</span>
                  </div>
                  <div v-else class="vault-blob-media-loading">
                    <q-spinner color="primary" size="28px" />
                  </div>
                </div>

                <!-- AUDIO — inline player -->
                <div
                  v-else-if="isBlobAudio(messageAttachment(message)!.mimetype)"
                  class="vault-audio-player"
                  @click.stop
                >
                  <button
                    type="button"
                    class="vault-audio-play"
                    :disabled="!blobPreviewUrls[messageAttachment(message)!.blobId]"
                    :aria-label="
                      suiteAudioStates[messageAttachment(message)!.blobId]?.playing
                        ? 'Pause'
                        : 'Play'
                    "
                    @click.stop="toggleSuiteAudio(messageAttachment(message)!.blobId)"
                  >
                    <q-icon
                      v-if="blobAttachmentErrors[messageAttachment(message)!.blobId]"
                      name="mdi-alert-circle-outline"
                      size="18px"
                    />
                    <q-spinner
                      v-else-if="!blobPreviewUrls[messageAttachment(message)!.blobId]"
                      size="18px"
                      color="primary"
                    />
                    <q-icon
                      v-else
                      :name="
                        suiteAudioStates[messageAttachment(message)!.blobId]?.playing
                          ? 'mdi-pause'
                          : 'mdi-play'
                      "
                      size="20px"
                    />
                  </button>
                  <div class="vault-audio-main">
                    <div
                      class="vault-audio-track"
                      @click.stop="seekSuiteAudio(messageAttachment(message)!.blobId, $event)"
                    >
                      <div
                        class="vault-audio-fill"
                        :style="{
                          width:
                            (suiteAudioStates[messageAttachment(message)!.blobId]?.progress ??
                              0) + '%',
                        }"
                      />
                      <div
                        class="vault-audio-knob"
                        :style="{
                          left:
                            (suiteAudioStates[messageAttachment(message)!.blobId]?.progress ??
                              0) + '%',
                        }"
                      />
                    </div>
                    <div class="vault-audio-meta">
                      <span class="vault-audio-name">{{
                        messageAttachment(message)!.filename
                      }}</span>
                      <span
                        v-if="
                          (suiteAudioStates[messageAttachment(message)!.blobId]?.duration ?? 0) > 0
                        "
                        class="vault-audio-time"
                      >
                        {{
                          formatAudioClock(
                            suiteAudioStates[messageAttachment(message)!.blobId]?.currentTime ?? 0,
                          )
                        }}
                        /
                        {{
                          formatAudioClock(
                            suiteAudioStates[messageAttachment(message)!.blobId]?.duration ?? 0,
                          )
                        }}
                      </span>
                      <span v-else class="vault-audio-time vault-audio-time--state">{{
                        blobAttachmentErrors[messageAttachment(message)!.blobId]
                          ? 'No longer available'
                          : 'Loading…'
                      }}</span>
                    </div>
                  </div>
                  <audio
                    :ref="
                      (el) =>
                        registerSuiteAudioRef(
                          messageAttachment(message)?.blobId,
                          el as HTMLAudioElement,
                        )
                    "
                    :src="blobPreviewUrls[messageAttachment(message)!.blobId]"
                    preload="metadata"
                    @loadedmetadata="
                      onSuiteAudioMeta(messageAttachment(message)!.blobId, $event)
                    "
                    @timeupdate="onSuiteAudioTime(messageAttachment(message)!.blobId, $event)"
                    @ended="onSuiteAudioEnded(messageAttachment(message)!.blobId)"
                  />
                </div>

                <!-- ANY OTHER FILE — always-visible row -->
                <div v-else class="vault-blob-file">
                  <q-icon
                    name="mdi-file-document-outline"
                    size="18px"
                    class="vault-blob-file-icon"
                  />
                  <div class="vault-blob-file-info">
                    <span class="vault-blob-filename">{{
                      messageAttachment(message)!.filename
                    }}</span>
                    <span class="vault-blob-size">{{
                      formatBlobSize(messageAttachment(message)!.size)
                    }}</span>
                  </div>
                  <button
                    type="button"
                    class="vault-blob-download-btn"
                    :disabled="!!downloadingBlobs[messageAttachment(message)!.blobId]"
                    title="Download"
                    @click.stop="void saveAttachment(messageAttachment(message))"
                  >
                    <q-icon
                      :name="
                        downloadingBlobs[messageAttachment(message)!.blobId]
                          ? 'mdi-loading'
                          : savedBlobSuccess[messageAttachment(message)!.blobId]
                            ? 'mdi-check-circle'
                            : 'mdi-download'
                      "
                      size="16px"
                      :class="{
                        'vault-blob-spinner':
                          !!downloadingBlobs[messageAttachment(message)!.blobId],
                      }"
                    />
                  </button>
                </div>
              </div>

              <MessageReactions
                :reactions="message.reactions"
                :current-actor="authStore.user?.id || ''"
                :actor-labels="reactionActorLabels"
                @toggle="toggleReaction(message.id, $event)"
              />

              <MessageQuickActions
                :visible="groupStore.canSendMessages && hoveredMessageId === message.id"
                :emojis="QUICK_EMOJIS"
                :emoji-url="discordEmojiUrl"
                @react="toggleReaction(message.id, $event)"
                @open-picker="openReactionPicker($event, message.id)"
              />
            </div>
          </div>
        </div>
      </q-scroll-area>

      <div class="group-chat-input">
        <div v-if="!groupStore.canSendMessages" class="group-chat-locked">
          <q-icon name="mdi-lock-outline" size="16px" />
          <span>You do not have permission to post in this suite</span>
        </div>

        <template v-else>
          <div v-if="replyingTo" class="vault-reply-bar">
            <q-icon name="mdi-reply" size="14px" class="vault-reply-bar-icon" />
            <div class="vault-reply-bar-content">
              <span class="vault-reply-bar-name">
                {{ replyingTo.sender === 'You' ? myUsername : replyingTo.sender }}
              </span>
              <span class="vault-reply-bar-text">{{ truncateText(replyingTo.text, 100) }}</span>
            </div>
            <button type="button" class="vault-reply-bar-close" @click="replyingTo = null">
              <q-icon name="mdi-close" size="14px" />
            </button>
          </div>

          <q-form class="group-chat-input-form" @submit.prevent="handleSendMessage">
            <input ref="fileInputRef" type="file" class="hidden" @change="handleFileSelected" />
            <button
              type="button"
              class="group-input-action-btn group-attach-btn"
              :disabled="!canAttachFiles"
              @click="triggerFileInput"
            >
              <q-spinner v-if="isUploadingAttachment" color="primary" size="16px" />
              <q-icon v-else name="mdi-plus" size="20px" />
              <q-tooltip class="bg-black text-white text-xs font-mono">
                Attach file (max 100 MB)
              </q-tooltip>
            </button>

            <q-input
              ref="messageInputRef"
              v-model="draftMessage"
              dense
              outlined
              dark
              type="textarea"
              autogrow
              rows="1"
              class="group-input-field"
              placeholder="Type a message..."
              bg-color="transparent"
              hide-bottom-space
              autocomplete="on"
              autocorrect="on"
              autocapitalize="sentences"
              spellcheck="true"
              :input-style="{ maxHeight: '120px', overflow: 'auto', resize: 'none' }"
              @keydown="onInputKeydown"
              @paste="onComposerPaste"
            />

            <button
              type="button"
              class="group-input-action-btn"
              :class="{ 'group-input-action-btn--active': showEmojiPicker }"
              @click="toggleEmojiPicker"
            >
              <q-icon name="mdi-emoticon-happy-outline" size="17px" />
              <q-tooltip class="bg-black text-white text-xs font-mono">Emoji</q-tooltip>
            </button>

            <button
              type="button"
              class="group-input-action-btn"
              :class="{ 'group-input-action-btn--active': showGifPicker }"
              @click="toggleGifPicker"
            >
              <q-icon name="fas fa-image" size="16px" />
              <q-tooltip class="bg-black text-white text-xs font-mono">Search GIFs</q-tooltip>
            </button>

            <button
              type="submit"
              class="group-send-btn"
              :disabled="!draftMessage.trim() || isSending || isRateLimited"
              @mousedown.prevent
            >
              <q-icon name="mdi-send" size="18px" />
            </button>
          </q-form>

          <div v-if="mentionSuggestions.length" class="group-mention-picker">
            <button
              v-for="member in mentionSuggestions"
              :key="member.userId"
              type="button"
              class="group-mention-option"
              @mousedown.prevent="insertMention(member.username)"
            >
              <q-avatar size="26px">
                <img v-if="member.profile?.profilePicture" :src="member.profile.profilePicture" />
                <q-icon v-else name="mdi-account" size="14px" />
              </q-avatar>
              <span>{{ member.profile?.displayName || member.username }}</span>
              <small>@{{ member.username }}</small>
            </button>
          </div>

          <transition name="group-fade">
            <div v-if="showEmojiPicker" class="group-picker group-emoji-picker">
              <div class="group-picker-header">
                <!-- Unified two-tab picker: EMOJI | GIF. The tab bar is only shown
                     on mobile; desktop keeps its separate emoji/GIF buttons. -->
                <div class="group-picker-tabs">
                  <button
                    type="button"
                    class="group-picker-tab"
                    :class="{ 'group-picker-tab--active': pickerTab === 'emoji' }"
                    @click="switchPickerTab('emoji')"
                  >
                    EMOJI
                  </button>
                  <button
                    type="button"
                    class="group-picker-tab"
                    :class="{ 'group-picker-tab--active': pickerTab === 'gif' }"
                    @click="switchPickerTab('gif')"
                  >
                    GIF
                  </button>
                </div>
                <span class="group-picker-title">EMOJI</span>
                <button type="button" @click="showEmojiPicker = false">
                  <q-icon name="mdi-close" size="16px" />
                </button>
              </div>

              <!-- Emoji tab -->
              <div v-if="pickerTab === 'emoji'" class="group-emoji-grid">
                <button
                  v-for="emoji in ALL_EMOJIS"
                  :key="emoji"
                  type="button"
                  @click="insertEmoji(emoji)"
                >
                  {{ emoji }}
                </button>
              </div>

              <!-- GIF tab (mirrors the standalone GIF panel) -->
              <template v-else>
                <div class="group-picker-header">
                  <q-input
                    v-model="gifSearchQuery"
                    dense
                    outlined
                    dark
                    hide-bottom-space
                    placeholder="Search GIFs..."
                    debounce="400"
                    @update:model-value="searchGifs"
                  />
                </div>
                <div v-if="gifLoading" class="group-picker-loading">
                  <q-spinner color="primary" size="24px" />
                </div>
                <div v-else class="group-gif-grid">
                  <button
                    v-for="gif in gifResults"
                    :key="gif.id"
                    type="button"
                    @click="sendGif(gif.url)"
                  >
                    <img :src="gif.preview" alt="GIF result" loading="lazy" />
                  </button>
                  <span v-if="!gifResults.length" class="group-picker-empty">No GIFs found</span>
                </div>
                <span class="group-gif-powered">Powered by KLIPY</span>
              </template>
            </div>
          </transition>

          <transition name="group-fade">
            <div v-if="showGifPicker" class="group-picker group-gif-picker">
              <div class="group-picker-header">
                <q-input
                  v-model="gifSearchQuery"
                  dense
                  outlined
                  dark
                  hide-bottom-space
                  placeholder="Search GIFs..."
                  debounce="400"
                  @update:model-value="searchGifs"
                />
                <button type="button" @click="showGifPicker = false">
                  <q-icon name="mdi-close" size="16px" />
                </button>
              </div>
              <div v-if="gifLoading" class="group-picker-loading">
                <q-spinner color="primary" size="24px" />
              </div>
              <div v-else class="group-gif-grid">
                <button
                  v-for="gif in gifResults"
                  :key="gif.id"
                  type="button"
                  @click="sendGif(gif.url)"
                >
                  <img :src="gif.preview" alt="GIF result" loading="lazy" />
                </button>
                <span v-if="!gifResults.length" class="group-picker-empty">No GIFs found</span>
              </div>
              <span class="group-gif-powered">Powered by KLIPY</span>
            </div>
          </transition>
        </template>
      </div>
    </template>

    <MessageContextMenu
      :visible="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :message="
        contextMenu.message
          ? { id: contextMenu.message.id, isOwn: isOwnMessage(contextMenu.message) }
          : null
      "
      :emojis="QUICK_EMOJIS"
      :emoji-url="discordEmojiUrl"
      :can-react="groupStore.canSendMessages"
      :can-reply="groupStore.canSendMessages"
      :can-delete-for-everyone="groupStore.canSendMessages"
      @close="closeContextMenu"
      @react="handleContextReaction"
      @open-picker="handleContextReactionPicker"
      @reply="contextReply"
      @copy-text="copyContextMessage"
      @delete-for-me="deleteContextForMe"
      @delete-for-everyone="deleteContextForEveryone"
      @refresh="refreshGroupHistory"
    />

    <Teleport to="body">
      <div
        v-if="reactionPicker.visible"
        class="group-context-backdrop"
        @click="closeReactionPicker"
        @contextmenu.prevent="closeReactionPicker"
      />
      <div
        v-if="reactionPicker.visible"
        class="group-reaction-picker"
        :style="{ left: `${reactionPicker.x}px`, top: `${reactionPicker.y}px` }"
      >
        <button v-for="emoji in ALL_EMOJIS" :key="emoji" type="button" @click="pickReaction(emoji)">
          <img class="vault-emoji-icon" :src="discordEmojiUrl(emoji)" :alt="emoji" />
        </button>
      </div>
    </Teleport>

    <!-- Drop-to-send overlay (Suite file/image sharing) -->
    <transition name="group-fade">
      <div v-if="dragActive" class="group-drop-overlay">
        <div class="group-drop-box">
          <q-icon name="mdi-tray-arrow-down" size="34px" class="group-drop-icon" />
          <span class="group-drop-title">DROP TO SEND</span>
          <span class="group-drop-sub">
            Encrypted on this device before upload · 100 MB max per file
          </span>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onErrorCaptured,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue';
import type { QInput, QScrollArea } from 'quasar';
import { useQuasar } from 'quasar';
import { useAuthStore } from 'src/stores/auth';
import { useGroupStore, type GroupMessage, type GroupReplyReference } from 'src/stores/groupStore';
import { useVaultStore } from 'src/stores/vault';
import MessageContextMenu from 'src/components/messaging/MessageContextMenu.vue';
import MessageQuickActions from 'src/components/messaging/MessageQuickActions.vue';
import MessageReplyReference from 'src/components/messaging/MessageReplyReference.vue';
import MessageReactions from 'src/components/messaging/MessageReactions.vue';
import { scrollToHighlightedMessage } from 'src/composables/useMessageNavigation';
import { usePlatform } from 'src/composables/usePlatform';
import { hapticSuccess } from 'src/composables/useHaptics';
import { ALL_EMOJIS, QUICK_EMOJIS, messagingEmojiUrl } from 'src/utils/messagingEmoji';
import { useVaultBlobAttachments } from 'src/composables/useVaultBlobAttachments';
import { encryptAndUploadBlob, formatBlobSize, type BlobAttachment } from 'src/crypto/blobTransfer';
import { resolveUploadFileName } from 'src/utils/fileNames';
import { resolveApiUrl } from 'boot/axios';
import { useDashboardStore } from 'src/stores/dashboard';
import { captureAccountOperation } from 'src/utils/accountLifecycle';

const props = defineProps<{
  rightPanelOpen?: boolean;
}>();

const emit = defineEmits<{
  openSettings: [];
  invite: [];
  leave: [];
  'toggle-right-panel': [];
  /** Mobile: return to the conversation list (the pane is full-screen there). */
  close: [];
}>();

const $q = useQuasar();
const { isMobile } = usePlatform();
const authStore = useAuthStore();
const groupStore = useGroupStore();
const vaultStore = useVaultStore();

/**
 * Manual recovery for a suite whose MLS state failed to restore. The banner only
 * shows in that state, so a successful retry clears it and re-fetches history.
 */
async function retryMlsRestore(): Promise<void> {
  const groupId = groupStore.activeGroupId;
  if (!groupId) return;
  const restored = await groupStore.retryMlsRestore(groupId);
  $q.notify({
    type: restored ? 'positive' : 'negative',
    message: restored
      ? 'Suite encryption restored.'
      : 'Still could not restore this suite — try again once you are back online.',
    timeout: restored ? 2000 : 3500,
  });
}
const rightPanelOpen = computed(() => props.rightPanelOpen === true);
const canTogglePanel = computed(() => $q.screen.width > 1280);
const messagesScrollRef = ref<InstanceType<typeof QScrollArea> | null>(null);
const messageInputRef = ref<InstanceType<typeof QInput> | null>(null);
const draftMessage = ref('');
const isSending = ref(false);
const isRateLimited = computed(() => groupStore.isRateLimited());
const replyingTo = ref<GroupReplyReference | null>(null);
const hoveredMessageId = ref<string | null>(null);
const showEmojiPicker = ref(false);
const showGifPicker = ref(false);
/**
 * Active tab of the unified composer picker. Only the MOBILE composer shows the
 * tab bar (emoji | GIF); on desktop the tabs stay hidden and this is 'emoji'.
 */
const pickerTab = ref<'emoji' | 'gif'>('emoji');

const dashboardStore = useDashboardStore();
const {
  blobPreviewUrls,
  blobAttachmentErrors,
  downloadingBlobs,
  savedBlobSuccess,
  isBlobImage,
  isBlobVideo,
  isBlobAudio,
  cacheAttachmentBlob,
  ensurePreview,
  saveAttachment,
} = useVaultBlobAttachments({
  scopeKey: () => [authStore.user?.id, authStore.authOperationGeneration, groupStore.activeGroupId].join(':'),
  context: groupAttachmentContext,
});

// ── Last-resort render boundary (mirrors the 1:1 chat) ────────────────────
// One bad message/media element must not unmount the Suite pane and leave it
// blank. Log it on-device and keep the rest of the window usable.
onErrorCaptured((err, _instance, info) => {
  console.error('[GroupChatWindow] Captured render error — pane kept alive', { info, err });
  return false;
});

// ── Inline audio player (mirrors MessagingPage.vue) ──────────────────────
interface SuiteAudioState {
  playing: boolean;
  currentTime: number;
  duration: number;
  progress: number;
}

const suiteAudioRefs = new Map<string, HTMLAudioElement>();
const suiteAudioStates = reactive<Record<string, SuiteAudioState>>({});

/**
 * See registerAudioRef in MessagingPage: the ref callback is invoked with `null`
 * during unmount, which on a Suite switch happens after the attachment map has been
 * recomputed — dereferencing the missing entry threw a TypeError per audio element.
 * A missing key is a no-op.
 */
function registerSuiteAudioRef(key: string | undefined | null, el: HTMLAudioElement | null) {
  if (!key) return;
  if (el) {
    suiteAudioRefs.set(key, el);
    if (!suiteAudioStates[key]) {
      suiteAudioStates[key] = { playing: false, currentTime: 0, duration: 0, progress: 0 };
    }
  } else {
    suiteAudioRefs.delete(key);
  }
}

function toggleSuiteAudio(key: string) {
  const el = suiteAudioRefs.get(key);
  if (!el) return;
  // One clip at a time across the whole window.
  for (const [otherKey, other] of suiteAudioRefs) {
    if (otherKey !== key && !other.paused) {
      other.pause();
      if (suiteAudioStates[otherKey]) suiteAudioStates[otherKey].playing = false;
    }
  }
  if (el.paused) {
    void el.play().catch(() => {
      $q.notify({ type: 'negative', message: 'Cannot play this audio', timeout: 2500 });
      if (suiteAudioStates[key]) suiteAudioStates[key].playing = false;
    });
    if (suiteAudioStates[key]) suiteAudioStates[key].playing = true;
  } else {
    el.pause();
    if (suiteAudioStates[key]) suiteAudioStates[key].playing = false;
  }
}

function onSuiteAudioMeta(key: string, e: Event) {
  const el = e.target as HTMLAudioElement;
  if (suiteAudioStates[key] && Number.isFinite(el.duration)) {
    suiteAudioStates[key].duration = el.duration;
  }
}

function onSuiteAudioTime(key: string, e: Event) {
  const el = e.target as HTMLAudioElement;
  const s = suiteAudioStates[key];
  if (s && el.duration) {
    s.currentTime = el.currentTime;
    s.progress = (el.currentTime / el.duration) * 100;
  }
}

function onSuiteAudioEnded(key: string) {
  const s = suiteAudioStates[key];
  if (s) {
    s.playing = false;
    s.currentTime = 0;
    s.progress = 0;
  }
}

function seekSuiteAudio(key: string, e: MouseEvent) {
  const el = suiteAudioRefs.get(key);
  if (!el || !el.duration) return;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  el.currentTime = pct * el.duration;
}

/** 0:07-style clock for the audio player. */
function formatAudioClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Load attachment previews WITHOUT waiting for a hover.
 *
 * Suites only ever called ensurePreview from `@mouseenter`, which a touch device
 * cannot produce — so on a phone its image/video previews never loaded and an
 * audio attachment had nothing to render at all. Prime them whenever the
 * attachment set changes (and on open), exactly like the 1:1 chat warms its cache.
 */
watch(
  () =>
    groupStore.activeGroupMessages
      .map((m) => messageAttachment(m)?.blobId ?? '')
      .filter(Boolean)
      .join(','),
  () => {
    for (const message of groupStore.activeGroupMessages) {
      const attachment = messageAttachment(message);
      if (attachment) void ensurePreview(attachment);
    }
  },
  { immediate: true },
);

const discordEmojiUrl = messagingEmojiUrl;

const currentMember = computed(() =>
  groupStore.activeGroup?.members.find((member) => member.userId === authStore.user?.id),
);
const mentionQuery = computed(() => {
  const match = draftMessage.value.match(/(?:^|\s)@([\w.-]*)$/);
  return match ? (match[1] ?? '').toLowerCase() : null;
});
const mentionSuggestions = computed(() => {
  const query = mentionQuery.value;
  if (query === null) return [];
  return (groupStore.activeGroup?.members ?? [])
    .filter((member) => member.userId !== authStore.user?.id)
    .filter((member) => {
      const username = member.username.toLowerCase();
      const displayName = member.profile?.displayName?.toLowerCase() ?? '';
      return username.startsWith(query) || displayName.includes(query);
    })
    .slice(0, 6);
});

const canInvite = computed(() => {
  const member = currentMember.value;
  return Boolean(
    member && (member.role === 'OWNER' || member.role === 'ADMIN' || member.canAddMembers),
  );
});

function isOwnMessage(message: GroupMessage): boolean {
  return (
    message.senderId === authStore.user?.id ||
    Boolean(message.senderDeviceId && message.senderDeviceId === vaultStore.deviceId)
  );
}

function isReplyToMe(message: GroupMessage): boolean {
  if (isOwnMessage(message) || !message.replyTo) return false;
  const target = groupStore.activeGroupMessages.find((item) => item.id === message.replyTo?.id);
  return Boolean(target && isOwnMessage(target));
}

const reactionActorLabels = computed<Record<string, string>>(() =>
  Object.fromEntries(
    (groupStore.activeGroup?.members ?? []).map((member) => [
      member.userId,
      member.profile?.displayName || member.username || 'Member',
    ]),
  ),
);

function liveMemberForMessage(message: GroupMessage) {
  return groupStore.activeGroup?.members.find((member) => member.userId === message.senderId);
}

function messageSenderName(message: GroupMessage): string {
  if (isOwnMessage(message)) return authStore.user?.username || 'You';
  const member = liveMemberForMessage(message);
  return (
    member?.profile?.displayName ||
    member?.username ||
    message.senderProfile?.displayName ||
    message.senderUsername ||
    'Member'
  );
}

const myUsername = computed(() => authStore.user?.username || 'You');

function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function messageAvatar(message: GroupMessage): string | null {
  if (isOwnMessage(message)) return authStore.user?.profile?.profilePicture ?? null;
  return (
    liveMemberForMessage(message)?.profile?.profilePicture ??
    message.senderProfile?.profilePicture ??
    null
  );
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function isGifUrl(value: string): boolean {
  return /^https:\/\//i.test(value) && /(?:\.gif(?:\?|$)|klipy|tenor|giphy)/i.test(value);
}

function insertMention(username: string): void {
  draftMessage.value = draftMessage.value.replace(/@([\w.-]*)$/, `@${username} `);
  void nextTick(() => messageInputRef.value?.focus());
}

/**
 * Does this Suite message have anything to draw INSIDE its bubble?
 *
 * The attachment is a SIBLING of the bubble, not in-bubble content, so it must not
 * count here — counting it drew a blank rounded rectangle next to every attachment
 * (the bubble had no text of its own but stayed visible because the attachment
 * existed). Mirrors the 1:1 guard. Defaults to TRUE if the check throws, so a real
 * message is never hidden.
 */
function hasSuiteBubbleContent(message: GroupMessage): boolean {
  try {
    if (typeof message.content === 'string' && message.content.trim().length > 0) return true;
    return false;
  } catch {
    return true;
  }
}

function messageSegments(content: string): Array<{ text: string; mention: boolean }> {
  const usernames = new Set(
    (groupStore.activeGroup?.members ?? []).map((member) => member.username.toLowerCase()),
  );
  return content
    .split(/(@[\w.-]+)/g)
    .filter(Boolean)
    .map((text) => ({
      text,
      mention: text.startsWith('@') && usernames.has(text.slice(1).toLowerCase()),
    }));
}

async function scrollToBottom(animated = true) {
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const scrollArea = messagesScrollRef.value;
  if (!scrollArea) return;
  // Mirror the 1:1 chat (MessagingPage.scrollToLatest): drive the underlying
  // scroll element directly with scrollTop = scrollHeight. Quasar's
  // setScrollPosition('vertical', 999999, {animated}) can interrupt mid-flight
  // when the composer/gifs/images resize the list right after a send, leaving
  // the list short of the newest message. Direct element assignment clamps to
  // the current maxScroll and is reliable on every send (like the 1:1 chats).
  const target =
    typeof scrollArea.getScrollTarget === 'function'
      ? scrollArea.getScrollTarget()
      : (((scrollArea as unknown as { $el?: HTMLDivElement }).$el?.querySelector(
          '.q-scrollarea__container, .scroll',
        ) as HTMLElement | null) ?? undefined);
  if (target && typeof target.scrollTop === 'number') {
    target.scrollTop = target.scrollHeight;
    scrollArea.setScrollPosition('vertical', target.scrollHeight, animated ? 200 : 0);
  } else {
    scrollArea.setScrollPosition('vertical', 999999, animated ? 200 : 0);
  }
}

watch(
  () => groupStore.activeGroupMessages.length,
  async () => {
    await nextTick();
    scrollToBottom(false);
  },
);

watch(
  () => groupStore.messagesLoading,
  (loading) => {
    if (!loading) void scrollToBottom(false);
  },
);

watch(
  () => groupStore.activeGroupId,
  async (newId) => {
    replyingTo.value = null;
    closeContextMenu();
    closeReactionPicker();
    if (newId) await scrollToBottom(false);
  },
);

let detailsPoll: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  void scrollToBottom(false);
  detailsPoll = setInterval(() => {
    const groupId = groupStore.activeGroupId;
    if (groupId) void groupStore.fetchGroupDetails(groupId);
  }, 15_000);
});

onBeforeUnmount(() => {
  if (detailsPoll) clearInterval(detailsPoll);
});

// ── Attachments (paste, drag-and-drop, picker) ──────────────────────────
// All three routes funnel into sendGroupFiles(), which encrypts the file on
// this device, uploads the opaque blob scoped to this Suite, then announces it
// inside the MLS wire payload — the same relay contract the 1:1 Vault chat uses,
// scoped to group membership instead of a link.

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const fileInputRef = ref<HTMLInputElement | null>(null);
const isUploadingAttachment = ref(false);
const dragActive = ref(false);

/** Attachments require the same send permission as the composer itself. */
const canAttachFiles = computed(
  () => groupStore.canSendMessages && !isUploadingAttachment.value && !isRateLimited.value,
);

function messageAttachment(message: GroupMessage): BlobAttachment | null {
  return message.attachment ?? null;
}

function triggerFileInput() {
  fileInputRef.value?.click();
}

async function handleFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = ''; // Reset so the same file can be picked again
  await sendGroupFiles(files);
}

function dragHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function onDragEnter(event: DragEvent) {
  if (!canAttachFiles.value || !dragHasFiles(event)) return;
  dragActive.value = true;
}

function onDragOver(event: DragEvent) {
  if (!canAttachFiles.value || !dragHasFiles(event)) return;
  // Signal a copy, and keep the overlay alive across child-element transitions.
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  dragActive.value = true;
}

function onDragLeave(event: DragEvent) {
  const root = event.currentTarget as HTMLElement | null;
  const next = event.relatedTarget as Node | null;
  if (root && next && root.contains(next)) return; // still inside the window
  dragActive.value = false;
}

function onDrop(event: DragEvent) {
  dragActive.value = false;
  if (!canAttachFiles.value) return;
  void sendGroupFiles(Array.from(event.dataTransfer?.files ?? []));
}

/** Ctrl+V in the composer: only file/image clipboard content is intercepted. */
function onComposerPaste(event: ClipboardEvent) {
  if (!canAttachFiles.value) return;
  const files = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  if (files.length === 0) return; // plain-text paste — let the composer handle it
  event.preventDefault();
  void sendGroupFiles(files);
}

/** Name for a clipboard/dropped file that carries none (e.g. a pasted bitmap). */
function attachmentFileName(file: File): string {
  if (file.name) return file.name;
  const subtype = (file.type.split('/')[1] || 'bin').split('+')[0];
  return `pasted-${Date.now()}.${subtype}`;
}

function groupAttachmentContext(attachment: BlobAttachment) {
  const group = groupStore.activeGroup;
  const message = groupStore.activeGroupMessages.find((item) => messageAttachment(item)?.blobId === attachment.blobId);
  if (!group || !message || !authStore.user?.id) return null;
  return {
    accountId: authStore.user.id, conversationId: 'group:' + group.id, messageId: message.id,
    expiresAt: group.disappearingMessagesEnabled ? new Date(message.createdAt).getTime() + (group.disappearingMessagesDuration ?? 0) * 1000 : null,
    sessionId: null, keyHex: attachment.keyHex,
  };
}

async function sendGroupFiles(picked: File[]) {
  const groupId = groupStore.activeGroupId;
  if (!groupId || picked.length === 0 || isUploadingAttachment.value) return;
  const operation = captureAccountOperation(authStore);
  const current = () => operation.isCurrent() && groupStore.activeGroupId === groupId;
  const reply = replyingTo.value;
  const randomize = dashboardStore.randomizeFileNames;

  if (!canAttachFiles.value) {
    $q.notify({
      type: 'warning',
      message: 'You do not have permission to send media in this suite',
      timeout: 3000,
    });
    return;
  }

  const tooBig = picked.filter((file) => file.size > MAX_ATTACHMENT_BYTES);
  if (tooBig.length > 0) {
    $q.notify({ type: 'negative', message: 'File too large. Maximum is 100 MB.', timeout: 3000 });
  }
  const files = picked.filter((file) => file.size <= MAX_ATTACHMENT_BYTES);
  if (files.length === 0) return;

  isUploadingAttachment.value = true;
  try {
    await operation.wait(() => authStore.fetchCsrfToken());
    if (!current()) return;
    const csrfToken = authStore.csrfToken || '';
    const apiBase = resolveApiUrl('');

    for (const file of files) {
      const sourceName = attachmentFileName(file);
      const uploadName = resolveUploadFileName(sourceName, randomize);
      const uploadFile =
        uploadName !== sourceName ? new File([file], uploadName, { type: file.type }) : file;

      const attachment = await encryptAndUploadBlob(
        uploadFile,
        { kind: 'group', id: groupId },
        csrfToken,
        apiBase,
        { displayFilename: uploadName },
      );

      if (!current()) return;
      const messageId = await operation.wait(() => groupStore.sendMessage(groupId, '', reply, attachment));
      if (!current()) return;
      if (!messageId) throw new Error('File message was not sent');
      // The message must exist before its cache identity can be bound.
      const context = groupAttachmentContext(attachment);
      if (context && (isBlobImage(attachment.mimetype) || isBlobVideo(attachment.mimetype))) {
        await cacheAttachmentBlob(attachment.blobId, uploadFile, attachment, context).catch(() => {});
      }
      if (!current()) return;
      $q.notify({ type: 'positive', message: `"${uploadName}" sent`, timeout: 2000 });
    }

    if (current() && replyingTo.value === reply) replyingTo.value = null;
    if (current()) await scrollToBottom();
  } catch (error) {
    if (!current()) return;
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'RATE_LIMIT') {
      $q.notify({ type: 'negative', message: 'Not cool, slow down.' });
      return;
    }
    console.error('[GroupChatWindow] Failed to send attachment:', error);
    $q.notify({
      type: 'negative',
      message: msg || 'Failed to send file',
      position: 'bottom',
    });
  } finally {
    isUploadingAttachment.value = false;
  }
}

async function handleSendMessage() {
  const groupId = groupStore.activeGroupId;
  const text = draftMessage.value.trim();
  if (!text || !groupId || isSending.value || !groupStore.canSendMessages) return;

  void hapticSuccess();

  if (isRateLimited.value) {
    $q.notify({ type: 'negative', message: 'Not cool, slow down.' });
    return;
  }

  isSending.value = true;
  try {
    const generation = authStore.authOperationGeneration;
    const draft = draftMessage.value;
    const reply = replyingTo.value;
    await groupStore.sendMessage(groupId, text, reply ? { ...reply } : null);
    if (generation === authStore.authOperationGeneration && groupId === groupStore.activeGroupId && draft === draftMessage.value && reply === replyingTo.value) {
      draftMessage.value = '';
      replyingTo.value = null;
      showEmojiPicker.value = false;
      await scrollToBottom();
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    if (msg === 'RATE_LIMIT') {
      $q.notify({ type: 'negative', message: 'Not cool, slow down.' });
      return;
    }
    console.error('[GroupChatWindow] Failed to send message:', error);
    $q.notify({ type: 'negative', message: 'Failed to send Suite message', position: 'bottom' });
  } finally {
    isSending.value = false;
  }
}

function onInputKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void handleSendMessage();
  }
}

function startReply(message: GroupMessage) {
  replyingTo.value = {
    id: message.id,
    sender: message.senderProfile?.displayName || message.senderUsername || 'Member',
    text: message.content.slice(0, 140),
  };
  closeContextMenu();
  messageInputRef.value?.focus();
}

function scrollToMessage(messageId: string) {
  scrollToHighlightedMessage(messagesScrollRef.value, messageId);
}

function toggleEmojiPicker() {
  showEmojiPicker.value = !showEmojiPicker.value;
  showGifPicker.value = false;
  if (showEmojiPicker.value) pickerTab.value = 'emoji';
}

function switchPickerTab(tab: 'emoji' | 'gif') {
  pickerTab.value = tab;
  if (tab === 'gif' && gifResults.value.length === 0) {
    gifSearchQuery.value = '';
    void searchGifs();
  }
}

function insertEmoji(emoji: string) {
  draftMessage.value += emoji;
  messageInputRef.value?.focus();
}

const gifSearchQuery = ref('');
const gifResults = ref<Array<{ id: string; preview: string; url: string }>>([]);
const gifLoading = ref(false);
const KLIPY_API_KEY = import.meta.env.VITE_KLIPY_API_KEY || '';

function toggleGifPicker() {
  showGifPicker.value = !showGifPicker.value;
  showEmojiPicker.value = false;
  if (showGifPicker.value) pickerTab.value = 'gif';
  if (showGifPicker.value && gifResults.value.length === 0) void searchGifs();
}

async function searchGifs(query?: string | number | null) {
  const q = typeof query === 'string' ? query.trim() : gifSearchQuery.value.trim();
  gifLoading.value = true;
  try {
    const endpoint = q
      ? `https://api.klipy.com/v2/search?q=${encodeURIComponent(q)}&key=${KLIPY_API_KEY}&client_key=mourn&limit=30&media_filter=tinygif,gif`
      : `https://api.klipy.com/v2/featured?key=${KLIPY_API_KEY}&client_key=mourn&limit=30&media_filter=tinygif,gif`;
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`GIF search failed (${response.status})`);
    const data = (await response.json()) as { results?: Array<Record<string, unknown>> };
    gifResults.value = (data.results ?? []).flatMap((result) => {
      const media = result.media_formats as Record<string, { url?: string }> | undefined;
      const preview = media?.tinygif?.url ?? media?.gif?.url;
      const url = media?.gif?.url ?? media?.tinygif?.url;
      if (!preview || !url) return [];
      return [{ id: String(result.id ?? url), preview, url }];
    });
  } catch (error) {
    console.error('[GroupChatWindow] GIF search failed:', error);
    gifResults.value = [];
  } finally {
    gifLoading.value = false;
  }
}

async function sendGif(url: string) {
  draftMessage.value = url;
  showGifPicker.value = false;
  await handleSendMessage();
}

async function toggleReaction(messageId: string, emoji: string) {
  const groupId = groupStore.activeGroupId;
  if (!groupId || !groupStore.canSendMessages) return;
  try {
    await groupStore.toggleGroupReaction(groupId, messageId, emoji);
  } catch (error) {
    console.error('[GroupChatWindow] Reaction failed:', error);
    $q.notify({ type: 'negative', message: 'Failed to update reaction', position: 'bottom' });
  }
}

const contextMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  message: GroupMessage | null;
}>({ visible: false, x: 0, y: 0, message: null });

function openContextMenu(event: MouseEvent, message: GroupMessage) {
  contextMenu.value = {
    visible: true,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 220)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 260)),
    message,
  };
}

function closeContextMenu() {
  contextMenu.value = { visible: false, x: 0, y: 0, message: null };
}

function contextReply() {
  if (groupStore.canSendMessages && contextMenu.value.message) {
    startReply(contextMenu.value.message);
  }
}

async function copyContextMessage() {
  const message = contextMenu.value.message;
  closeContextMenu();
  if (!message) return;
  await navigator.clipboard.writeText(message.content);
  $q.notify({ type: 'info', message: 'Copied to clipboard', timeout: 1200 });
}

async function deleteContextForMe() {
  const message = contextMenu.value.message;
  const groupId = groupStore.activeGroupId;
  closeContextMenu();
  if (!message || !groupId) return;
  await groupStore.deleteGroupMessageForMe(groupId, message.id);
}

async function deleteContextForEveryone() {
  const message = contextMenu.value.message;
  const groupId = groupStore.activeGroupId;
  closeContextMenu();
  if (!message || !groupId || !groupStore.canSendMessages) return;
  try {
    await groupStore.deleteGroupMessageForEveryone(groupId, message.id);
  } catch (error) {
    console.error('[GroupChatWindow] Delete for everyone failed:', error);
    $q.notify({ type: 'negative', message: 'Failed to delete message for everyone' });
  }
}

function handleContextReaction(messageId: string, emoji: string) {
  closeContextMenu();
  void toggleReaction(messageId, emoji);
}

function handleContextReactionPicker(event: MouseEvent, messageId: string) {
  openReactionPicker(event, messageId);
  closeContextMenu();
}

async function refreshGroupHistory() {
  closeContextMenu();
  if (groupStore.activeGroupId) await groupStore.fetchHistory(groupStore.activeGroupId);
}

const reactionPicker = ref({ visible: false, x: 0, y: 0, messageId: '' });

function openReactionPicker(event: MouseEvent, messageId: string) {
  if (!groupStore.canSendMessages) return;
  reactionPicker.value = {
    visible: true,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 270)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 300)),
    messageId,
  };
}

function closeReactionPicker() {
  reactionPicker.value = { visible: false, x: 0, y: 0, messageId: '' };
}

async function pickReaction(emoji: string) {
  const messageId = reactionPicker.value.messageId;
  closeReactionPicker();
  if (messageId) await toggleReaction(messageId, emoji);
}
</script>

<style scoped>
.group-chat-window {
  --suite-composer-height: 44px;
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #000;
}

.group-chat-empty,
.group-chat-empty-messages,
.group-chat-loading,
.group-picker-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.group-chat-empty-icon {
  color: #333;
}
.group-chat-empty-label,
.group-chat-empty-messages-text {
  color: rgb(var(--m-textDim-rgb));
  font: 600 13px monospace;
  letter-spacing: 0.1em;
}
.group-chat-empty-sub {
  color: #444;
  font: 11px monospace;
}

.group-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 61px;
  padding: 10px 16px;
  border-bottom: 1px solid rgb(var(--m-border-rgb));
  background: #0c0c0c;
}

/* Only rendered when the suite's MLS state could not be rebuilt: the thread below
   it cannot decrypt, so the reason has to be visible and actionable. */
.group-mls-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 8px 14px;
  font-size: 11px;
  line-height: 1.35;
  color: rgb(var(--m-danger-rgb));
  background: rgb(var(--m-danger-rgb) / 0.08);
  border-bottom: 1px solid rgb(var(--m-danger-rgb) / 0.25);
}
.group-mls-warning-text {
  flex: 1;
  min-width: 0;
}
.group-mls-warning-btn {
  flex-shrink: 0;
  padding: 3px 10px;
  font: inherit;
  font-size: 11px;
  color: inherit;
  background: transparent;
  border: 1px solid rgb(var(--m-danger-rgb) / 0.45);
  cursor: pointer;
}
.group-mls-warning-btn:hover {
  background: rgb(var(--m-danger-rgb) / 0.12);
}
.group-chat-header-info,
.group-chat-header-actions,
.group-message-meta,
.group-context-reactions {
  display: flex;
  align-items: center;
}
.group-chat-header-info {
  gap: 12px;
  /* Keeps the identity block beside the mobile back button instead of letting
     the header's `space-between` centre it between back and actions. */
  margin-right: auto;
}

/* Mobile back affordance — mirrors .vault-back-btn in MessagingPage (28px box,
   transparent, 1px border, muted glyph), using this component's own palette. */
.chat-mobile-back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-right: 10px;
  flex-shrink: 0;
  color: rgb(var(--m-arcMuted-rgb));
  background: transparent;
  border: 1px solid rgb(var(--m-border-rgb));
  cursor: pointer;
  transition: all 0.12s;
}

.chat-mobile-back-btn:hover {
  color: rgb(var(--m-text-rgb));
  border-color: rgb(var(--m-borderStrong-rgb));
  background: rgba(255, 255, 255, 0.04);
}

/* 28px visual box, ~44px touch target (an overlay, not a bigger button). */
@media (max-width: 1023px) {
  /* Parity with the 1:1 conversation: on mobile the suite window is rendered
     inside the same full-viewport .vault-center layer, so this header is the
     topmost chrome and has to clear the status bar itself. Without it the suite
     name and the back button render underneath the clock/battery row, which is
     what made the suite page look broken next to a 1:1 chat. */
  .group-chat-header {
    padding-top: calc(10px + env(safe-area-inset-top, 0px));
  }

  /* The composer must clear the Android gesture/navigation bar — viewport-fit=cover
     means the WebView extends underneath it, and Android reports
     env(safe-area-inset-bottom) as 0, so a fixed minimum does the work. */
  .group-chat-input-form {
    padding-bottom: calc(28px + env(safe-area-inset-bottom, 0px));
  }

  /* Mobile composer (WhatsApp/Telegram shape): [emoji] [input] [+ attach] [send],
     bare glyph buttons with no borders, and a borderless input pill. Desktop
     keeps the framed composer below. */
  .group-chat-input-form {
    align-items: flex-end;
    gap: 4px;
  }
  .group-chat-input-form > .group-input-action-btn:nth-of-type(1) {
    order: 3; /* attach (+) */
  }
  .group-chat-input-form > .group-input-action-btn:nth-of-type(2) {
    order: 1; /* emoji */
  }
  .group-chat-input-form > .group-input-action-btn:nth-of-type(3) {
    order: 5; /* gif — hidden on mobile, lives in the picker's GIF tab */
    display: none;
  }
  .group-chat-input-form > .group-input-field {
    order: 2;
  }
  .group-chat-input-form > .group-send-btn {
    order: 4;
  }
  .group-chat-input-form > .group-input-action-btn,
  .group-chat-input-form > .group-send-btn {
    width: 40px;
    height: 40px;
    min-height: 40px;
    border: 0;
    background: transparent;
  }
  :deep(.group-input-field .q-field__control) {
    border: 0 !important;
    background: rgba(255, 255, 255, 0.05) !important;
    border-radius: 20px !important;
    min-height: 40px !important;
    padding: 0 14px !important;
  }
  :deep(.group-input-field textarea.q-field__native) {
    min-height: 38px !important;
    padding-top: 9px !important;
    padding-bottom: 9px !important;
  }

  /* Unified picker tab bar + keyboard-replacing geometry. */
  .group-picker-tabs {
    display: flex;
    gap: 4px;
  }
  .group-picker-tab {
    border: 0;
    background: none;
    padding: 2px 8px;
    font: 700 11px monospace;
    letter-spacing: 0.1em;
    color: rgb(var(--m-arcMuted-rgb));
    cursor: pointer;
  }
  .group-picker-tab--active {
    color: color-mix(in srgb, rgb(var(--m-accent-rgb, 255 0 0)) 76.862745098%, white);
    border-bottom: 1px solid color-mix(in srgb, rgb(var(--m-accent-rgb, 255 0 0)) 76.862745098%, white);
  }
  .group-picker-header .group-picker-title {
    display: none;
  }
  .group-picker {
    left: 0;
    right: 0;
    width: 100%;
    max-height: 46vh;
    border-left: 0;
    border-right: 0;
  }

  .chat-mobile-back-btn {
    position: relative;
  }

  .chat-mobile-back-btn::after {
    content: '';
    position: absolute;
    inset: -8px;
  }
}
.group-chat-header-actions {
  gap: 6px;
}
.suite-header-button {
  width: 34px;
  min-width: 34px;
  height: 34px;
  min-height: 34px;
  padding: 0;
}
.group-chat-avatar,
.group-message-avatar {
  flex-shrink: 0;
  border: 1px solid rgb(var(--m-border-rgb));
}
.group-chat-header-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.group-chat-header-name {
  color: rgb(var(--m-text-rgb));
  font: 600 13px monospace;
}
.group-chat-header-meta {
  color: rgb(var(--m-textDim-rgb));
  font: 10px monospace;
}

.group-chat-messages {
  flex: 1;
  min-height: 0;
}
.group-chat-empty-messages,
.group-chat-loading {
  height: 100%;
}
.group-chat-messages-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px 16px;
}
.group-message {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 4px 0;
  transition: background 0.15s;
}
.group-message--own {
  flex-direction: row-reverse;
}

/* Mobile rails — mirror the 1:1 chain fix (css/messaging-shared.scss sets the
   shared 30px `.vault-msg-avatar`; these are the Suites-owned row/list gutters,
   kept in step so both surfaces read identically on a phone). */
@media (max-width: 1023px) {
  .group-chat-messages-list {
    padding: 12px 10px 10px;
  }
  .group-message {
    gap: 8px;
    padding: 3px 0;
  }
}

.group-message-content {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-width: min(72%, 720px);
}
.group-message--own .group-message-content {
  align-items: flex-end;
}
.group-message-meta {
  width: 100%;
  gap: 8px;
  padding: 0 2px;
}
.group-message--own .group-message-meta {
  justify-content: flex-end;
}
.group-message-sender-name {
  color: #aaa;
  font: 600 11px monospace;
}
.group-message-sender-handle {
  color: rgb(var(--m-textFaint-rgb));
  font-weight: 400;
}
.group-message-time {
  color: rgb(var(--m-textFaint-rgb));
  font: 9px monospace;
}
.group-message-bubble {
  min-width: 72px;
  padding: 9px 12px;
  border: 1px solid #1d1d1d;
  background: #090909;
}
.group-message--own .group-message-bubble {
  border-color: rgb(var(--m-accent-rgb, 255 0 0) / 0.34);
  background: color-mix(in srgb, rgb(var(--m-accent-rgb, 255 0 0) / 0.55) 66.6666666667%, color-mix(in srgb, black 55%, transparent));
}
.group-message-text {
  margin: 0;
  color: rgb(var(--m-text-rgb));
  font: 13px/1.45 monospace;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.group-message-gif {
  display: block;
  max-width: min(360px, 55vw);
  max-height: 300px;
  object-fit: contain;
}

.group-chat-input {
  position: relative;
  flex-shrink: 0;
  border-top: 1px solid rgb(var(--m-border-rgb));
  background: #0c0c0c;
}
.group-message-mention {
  color: color-mix(in srgb, rgb(var(--m-accent-rgb, 255 0 0)) 76.862745098%, white);
  font-weight: 700;
  background: rgb(var(--m-accent-rgb, 255 0 0) / 0.12);
  padding: 0 2px;
}
.group-mention-picker {
  position: absolute;
  z-index: 20;
  left: 60px;
  bottom: calc(100% - 1px);
  width: min(320px, calc(100% - 76px));
  border: 1px solid #282828;
  background: #090909;
  box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.55);
}
.group-mention-option {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 9px;
  padding: 7px 9px;
  border: 0;
  border-bottom: 1px solid #171717;
  background: transparent;
  color: #ddd;
  text-align: left;
  font: 12px monospace;
  cursor: pointer;
}
.group-mention-option:hover {
  background: rgb(var(--m-accent-rgb, 255 0 0) / 0.1);
}
.group-mention-option small {
  margin-left: auto;
  color: rgb(var(--m-textDim-rgb));
}
.group-chat-locked {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: rgb(var(--m-textDim-rgb));
  font: 12px monospace;
}
.group-chat-input-form {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  min-height: var(--suite-composer-height);
  padding: 10px 16px 14px;
}
.group-input-action-btn,
.group-send-btn {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: var(--suite-composer-height);
  height: var(--suite-composer-height);
  min-height: var(--suite-composer-height);
  border: 1px solid rgb(var(--m-border-rgb));
  background: transparent;
  color: rgb(var(--m-arcMuted-rgb));
  cursor: pointer;
}
.group-input-action-btn:hover:not(:disabled),
.group-input-action-btn--active,
.group-send-btn:hover:not(:disabled) {
  border-color: rgb(var(--m-accent-rgb, 255 0 0) / 0.45);
  background: rgb(var(--m-accent-rgb, 255 0 0) / 0.08);
  color: rgb(var(--m-arcEncrypted-rgb));
}
.group-input-action-btn:disabled,
.group-send-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.group-input-field {
  flex: 1;
  min-width: 0;
}
:deep(.group-input-field .q-field__control) {
  min-height: var(--suite-composer-height) !important;
  padding: 0 12px !important;
  border: 1px solid rgb(var(--m-border-rgb)) !important;
  border-radius: 0 !important;
  background: #111 !important;
}
:deep(.group-input-field .q-field__control::before),
:deep(.group-input-field .q-field__control::after) {
  display: none;
}
:deep(.group-input-field textarea.q-field__native) {
  box-sizing: border-box;
  min-height: calc(var(--suite-composer-height) - 2px) !important;
  padding: 10px 0 !important;
  color: rgb(var(--m-text-rgb));
  font: 13px/20px monospace;
}
/* Reply preview bar above the composer — matches the 1:1 chain styling. */
.vault-reply-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 16px 0;
  padding: 6px 12px;
  border: 1px solid rgb(var(--m-border-rgb));
  border-left: 2px solid rgb(var(--m-accent-rgb, 255 0 0));
  background: rgba(255, 255, 255, 0.03);
}
.vault-reply-bar-icon {
  flex-shrink: 0;
  color: rgb(var(--m-accent-rgb, 255 0 0));
}
.vault-reply-bar-content {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 1px;
}
.vault-reply-bar-name {
  color: rgb(var(--m-accent-rgb, 255 0 0));
  font: 600 10px monospace;
}
.vault-reply-bar-text {
  overflow: hidden;
  color: rgb(var(--m-arcMuted-rgb));
  font: 11px monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vault-reply-bar-close {
  display: flex;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 0;
  background: none;
  color: rgb(var(--m-arcMuted-rgb));
  cursor: pointer;
  transition: color 0.12s;
}
.vault-reply-bar-close:hover {
  color: rgb(var(--m-text-rgb));
}
.group-picker-header button {
  border: 0;
  background: transparent;
  color: rgb(var(--m-arcMuted-rgb));
  cursor: pointer;
}

.group-picker {
  position: absolute;
  right: 60px;
  bottom: calc(100% + 8px);
  z-index: 20;
  display: flex;
  width: min(340px, calc(100vw - 32px));
  max-height: min(360px, 52vh);
  flex-direction: column;
  border: 1px solid #222;
  background: #090909;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.75);
}
/* Tab bar for the unified composer picker. Hidden by default (desktop keeps the
   separate emoji / GIF buttons); shown on mobile. */
.group-picker-tabs {
  display: none;
}

.group-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid rgb(var(--m-border-rgb));
  color: rgb(var(--m-arcMuted-rgb));
  font: 700 10px monospace;
}
.group-picker-header :deep(.q-field) {
  flex: 1;
}
.group-emoji-grid,
.group-reaction-picker {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 3px;
  padding: 8px;
  overflow-y: auto;
}
.group-emoji-grid button,
.group-reaction-picker button {
  aspect-ratio: 1;
  border: 1px solid transparent;
  background: transparent;
  color: #fff;
  font-size: 18px;
  cursor: pointer;
}
.group-emoji-grid button:hover,
.group-reaction-picker button:hover {
  border-color: #333;
  background: #171717;
}
.group-gif-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 8px;
  overflow-y: auto;
}
.group-gif-grid button {
  min-height: 90px;
  padding: 0;
  border: 0;
  background: #111;
  cursor: pointer;
}
.group-gif-grid img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.group-picker-loading {
  min-height: 180px;
}
.group-picker-empty,
.group-gif-powered {
  color: rgb(var(--m-textFaint-rgb));
  font: 9px monospace;
}
.group-picker-empty {
  grid-column: 1 / -1;
  padding: 30px;
  text-align: center;
}
.group-gif-powered {
  padding: 5px 8px;
  border-top: 1px solid #171717;
  text-align: right;
}

.group-context-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9998;
}
.group-context-menu,
.group-reaction-picker {
  position: fixed;
  z-index: 9999;
  border: 1px solid #252525;
  background: #090909;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.8);
}
.group-context-menu {
  display: flex;
  width: 210px;
  flex-direction: column;
  padding: 5px;
}
.group-context-menu > button {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border: 0;
  background: transparent;
  color: #bbb;
  text-align: left;
  font: 11px monospace;
  cursor: pointer;
}
.group-context-menu > button:hover {
  background: #171717;
  color: #fff;
}
.group-context-menu > .group-context-danger {
  color: #f44;
}
.group-context-reactions {
  border-bottom: 1px solid #1d1d1d;
  margin-bottom: 3px;
  padding-bottom: 3px;
}
.group-reaction-picker {
  width: 260px;
  max-height: 280px;
  grid-template-columns: repeat(7, 1fr);
  overflow-y: auto;
}
.group-fade-enter-active,
.group-fade-leave-active {
  transition: opacity 0.15s ease;
}
.group-fade-enter-from,
.group-fade-leave-to {
  opacity: 0;
}

/* ─── Suite blob attachments (file/image sharing) ───────────────────────── */
/* Same shape as the 1:1 Vault chat bubble, except the filename, size and
   download control are always visible: a Suite attachment is delivered as
   structured payload data, so no message text carries that label. */
.vault-blob-attachment {
  margin-top: 6px;
}

/* One media box for image/video (mirrors the 1:1 chat): border + 2px radius with
   the media flush inside, so it reads as a single object instead of "media plus a
   metadata strip". No filename/size is rendered for media at all. */
.vault-blob-media {
  position: relative;
  margin-bottom: 6px;
  max-width: 320px;
  border: 1px solid rgb(var(--m-border-rgb));
  border-radius: 2px;
  overflow: hidden;
  background: #000;
  line-height: 0;
}

.vault-blob-media img,
.vault-blob-media video {
  display: block;
  max-width: 100%;
  border: 0;
  border-radius: 0;
}

.vault-blob-media--image img {
  max-height: 260px;
  object-fit: contain;
}

.vault-blob-media-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 180px;
  min-height: 80px;
  margin-bottom: 0;
}

/* Server-side blob already deleted (404 after claim / TTL): permanent, so say so
   rather than spinning forever. */
.vault-blob-media-unavailable {
  flex-direction: column;
  gap: 6px;
  color: #6b6b6b;
}

.vault-blob-unavailable-text {
  font: 11px monospace;
  color: #6b6b6b;
}

.vault-audio-time--state {
  font-style: italic;
}

/* Save overlay on a media box — revealed on hover (desktop). On mobile the
   full-screen preview owns saving. */
.vault-blob-media-save {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  color: rgb(var(--m-text-rgb));
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.12s ease,
    background 0.12s;
}

.vault-blob-media-save:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.85);
}

.vault-blob-media:hover .vault-blob-media-save {
  opacity: 1;
}

/* Non-media file row — always visible (it used to be hover-revealed, which a
   touch device can never do). */
.vault-blob-file {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 320px;
  padding: 6px 10px;
  border: 1px solid rgb(var(--m-border-rgb));
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.03);
}

.vault-blob-file-icon {
  flex-shrink: 0;
  color: #9a9a9a;
}

.vault-blob-file-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.vault-blob-filename {
  display: inline-block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 12px monospace;
  color: #9a9a9a;
}

.vault-blob-size {
  font: 10px monospace;
  color: #6b6b6b;
}

.vault-blob-download-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: none;
  color: rgb(var(--m-accent-rgb, 255 0 0));
  cursor: pointer;
}

.vault-blob-download-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

/* ── Inline audio player (mirrors the 1:1 chat) ───────────────────────── */
.vault-audio-player {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: min(280px, 62vw);
  max-width: 320px;
  padding: 8px 10px;
  border: 1px solid rgb(var(--m-border-rgb));
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.03);
}

/* The <audio> element is the engine only; the visible controls are custom. */
.vault-audio-player audio {
  display: none;
}

.vault-audio-play {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #000;
  background: rgb(var(--m-accent-rgb, 255 0 0));
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  transition:
    filter 0.12s,
    opacity 0.12s;
}

.vault-audio-play:hover:not(:disabled) {
  filter: brightness(1.15);
}

.vault-audio-play:disabled {
  opacity: 0.6;
  cursor: wait;
}

.vault-audio-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.vault-audio-track {
  position: relative;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.14);
  cursor: pointer;
}

/* Taller invisible hit area so a thumb can seek a 4px bar. */
.vault-audio-track::before {
  content: '';
  position: absolute;
  inset: -8px 0;
}

.vault-audio-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 2px;
  background: rgb(var(--m-accent-rgb, 255 0 0));
  transition: width 0.08s linear;
}

.vault-audio-knob {
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  border-radius: 50%;
  background: rgb(var(--m-accent-rgb, 255 0 0));
  transform: translateY(-50%);
  transition: left 0.08s linear;
  pointer-events: none;
}

.vault-audio-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.vault-audio-name {
  min-width: 0;
  overflow: hidden;
  font: 11px monospace;
  color: #9a9a9a;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.vault-audio-time {
  flex-shrink: 0;
  font: 10px monospace;
  color: #6b6b6b;
}

.vault-blob-spinner {
  animation: group-blob-spin 0.8s linear infinite;
}
@keyframes group-blob-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Drop-to-send overlay */
.group-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.82);
}
.group-drop-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 26px 38px;
  background: rgb(var(--m-elevated-rgb));
  border: 1px dashed rgb(var(--m-accent-rgb, 255 0 0));
}
.group-drop-icon {
  color: rgb(var(--m-accent-rgb, 255 0 0));
}
.group-drop-title {
  font: 700 14px monospace;
  letter-spacing: 0.18em;
  color: rgb(var(--m-text-rgb));
}
.group-drop-sub {
  font: 11px monospace;
  letter-spacing: 0.06em;
  color: #9a9a9a;
}
</style>
