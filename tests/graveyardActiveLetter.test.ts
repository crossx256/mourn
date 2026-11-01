import { describe, expect, it } from 'vitest';
import { activeLetterId, reconcileActiveLetter as reconcileLetter } from '../src/components/graveyard/activeLetter';

/**
 * L19 (audit): GraveyardPage kept the open letter only as the `selectedLetter`
 * object. `fetchLetters()` replaces `graveyardStore.letters` with a fresh array
 * (poll, offline-cache hydrate, returning to the page pinned), and the 3D star
 * positions are recomputed from that array — so a re-fetch both loses which
 * letter was open and leaves the popup pointing at a detached object.
 *
 * Identity has to be by `id`: the same letter arriving as a new object must
 * keep the dialog open, and a letter that disappears (deleted/moderated) must
 * close it rather than show stale content.
 */

type Letter = { id: string; content: string };



describe('L19 — the active letter survives a pinned/constellation re-query', () => {
  it('keeps the dialog on the same letter when the array is replaced', () => {
    const before: Letter[] = [
      { id: 'a', content: 'first' },
      { id: 'b', content: 'second' },
    ];
    const selected = before[1]!;
    // fetchLetters() replaces the array with fresh objects.
    const after: Letter[] = [
      { id: 'a', content: 'first' },
      { id: 'b', content: 'second (edited)' },
    ];
    const resolved = reconcileLetter(selected, after);
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(activeLetterId(selected));
    expect(resolved!.content).toBe('second (edited)');
  });

  it('closes the dialog when the letter is gone from the re-query', () => {
    const selected: Letter = { id: 'b', content: 'second' };
    expect(reconcileLetter(selected, [{ id: 'a', content: 'first' }])).toBeNull();
  });

  it('stays closed when nothing was open', () => {
    expect(reconcileLetter(null, [{ id: 'a', content: 'first' }])).toBeNull();
  });
});
