/**
 * Horizontal / vertical touch gestures for the mobile shell.
 *
 * Why not a library: every gesture here has to coexist with a vertical scroller
 * (the conversation list, the message list) and with each other (a row swipe must
 * win over a page swipe). Doing that needs control over *when a gesture is
 * claimed*, which a wrapper library hides. So this exposes plain touch handlers to
 * bind in a template and stays deliberately small.
 *
 * Rules that keep it predictable:
 *   • a gesture is only claimed once it is UNAMBIGUOUS — |dx| must beat |dy| by
 *     `dominance`, or the vertical scroller keeps it and the user just scrolls
 *   • claiming is one-shot per touch: the first direction to pass the threshold
 *     wins and the gesture is not re-evaluated mid-drag
 *   • `axis: 'y'` mirrors the same logic for pull-to-refresh
 *   • nothing is called on touchstart, so a tap still reaches the row's @click
 */

export type GestureAxis = 'x' | 'y';

export interface SwipeOptions {
  axis?: GestureAxis;
  /** Distance (px) the finger must travel before the gesture is claimed. */
  threshold?: number;
  /** How much the primary axis must beat the other one (1.5 ≈ 34° cone). */
  dominance?: number;
  /** Called during the drag with the live delta (for follow-the-finger UIs). */
  onMove?: (delta: number) => void;
  /** Swipe towards the start of the axis: left (x) / up (y). */
  onNegative?: (delta: number) => void;
  /** Swipe towards the end of the axis: right (x) / down (y). */
  onPositive?: (delta: number) => void;
  /** Called on release when no direction was claimed. */
  onCancel?: () => void;
  /**
   * Called on release with the full travel of the gesture and the direction it
   * settled into (null when it was never claimed). This is what a pager needs:
   * `onMove` can follow the finger 1:1 and the commit decision happens on release,
   * instead of firing mid-drag at `threshold`.
   */
  onEnd?: (info: { delta: number; direction: 'negative' | 'positive' | null }) => void;
  /** Return false to opt this touch out (e.g. a child already owns it). */
  shouldStart?: (event: TouchEvent) => boolean;
}

export interface TouchHandlers {
  onTouchstart: (event: TouchEvent) => void;
  onTouchmove: (event: TouchEvent) => void;
  onTouchend: (event: TouchEvent) => void;
  onTouchcancel: () => void;
}

export function createSwipeHandlers(options: SwipeOptions): TouchHandlers {
  const {
    axis = 'x',
    threshold = 48,
    dominance = 1.5,
    onMove,
    onNegative,
    onPositive,
    onCancel,
    onEnd,
    shouldStart,
  } = options;

  let startX: number | null = null;
  let startY: number | null = null;
  let claimed: 'negative' | 'positive' | null = null;
  let lastDelta = 0;
  let sawMove = false;

  const reset = () => {
    startX = null;
    startY = null;
    claimed = null;
    lastDelta = 0;
    sawMove = false;
  };

  return {
    onTouchstart(event: TouchEvent) {
      const touch = event.touches[0];
      if (!touch) return;
      if (shouldStart && !shouldStart(event)) return;
      startX = touch.clientX;
      startY = touch.clientY;
      claimed = null;
      sawMove = false;
    },

    onTouchmove(event: TouchEvent) {
      if (startX === null || startY === null) return;
      const touch = event.touches[0];
      if (!touch) return;

      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const primary = axis === 'x' ? dx : dy;
      const secondary = axis === 'x' ? dy : dx;

      // Ambiguous so far: let the scroller have it until the user commits.
      if (claimed === null) {
        if (Math.abs(primary) < 8) return;
        if (Math.abs(primary) < Math.abs(secondary) * dominance) {
          reset();
          return;
        }
        claimed = primary < 0 ? 'negative' : 'positive';
      }

      sawMove = true;
      lastDelta = primary;
      onMove?.(primary);

      if (primary >= threshold) {
        onPositive?.(primary);
        reset();
      } else if (primary <= -threshold) {
        onNegative?.(primary);
        reset();
      }
    },

    onTouchend() {
      const info = { delta: lastDelta, direction: claimed };
      if (claimed === null && sawMove) onCancel?.();
      const hadClaim = claimed !== null;
      reset();
      if (hadClaim) onEnd?.(info);
    },

    onTouchcancel() {
      if (claimed !== null) onCancel?.();
      reset();
    },
  };
}
