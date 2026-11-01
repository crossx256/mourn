import type { ClientMessage } from 'stores/vault';

/**
 * Coerce a persisted message list into safe, renderable records.
 *
 * A stored record only needs `id` + `plaintext` + `timestamp` to be displayable,
 * so anything structurally invalid is DROPPED here rather than merged and then
 * blown up on during render. One corrupt IndexedDB entry (a partially written
 * record, an aborted upgrade) could otherwise take the whole conversation with
 * it — the reported "chat shows empty / SECURE CHANNEL ACTIVE while history
 * exists" failure.
 *
 * Kept in its own module (no store/Quasar imports) so it is trivially unit
 * testable. Returns null when there is no stored value at all, [] when the value
 * exists but is not an array.
 */
export function sanitizeStoredMessages(raw: unknown): ClientMessage[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return [];
  const out: ClientMessage[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const m = entry as Partial<ClientMessage>;
    if (typeof m.id !== 'string' || !m.id) continue;
    if (typeof m.plaintext !== 'string') continue;
    if (typeof m.timestamp !== 'number' || !Number.isFinite(m.timestamp)) continue;
    out.push({
      ...(m as ClientMessage),
      id: m.id,
      plaintext: m.plaintext,
      timestamp: m.timestamp,
      isSender: m.isSender === true,
      reactions:
        m.reactions && typeof m.reactions === 'object'
          ? (m.reactions as Record<string, string[]>)
          : {},
      status: typeof m.status === 'string' ? m.status : 'SENT',
    });
  }
  return out;
}
