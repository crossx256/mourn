export const QUICK_EMOJIS = ['❤️', '😂', '👍', '😮', '😢', '🔥'] as const;

export const ALL_EMOJIS = [
  ...QUICK_EMOJIS,
  '💀',
  '😭',
  '🥺',
  '😍',
  '🤣',
  '😎',
  '🤔',
  '👎',
  '🎉',
  '💯',
  '🙏',
  '😈',
  '🤡',
  '💔',
  '✨',
  '👀',
  '🫡',
  '🤝',
  '😳',
  '🥵',
  '🤮',
  '⚡',
  '🖤',
  '🩸',
  '⛓️',
  '🕊️',
  '🪦',
  '🫠',
  '😤',
  '🤯',
  '👻',
  '💜',
  '🩷',
] as const;

const EMOJI_ASSET_BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/';
const emojiUrlCache = new Map<string, string>();

export function messagingEmojiUrl(emoji: string): string {
  const cached = emojiUrlCache.get(emoji);
  if (cached) return cached;

  const codepoint = Array.from(emoji)
    .map((character) => character.codePointAt(0))
    .filter((value): value is number => typeof value === 'number' && value !== 0xfe0f)
    .map((value) => value.toString(16))
    .join('-');
  const url = `${EMOJI_ASSET_BASE}${codepoint}.svg`;
  emojiUrlCache.set(emoji, url);
  return url;
}
