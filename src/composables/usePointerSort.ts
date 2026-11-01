/**
 * Pointer-driven list reordering (drag to reorder rows).
 *
 * Why not a library: this has to coexist with the dashboard's vertical scroll and with
 * Quasar's own touch handling, and it must not add a dependency or a build step. Like
 * `useSwipeGesture`, it exposes plain handlers to bind in a template and stays small.
 *
 * Rules that keep it predictable:
 *   • a drag only starts from an explicit handle (`.link-row-handle` with
 *     `touch-action: none`), so scrolling the page never picks a row up
 *   • the pointer must travel `threshold` px before the first move is committed — a
 *     plain tap on the handle stays a tap
 *   • window listeners are attached on pointerdown and removed on release, so nothing
 *     is bound during SSR and a stale drag can never outlive its pointer
 *   • the moved row's own midpoint is excluded from the maths (see listDrag.ts), so a
 *     drag over the row's own position does not flip it around
 */

import { dropIndexForMidpoints, midpointsOf } from 'src/utils/listDrag';

export interface PointerSortOptions {
  /** Row elements in current visual order (null for rows not mounted). */
  elements: () => Array<HTMLElement | null>;
  /** A move was confirmed: fromIndex → toIndex in the current list. */
  onMove: (fromIndex: number, toIndex: number) => void;
  /** The pointer went down on a handle. */
  onStart?: (index: number) => void;
  /** The drag ended (after any moves). */
  onEnd?: (index: number) => void;
  /** Px of travel before a drag is considered started. */
  threshold?: number;
}

export interface PointerSortHandlers {
  onPointerdown: (event: PointerEvent, index: number) => void;
}

export function createPointerSort(options: PointerSortOptions): PointerSortHandlers {
  const { elements, onMove, onStart, onEnd, threshold = 6 } = options;

  let active = false;
  let claimed = false;
  let currentIndex = -1;
  let startY = 0;

  const detach = () => {
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
    window.removeEventListener('pointercancel', handleUp);
  };

  const finish = () => {
    const index = currentIndex;
    detach();
    active = false;
    claimed = false;
    currentIndex = -1;
    onEnd?.(index);
  };

  const handleMove = (event: PointerEvent) => {
    if (!active) return;
    const dy = event.clientY - startY;
    if (!claimed) {
      if (Math.abs(dy) < threshold) return;
      claimed = true;
    }
    // Prevent the browser's own text selection / image drag while we own the gesture.
    if (event.cancelable) event.preventDefault();

    const rows = elements();
    const rects = rows.map((element) =>
      element ? element.getBoundingClientRect() : { top: 0, height: 0 },
    );
    const target = dropIndexForMidpoints(event.clientY, midpointsOf(rects), currentIndex);
    if (target !== currentIndex) {
      onMove(currentIndex, target);
      currentIndex = target;
    }
  };

  const handleUp = () => {
    if (!active) return;
    finish();
  };

  return {
    onPointerdown(event: PointerEvent, index: number) {
      // Mouse: primary button only. Touch/pen are always primary.
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.isPrimary === false) return;
      if (typeof window === 'undefined') return;
      active = true;
      claimed = false;
      currentIndex = index;
      startY = event.clientY;
      // Stop the browser from starting a native drag/selection on the handle.
      event.preventDefault();
      window.addEventListener('pointermove', handleMove, { passive: false });
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleUp);
      onStart?.(index);
    },
  };
}
