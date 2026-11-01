const animatedEffects = new Set(['cursor-trail', 'spotlight', 'neon-glow', 'sparkle-dust', 'bubbles', 'fairy-dust']);

export function cursorPolicy(effect: string | null | undefined, animate: boolean, hasContext: boolean, hasPointer: boolean) {
  const draw = animate && animatedEffects.has(effect ?? '');
  return { draw, hideNative: draw && hasContext && hasPointer && effect === 'neon-glow' };
}

export function safeCursorUrl(raw: string | null | undefined): string | null {
  if (!raw || /['"\\();\s<>]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}
