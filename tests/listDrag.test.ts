import { describe, expect, it } from 'vitest';
import { dropIndexForMidpoints, midpointsOf, moveItem } from '../src/utils/listDrag';

describe('list drag maths', () => {
  it('derives midpoints from bounding rects', () => {
    expect(
      midpointsOf([
        { top: 0, height: 40 },
        { top: 48, height: 40 },
        { top: 96, height: 20 },
      ]),
    ).toEqual([20, 68, 106]);
  });

  it('lands a row where the pointer is, ignoring the dragged row itself', () => {
    const midpoints = [10, 30, 50, 70];
    // Dragging the first row down past the second midpoint → index 1
    expect(dropIndexForMidpoints(40, midpoints, 0)).toBe(1);
    // …all the way to the bottom
    expect(dropIndexForMidpoints(200, midpoints, 0)).toBe(3);
    // …and staying at the top while above every other midpoint
    expect(dropIndexForMidpoints(0, midpoints, 0)).toBe(0);
  });

  it('is a no-op while the pointer sits over the dragged row', () => {
    const midpoints = [10, 30, 50, 70];
    expect(dropIndexForMidpoints(30, midpoints, 1)).toBe(1);
    expect(dropIndexForMidpoints(50, midpoints, 2)).toBe(2);
  });

  it('moves a middle row up and down', () => {
    const midpoints = [10, 30, 50, 70];
    expect(dropIndexForMidpoints(5, midpoints, 2)).toBe(0);
    expect(dropIndexForMidpoints(20, midpoints, 2)).toBe(1);
    expect(dropIndexForMidpoints(100, midpoints, 1)).toBe(3);
  });

  it('clamps an out-of-range source index instead of throwing', () => {
    expect(dropIndexForMidpoints(50, [10, 30], 9)).toBe(1);
    expect(dropIndexForMidpoints(50, [], 3)).toBe(0);
  });

  it('moveItem reorders without mutating the input', () => {
    const rows = ['a', 'b', 'c', 'd'];
    expect(moveItem(rows, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(rows, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(rows, 1, 1)).toEqual(rows);
    expect(moveItem(rows, -1, 2)).toEqual(rows);
    expect(moveItem(rows, 0, 9)).toEqual(rows);
    expect(rows).toEqual(['a', 'b', 'c', 'd']);
  });
});
