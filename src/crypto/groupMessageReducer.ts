interface OwnedGroupMessage {
  id: string;
  senderId: string;
  reactions: Record<string, string[]>;
}
export type GroupControl = { type: 'reaction'; targetId: string; emoji: string; remove: boolean } | { type: 'delete'; targetId: string };

/** Reduce into a working checkpoint, never the live timeline before persistence. */
export function reduceGroupControl<T extends OwnedGroupMessage>(messages: T[], control: GroupControl, actorId: string): T[] {
  const target = messages.find((message) => message.id === control.targetId);
  if (!target || !actorId) return messages;
  if (control.type === 'delete') return target.senderId === actorId ? messages.filter((message) => message.id !== control.targetId) : messages;
  if (!control.emoji || control.emoji.length > 32) return messages;
  if (!control.remove) {
    for (const [emoji, actors] of Object.entries(target.reactions)) {
      if (emoji === control.emoji) continue;
      const remaining = actors.filter((id) => id !== actorId);
      if (remaining.length) target.reactions[emoji] = remaining;
      else delete target.reactions[emoji];
    }
  }
  const current = target.reactions[control.emoji] ?? [];
  const next = control.remove ? current.filter((id) => id !== actorId) : [...new Set([...current, actorId])];
  if (next.length) target.reactions[control.emoji] = next;
  else delete target.reactions[control.emoji];
  return messages;
}
