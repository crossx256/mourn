import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ARRIVAL_BANNER_MS,
  dismissArrivalBanner,
  showArrivalBanner,
  useArrivalBanner,
} from '../src/composables/useArrivalBanner';

const { banner } = useArrivalBanner();

function makeBanner(id: string, durationMs?: number) {
  return { id, title: 'Sleepy', body: 'hey', linkId: 'link-1', durationMs };
}

describe('arrival banner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    dismissArrivalBanner();
  });

  afterEach(() => {
    dismissArrivalBanner();
    vi.useRealTimers();
  });

  it('shows a new banner with the default duration', () => {
    showArrivalBanner(makeBanner('a'));
    expect(banner.current?.id).toBe('a');
    expect(banner.current?.title).toBe('Sleepy');
    expect(banner.current?.durationMs).toBe(DEFAULT_ARRIVAL_BANNER_MS);
  });

  it('dismisses itself when the duration runs out — the bar and the banner agree', () => {
    showArrivalBanner(makeBanner('a', 1000));
    vi.advanceTimersByTime(999);
    expect(banner.current?.id).toBe('a');
    vi.advanceTimersByTime(1);
    expect(banner.current).toBeNull();
  });

  it('honours a custom duration', () => {
    showArrivalBanner(makeBanner('a', 2500));
    expect(banner.current?.durationMs).toBe(2500);
  });

  it('replaces, never stacks: a second arrival shows one banner and the first timer cannot clear it', () => {
    showArrivalBanner(makeBanner('a', 1000));
    vi.advanceTimersByTime(500);
    showArrivalBanner(makeBanner('b', 1000));
    expect(banner.current?.id).toBe('b');

    // The replaced banner's timer must not take the new one down with it.
    vi.advanceTimersByTime(600);
    expect(banner.current?.id).toBe('b');

    vi.advanceTimersByTime(400);
    expect(banner.current).toBeNull();
  });

  it('ignores a stale dismissal for a banner that was already replaced', () => {
    showArrivalBanner(makeBanner('a'));
    showArrivalBanner(makeBanner('b'));
    dismissArrivalBanner('a');
    expect(banner.current?.id).toBe('b');
  });

  it('dismisses directly, the way the close button and a tap do', () => {
    showArrivalBanner(makeBanner('a'));
    dismissArrivalBanner('a');
    expect(banner.current).toBeNull();
  });

  it('ignores a payload with no id', () => {
    showArrivalBanner({ id: '', title: 'x', body: 'y' });
    expect(banner.current).toBeNull();
  });
});
