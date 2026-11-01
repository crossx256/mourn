/**
 * Attachment utility for parsing and formatting attachment metadata in messages
 */

export interface AttachmentMetadata {
  filename: string;
  size?: number;
  mimetype?: string;
  transferId?: string;
  blobId?: string;
}

export interface MessageContent {
  type: 'text' | 'attachment' | 'mixed';
  text?: string;
  attachment?: AttachmentMetadata;
}

/**
 * Check if message content appears to be attachment metadata
 * Looks for patterns like:
 *   - {"filename": "...", "size": ...}
 *   - [Attachment: ...]
 *   - Binary blob marker
 */
export function parseMessageContent(plaintext: string): MessageContent {
  if (!plaintext || typeof plaintext !== 'string') {
    return { type: 'text', text: plaintext };
  }

  // Try to parse as JSON (could be attachment metadata)
  try {
    const parsed = JSON.parse(plaintext);

    if (parsed.filename && typeof parsed.filename === 'string') {
      // This looks like attachment metadata
      return {
        type: 'attachment',
        attachment: {
          filename: parsed.filename,
          size: parsed.size,
          mimetype: parsed.mimetype,
          transferId: parsed.transferId,
          blobId: parsed.blobId,
        },
      };
    }
  } catch {
    // Not JSON, continue with text parsing
  }

  // Check for explicit attachment marker
  if (plaintext.startsWith('[Attachment:') && plaintext.endsWith(']')) {
    const filename = plaintext.slice('[Attachment: '.length, -1);
    return {
      type: 'attachment',
      attachment: { filename },
    };
  }

  // Check for common binary/encrypted markers
  if (plaintext.includes('\x00') || /^[A-F0-9]{40,}$/i.test(plaintext.trim())) {
    // Likely encrypted or binary data — treat as attachment
    return {
      type: 'attachment',
      attachment: { filename: 'File Transfer' },
    };
  }

  // Regular text message
  return {
    type: 'text',
    text: plaintext,
  };
}

/**
 * Format attachment display text
 */
export function formatAttachmentDisplay(metadata: AttachmentMetadata): string {
  if (!metadata.filename) {
    return '[Attachment: Unknown File]';
  }

  if (metadata.size) {
    return `[Attachment: ${metadata.filename}] (${formatBytes(metadata.size)})`;
  }

  return `[Attachment: ${metadata.filename}]`;
}

/**
 * Format bytes to human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Extract plain text representation of a message
 * (useful for preview/reply text)
 */
export function getMessagePreviewText(plaintext: string, maxLength: number = 100): string {
  const content = parseMessageContent(plaintext);

  if (content.type === 'attachment' && content.attachment) {
    return formatAttachmentDisplay(content.attachment);
  }

  // Truncate long text messages
  if (content.text) {
    const text = content.text.trim();
    if (text.length > maxLength) {
      return text.substring(0, maxLength) + '...';
    }
    return text;
  }

  return '[Empty Message]';
}

/**
 * Check if message is primarily an attachment
 */
export function isAttachmentMessage(plaintext: string): boolean {
  const content = parseMessageContent(plaintext);
  return content.type === 'attachment';
}

/**
 * Get attachment icon based on MIME type
 */
export function getAttachmentIcon(mimetype?: string): string {
  if (!mimetype) return 'attachment';

  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'videocam';
  if (mimetype.startsWith('audio/')) return 'audio_file';
  if (mimetype === 'application/pdf') return 'picture_as_pdf';
  if (mimetype.includes('word') || mimetype.includes('document')) return 'description';
  if (mimetype.includes('sheet') || mimetype === 'text/csv') return 'table_chart';
  if (mimetype.includes('archive') || mimetype.includes('zip')) return 'folder_zip';

  return 'attachment';
}
