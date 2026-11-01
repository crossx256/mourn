/**
 * M5 (audit): `openChat()` writes `vaultStore.setActiveLink(link.id)`, and a
 * page-level `watch(() => vaultStore.activeLinkId, …)` calls `openChat(link)`
 * back whenever the id differs from `selectedLink`. In `openChat` the order
 * was:
 *
 *   1. selectedLink = link            (page renders the new thread)
 *   2. setActiveLink(link.id)         (watch fires on the next flush)
 *   3. await loadMessages(link.id)
 *   4. (watch runs) selectedLink is already link → openChat returns early
 *
 * Step 4 only passes because step 1 ran first: the guard compares against state
 * openChat itself has written. It bounds sequential re-entry but never a
 * *concurrent* open — any second caller that reaches step 3 while the first is
 * suspended (a deep link landing during the open, a reader that selects the
 * same thread) starts a second `loadMessages` for one conversation.
 *
 * The keyed guard below coalesces concurrent opens per link id without
 * swallowing genuine re-opens, and the watcher skips while an open for its id
 * is running.
 */

export type KeyedOpener<L extends { id: string }> = {
  /** Run (or join) the in-flight open for `link.id`. */
  open(link: L): Promise<void>;
  /** True while an open for this id is in flight. */
  isOpening(id: string): boolean;
};

export function createKeyedOpener<L extends { id: string }>(
  perform: (link: L) => Promise<void>,
): KeyedOpener<L> {
  const inFlight = new Map<string, Promise<void>>();
  return {
    open(link: L) {
      const running = inFlight.get(link.id);
      if (running) return running;
      const run = (async () => {
        try {
          await perform(link);
        } finally {
          inFlight.delete(link.id);
        }
      })();
      inFlight.set(link.id, run);
      return run;
    },
    isOpening(id: string) {
      return inFlight.has(id);
    },
  };
}
