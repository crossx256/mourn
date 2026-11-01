import type { RouteLocationRaw, Router } from 'vue-router';
import type { TicketTargetPrefill } from 'src/types/ticket';
import { useAuthStore } from 'src/stores/auth';

const messagePrefills = new WeakMap<object, {
  token: string; generation: number; accountId: string;
  targetType: string; targetRef: string; content: string;
}>();

export function getTicketMessagePrefill(token: string, targetType: string, targetRef: string): string | undefined {
  const auth = useAuthStore();
  const saved = messagePrefills.get(auth);
  if (!saved || saved.token !== token || saved.accountId !== auth.user?.id ||
      saved.generation !== auth.authOperationGeneration || saved.targetType !== targetType ||
      saved.targetRef !== targetRef) return undefined;
  return saved.content;
}

export function clearTicketMessagePrefill(): void {
  messagePrefills.delete(useAuthStore());
}

/**
 * Every report entry point in the app funnels through here, so the four
 * surfaces (message context menu, suite settings, letter dialog, profile page)
 * can never drift into their own submission flow — they all open the shared
 * composer at /tickets with the target pre-set.
 *
 * The query keys are read back by SupportReportsPage.vue's `prefill` computed.
 */
export function ticketReportRoute(prefill: TicketTargetPrefill): RouteLocationRaw {
  const query: Record<string, string> = {
    target: prefill.targetType,
    ref: prefill.targetRef,
  };

  if (prefill.label) query.label = prefill.label;
  // Plaintext never enters history, referrers, URL logs, or persisted storage.
  const auth = useAuthStore();
  messagePrefills.delete(auth);
  if (prefill.messageContent && auth.user?.id) {
    const token = crypto.randomUUID();
    messagePrefills.set(auth, {
      token, generation: auth.authOperationGeneration, accountId: auth.user.id,
      targetType: prefill.targetType, targetRef: prefill.targetRef,
      content: prefill.messageContent,
    });
    query.prefill = token;
  }
  if (prefill.categoryScope === 'profile') query.scope = 'profile';

  return { path: '/tickets', query };
}

export function openTicketReport(router: Router, prefill: TicketTargetPrefill) {
  return router.push(ticketReportRoute(prefill));
}
