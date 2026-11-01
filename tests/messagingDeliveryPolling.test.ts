import { readFileSync } from 'node:fs';
import { effectScope, nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeliveryPollTracker,
  startDeliveryPolling,
  type DeliveryPollDeps,
} from '../src/composables/useDeliveryPolling';

/**
 * H3: the delivery poll (every 30 s, asks the server to reconcile SENDING
 * messages that are >30 s old) was created inside onMounted and only cleared by
 * the selectedLink watcher. Leaving /chains therefore leaked a live interval
 * that kept calling the vault store forever, and any state change after unmount
 * created a new one.
 *
 * The defect is the interval's lifetime, so these tests use fake timers and
 * count real timer registrations. Delivery logic itself is unchanged.
 */
const selectedLink = ref<{ id: string } | null>(null);
const stuckMessages = [
  { id: 'm1', isSender: true, status: 'SENDING' as const, timestamp: 0 },
];
let deps: DeliveryPollDeps & {
  checkMessageDeliveryStatus: ReturnType<typeof vi.fn>;
  updateMessageStatusFromDelivery: ReturnType<typeof vi.fn>;
  checkForStalledMessages: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(60_000);
  selectedLink.value = null;
  deps = {
    selectedLinkId: () => selectedLink.value?.id ?? null,
    vaultMessages: () => stuckMessages,
    checkMessageDeliveryStatus: vi.fn(async () => ({})),
    updateMessageStatusFromDelivery: vi.fn(async () => undefined),
    checkForStalledMessages: vi.fn(async () => undefined),
    log: () => undefined,
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function openConversation(id: string) {
  selectedLink.value = { id };
  await nextTick();
}

describe('delivery polling lifetime', () => {
  it('registers one interval per open conversation and none while closed', async () => {
    const scope = effectScope();
    const stop = scope.run(() => startDeliveryPolling(deps))!;
    expect(vi.getTimerCount()).toBe(0);
    await openConversation('A');
    expect(vi.getTimerCount()).toBe(1);
    await openConversation('B');
    expect(vi.getTimerCount()).toBe(1);
    selectedLink.value = null;
    await nextTick();
    expect(vi.getTimerCount()).toBe(0);
    stop();
    scope.stop();
  });

  it('polls the vault only after the interval elapses', async () => {
    const scope = effectScope();
    const stop = scope.run(() => startDeliveryPolling(deps))!;
    await openConversation('A');
    expect(deps.checkMessageDeliveryStatus).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(deps.checkMessageDeliveryStatus).toHaveBeenCalledWith('A', ['m1']);
    expect(deps.checkForStalledMessages).toHaveBeenCalledWith('A');
    stop();
    scope.stop();
  });

  it('stops polling when the component unmounts, even if the conversation stays selected', async () => {
    const tracker = new DeliveryPollTracker();
    const scope = effectScope();
    scope.run(() => startDeliveryPolling(deps, tracker));
    await openConversation('A');
    expect(vi.getTimerCount()).toBe(1);

    tracker.dispose();
    scope.stop();
    expect(vi.getTimerCount()).toBe(0);

    // A late state change (e.g. vault hydration finishing during route teardown)
    // must not restart the poll.
    await openConversation('B');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(deps.checkMessageDeliveryStatus).not.toHaveBeenCalled();
  });

  it('does not throw or poll when disposed while a check is in flight', async () => {
    const tracker = new DeliveryPollTracker();
    let release: (value: Record<string, string>) => void = () => undefined;
    deps.checkMessageDeliveryStatus.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve as never)),
    );
    const scope = effectScope();
    scope.run(() => startDeliveryPolling(deps, tracker));
    await openConversation('A');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(deps.checkMessageDeliveryStatus).toHaveBeenCalledTimes(1);

    tracker.dispose();
    scope.stop();
    release({ m1: 'DELIVERED' });
    await vi.runAllTimersAsync();
    // The in-flight answer arrived after teardown: it must not be applied.
    expect(deps.updateMessageStatusFromDelivery).not.toHaveBeenCalled();
    expect(deps.checkForStalledMessages).not.toHaveBeenCalled();
  });
});

describe('MessagingPage wiring', () => {
  const page = () =>
    readFileSync(new URL('../src/pages/MessagingPage.vue', import.meta.url), 'utf8');

  it('starts the poll through the composable and disposes it on unmount', () => {
    const source = page();
    expect(source).toContain('stopDeliveryPolling = startDeliveryPolling(');
    // The old inline timer (and its unmount-free watcher) must be gone.
    expect(source).not.toContain('let deliveryPollInterval');
    const unmount = source.split('onUnmounted(() => {')[1]?.split('//  Computed')[0] ?? '';
    expect(unmount).toContain('deliveryPollTracker.dispose();');
    expect(unmount).toContain('stopDeliveryPolling?.();');
  });
});
