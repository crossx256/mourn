import { onScopeDispose } from 'vue';

export interface AccountSnapshot {
  accountId: string;
  generation: number;
}

/** A generation also rejects A → logout → A, where comparing the user id alone cannot. */
export function sameAccount(left: AccountSnapshot, right: AccountSnapshot): boolean {
  return Boolean(left.accountId) && left.accountId === right.accountId && left.generation === right.generation;
}

/** Preserve joiners, combining marks and supplementary characters; replace only lone surrogates. */
export function messageText(value: string): string {
  let result = '';
  for (const character of value) {
    const point = character.codePointAt(0)!;
    result += point >= 0xd800 && point <= 0xdfff ? '\ufffd' : character;
  }
  return result.trim();
}

export function isSendEnter(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'isComposing' | 'keyCode'>): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}

const MEDIA_HOSTS = new Set(['media.tenor.com', 'media.giphy.com', 'i.giphy.com', 'media.klipy.com']);

/** Parse authority, never search the whole URL for a trusted-looking substring. */
export function trustedRemoteMedia(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    return MEDIA_HOSTS.has(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

export function safeReplyReference(value: unknown): { id: string; sender: string; text: string } | null {
  if (!value || typeof value !== 'object') return null;
  const reply = value as Record<string, unknown>;
  if (typeof reply.id !== 'string' || !reply.id || reply.id.length > 256 || typeof reply.sender !== 'string' || typeof reply.text !== 'string') return null;
  return { id: reply.id, sender: reply.sender.slice(0, 100), text: reply.text.slice(0, 500) };
}

/** Component-owned timeouts cannot install work after disposal. */
export function useUiLifetime() {
  let alive = true;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  onScopeDispose(() => {
    alive = false;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  });
  return {
    isAlive: () => alive,
    later(callback: () => void, delay: number) {
      if (!alive) return;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (alive) callback();
      }, delay);
      timers.add(timer);
      return timer;
    },
  };
}
