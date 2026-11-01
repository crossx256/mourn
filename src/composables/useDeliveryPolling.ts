import { watch, type WatchStopHandle } from 'vue';

/**
 * Delivery polling for an open vault conversation.
 *
 * Every 30 s the sender asks the server which of its SENDING messages (>30 s old)
 * actually landed, so a message that never reached the partner stops looking
 * sent. This lived inline in MessagingPage's setup, where the interval was only
 * cleared by the selectedLink watcher: leaving the page with a chat open leaked a
 * live interval that kept calling the vault store, and any state change after
 * unmount started a new one (audit H3). Ownership now sits in one object whose
 * `dispose()` the page calls from onUnmounted.
 */
export interface DeliveryPollMessage {
  id: string;
  isSender: boolean;
  /** Optional in the view model: a freshly-hydrated row may not carry a status
   *  yet, and the poll only tests for SENDING (see `collectCandidates`). */
  status?: string;
  timestamp: number;
}

/** Terminal statuses the server can report for one of our messages. */
export type DeliveryStatus = 'SENT' | 'DELIVERED' | 'FAILED_PROTOCOL';

export interface DeliveryPollDeps {
  /** Id of the conversation currently open, or null. */
  selectedLinkId: () => string | null;
  /** Messages rendered for that conversation. */
  vaultMessages: () => ReadonlyArray<DeliveryPollMessage>;
  /** Returns only well-formed statuses; the poll forwards the map unchanged. */
  checkMessageDeliveryStatus: (
    linkId: string,
    messageIds: string[],
  ) => Promise<Record<string, DeliveryStatus>>;
  updateMessageStatusFromDelivery: (
    linkId: string,
    status: Record<string, DeliveryStatus>,
  ) => Promise<void>;
  /** Returns whether anything was flagged (the poll ignores the value). */
  checkForStalledMessages: (linkId: string) => Promise<boolean | void>;
  log: (message: string, error?: unknown) => void;
}

export const DELIVERY_POLL_INTERVAL_MS = 30_000;
const STUCK_AFTER_MS = 30_000;

/**
 * Lifetime owner. `dispose()` is idempotent, clears the registered interval and
 * makes every later start/poll a no-op, so a torn-down page cannot poll.
 */
export class DeliveryPollTracker {
  private disposed = false;
  private interval: ReturnType<typeof setInterval> | null = null;

  get isDisposed() {
    return this.disposed;
  }

  /** Replaces the tracked interval, clearing the previous one. @internal */
  track(handle: ReturnType<typeof setInterval> | null) {
    if (this.interval && this.interval !== handle) clearInterval(this.interval);
    this.interval = handle;
  }

  dispose() {
    this.disposed = true;
    this.track(null);
  }
}

/**
 * Starts polling for the lifetime of the caller. The returned function removes the
 * watch and stops the interval; call `tracker.dispose()` from onUnmounted as well
 * so an in-flight check cannot apply results after teardown.
 */
export function startDeliveryPolling(
  deps: DeliveryPollDeps,
  tracker: DeliveryPollTracker = new DeliveryPollTracker(),
): () => void {
  const poll = async () => {
    if (tracker.isDisposed) return;
    const linkId = deps.selectedLinkId();
    if (!linkId) return;
    const stuck = deps
      .vaultMessages()
      .filter(
        (message) =>
          message.isSender &&
          message.status === 'SENDING' &&
          Date.now() - message.timestamp > STUCK_AFTER_MS,
      );
    if (stuck.length === 0) return;
    try {
      const status = await deps.checkMessageDeliveryStatus(
        linkId,
        stuck.map((message) => message.id),
      );
      // Teardown or a conversation switch may have happened mid-request.
      if (tracker.isDisposed || deps.selectedLinkId() !== linkId) return;
      if (Object.keys(status).length > 0)
        await deps.updateMessageStatusFromDelivery(linkId, status);
      // No recovery heartbeats here: they used to be empty encrypted frames that
      // recipients read as malformed control messages. Status is enough.
      if (tracker.isDisposed || deps.selectedLinkId() !== linkId) return;
      await deps.checkForStalledMessages(linkId);
    } catch (error) {
      deps.log('[MessagingPage] Delivery status check failed', error);
    }
  };

  const stopWatch: WatchStopHandle = watch(
    () => deps.selectedLinkId(),
    (id) => {
      // Always drop the current timer; only a live tracker may start a new one.
      tracker.track(null);
      if (id && !tracker.isDisposed) {
        tracker.track(
          setInterval(() => {
            void poll();
          }, DELIVERY_POLL_INTERVAL_MS),
        );
      }
    },
  );

  return () => {
    stopWatch();
    tracker.track(null);
  };
}
