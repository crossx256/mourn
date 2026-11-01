/**
 * L19 (audit): GraveyardPage kept the open letter only as the `selectedLetter`
 * object. `fetchLetters()` replaces `graveyardStore.letters` with a fresh array
 * (poll, offline-cache hydrate, returning to the page pinned), so a re-query
 * both lost which letter was open and left the popup holding a detached object.
 *
 * Resolution is by `id`: the same letter arriving as a new object keeps the
 * dialog on the refreshed content; a letter that disappears (deleted or
 * moderated after the fetch) closes it instead of showing stale content.
 */
export interface LetterIdentity {
  id: string;
}

/** The open letter after a re-query, or null when it is gone (or none was open). */
export function reconcileActiveLetter<T extends LetterIdentity>(
  selected: T | null,
  fetched: ReadonlyArray<T>,
): T | null {
  if (!selected) return null;
  return fetched.find((letter) => letter.id === selected.id) ?? null;
}

/** Identity to re-open after switching between the pinned and constellation views. */
export function activeLetterId<T extends LetterIdentity>(selected: T | null): string | null {
  return selected?.id ?? null;
}
