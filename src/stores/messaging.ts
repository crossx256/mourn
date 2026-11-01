import { defineStore } from 'pinia';

export interface PendingAttachment {
  id: string;
  file: File;
  name: string;
  size: number;
  preview?: string; // data URL for image preview
  uploadProgress: number;
  error?: string;
}

export interface MessageDraft {
  linkId: string;
  text: string;
  attachments: PendingAttachment[];
}

interface MessagingState {
  pendingAttachments: PendingAttachment[];
  drafts: Record<string, MessageDraft>; // linkId -> draft
  sendingMessageId: string | null;
  lastError: string | null;
}

/**
 * Generate a random file name with the same extension as the original
 */
function generateRandomFileName(originalFileName: string): string {
  const parts = originalFileName.split('.');
  const extension = parts.length > 1 ? parts[parts.length - 1] : '';
  const randomId =
    Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  return extension ? `${randomId}.${extension}` : randomId;
}

export const useMessagingStore = defineStore('messaging', {
  state: (): MessagingState => ({
    pendingAttachments: [],
    drafts: {},
    sendingMessageId: null,
    lastError: null,
  }),

  getters: {
    attachmentCount(): number {
      return this.pendingAttachments.length;
    },

    totalAttachmentSize(): number {
      return this.pendingAttachments.reduce((sum, att) => sum + att.size, 0);
    },

    getDraft(state): (linkId: string) => MessageDraft | undefined {
      return (linkId: string) => state.drafts[linkId];
    },
  },

  actions: {
    /**
     * Add a file to pending attachments
     * Generates preview for images
     * Randomizes file name if user has enabled that preference
     */
    async addAttachment(file: File): Promise<PendingAttachment> {
      const dashboardStore = await import('src/stores/dashboard').then((m) =>
        m.useDashboardStore(),
      );
      const id = `att_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      let preview: string | undefined;

      // Generate preview for images
      if (file.type.startsWith('image/')) {
        try {
          preview = await this.generateImagePreview(file);
        } catch (err) {
          console.warn('[Messaging] Failed to generate image preview:', err);
        }
      }

      // Randomize file name if enabled
      let displayName = file.name;
      if (dashboardStore.randomizeFileNames) {
        displayName = generateRandomFileName(file.name);
      }

      const attachment: PendingAttachment = {
        id,
        file,
        name: displayName,
        size: file.size,
        preview,
        uploadProgress: 0,
      };

      // SECURITY: Validate file size (100MB max)
      if (attachment.size > 100 * 1024 * 1024) {
        const err = 'File too large (max 100MB)';
        attachment.error = err;
        console.warn('[Messaging] ' + err);
      }

      this.pendingAttachments.push(attachment);
      return attachment;
    },

    /**
     * Remove attachment by ID
     */
    removeAttachment(attachmentId: string): void {
      const index = this.pendingAttachments.findIndex((att) => att.id === attachmentId);
      if (index >= 0) {
        this.pendingAttachments.splice(index, 1);
      }
    },

    /**
     * Clear all pending attachments
     */
    clearAttachments(): void {
      this.pendingAttachments = [];
    },

    /**
     * Update upload progress for attachment
     */
    updateAttachmentProgress(attachmentId: string, progress: number): void {
      const attachment = this.pendingAttachments.find((att) => att.id === attachmentId);
      if (attachment) {
        attachment.uploadProgress = Math.min(100, Math.max(0, progress));
      }
    },

    /**
     * Set error for attachment
     */
    setAttachmentError(attachmentId: string, error: string): void {
      const attachment = this.pendingAttachments.find((att) => att.id === attachmentId);
      if (attachment) {
        attachment.error = error;
      }
    },

    /**
     * Save draft for a link
     */
    saveDraft(linkId: string, text: string): void {
      this.drafts[linkId] = {
        linkId,
        text,
        attachments: [...this.pendingAttachments],
      };
    },

    /**
     * Get draft for a link
     */
    getDraftForLink(linkId: string): MessageDraft | undefined {
      return this.drafts[linkId];
    },

    /**
     * Clear draft for a link
     */
    clearDraft(linkId: string): void {
      delete this.drafts[linkId];
    },

    /**
     * Restore draft attachments
     */
    restoreDraftAttachments(linkId: string): void {
      const draft = this.drafts[linkId];
      if (draft?.attachments) {
        this.pendingAttachments = draft.attachments;
      }
    },

    /**
     * Generate preview (data URL) for image files
     */
    async generateImagePreview(file: File): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    },

    /**
     * Validate attachment before sending
     */
    validateAttachment(attachment: PendingAttachment): boolean {
      if (attachment.error) {
        return false;
      }

      // SECURITY: Validate file type (whitelist allowed types)
      const ALLOWED_TYPES = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'application/pdf',
        'text/plain',
        'text/csv',
        'application/json',
        'video/mp4',
        'audio/mpeg',
      ];

      if (!ALLOWED_TYPES.includes(attachment.file.type)) {
        attachment.error = `File type not allowed: ${attachment.file.type}`;
        return false;
      }

      // SECURITY: Validate file size
      if (attachment.size > 100 * 1024 * 1024) {
        attachment.error = 'File too large (max 100MB)';
        return false;
      }

      return true;
    },

    /**
     * Mark message as sending
     */
    markSending(messageId: string): void {
      this.sendingMessageId = messageId;
      this.lastError = null;
    },

    /**
     * Clear sending state
     */
    clearSending(): void {
      this.sendingMessageId = null;
    },

    /**
     * Set last error
     */
    setError(error: string | null): void {
      this.lastError = error;
    },

    /**
     * Complete message send cycle
     * - Clear attachments
     * - Clear draft
     * - Clear sending state
     */
    completeSend(linkId: string): void {
      this.clearAttachments();
      this.clearDraft(linkId);
      this.clearSending();
    },
  },
});
