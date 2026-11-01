/**
 * Pure maths for pointer-driven list reordering.
 *
 * Kept separate from the DOM composable so the tricky part — deciding *where* a
 * dragged row lands — is unit-tested without a browser.
 */

/** Vertical midpoints of the rows, in current visual order. */
export function midpointsOf(rects: Array<{ top: number; height: number }>): number[] {
  return rects.map((rect) => rect.top + rect.height / 2);
}

/**
 * Where the row at `fromIndex` belongs once the pointer sits at `pointerY`.
 *
 * Contract: `midpoints` are the CURRENT midpoints (the dragged row is still in the
 * list). Returns the final index the row should take, i.e. a move of
 * `fromIndex → returned index` in the same list.
 *
 * The dragged row itself is excluded from the comparison, so dragging a row over its
 * own midpoint is a no-op and small jitters do not flip it back and forth.
 */
export function dropIndexForMidpoints(
  pointerY: number,
  midpoints: number[],
  fromIndex: number,
): number {
  if (!midpoints.length) return 0;
  const from = Math.min(Math.max(fromIndex, 0), midpoints.length - 1);
  let target = 0;
  for (let index = 0; index < midpoints.length; index += 1) {
    if (index === from) continue;
    const midpoint = midpoints[index];
    if (midpoint === undefined) continue;
    if (pointerY > midpoint) target += 1;
  }
  return target;
}

/** Move one item to another position. Returns a new array; out-of-range is a copy. */
export function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  )
    return [...items];
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  if (item === undefined) return [...items];
  next.splice(toIndex, 0, item);
  return next;
}
