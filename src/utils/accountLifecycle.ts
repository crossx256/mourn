import { getActivePinia } from 'pinia';
import { useAuthStore } from '../stores/auth';

export class AccountOperationSuperseded extends Error {
  constructor() {
    super('Account operation was superseded');
    this.name = 'AccountOperationSuperseded';
  }
}

export interface AccountIdentity {
  user: { id: string } | null;
  authOperationGeneration: number;
}

/** A UID alone cannot distinguish logout/login into the same account. */
export function captureAccountOperation(auth: AccountIdentity = useAuthStore()) {
  const uid = auth.user?.id ?? null;
  const generation = auth.authOperationGeneration;
  const isCurrent = () =>
    (auth.user?.id ?? null) === uid && auth.authOperationGeneration === generation;
  const assertCurrent = () => {
    if (!isCurrent()) throw new AccountOperationSuperseded();
  };
  return {
    uid,
    generation,
    isCurrent,
    assertCurrent,
    async wait<T>(work: () => T | PromiseLike<T>): Promise<T> {
      assertCurrent();
      try {
        const result = await work();
        assertCurrent();
        return result;
      } catch (error) {
        assertCurrent();
        throw error;
      }
    },
  };
}

const sequences = new WeakMap<object, Map<string, number>>();
export function nextStoreRequest(store: object, key: string): () => boolean {
  let entries = sequences.get(store);
  if (!entries) sequences.set(store, (entries = new Map()));
  const sequence = (entries.get(key) ?? 0) + 1;
  entries.set(key, sequence);
  return () => entries.get(key) === sequence;
}

const transitionQueues = new WeakMap<object, Promise<unknown>>();
/** Serialize cookie/keychain transitions without letting a failed operation block the queue. */
export function serializeAccountTransition<T>(owner: object, work: () => Promise<T>): Promise<T> {
  const previous = transitionQueues.get(owner) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(work);
  transitionQueues.set(owner, result);
  void result.finally(() => {
    if (transitionQueues.get(owner) === result) transitionQueues.delete(owner);
  }).catch(() => {});
  return result;
}

export interface CleanupResult {
  success: boolean;
  completed: string[];
  failed: Array<{ owner: string; error: string }>;
}

export async function runCleanup(
  owners: Array<{ owner: string; clear: () => void | Promise<unknown> }>,
): Promise<CleanupResult> {
  const completed: string[] = [];
  const failed: CleanupResult['failed'] = [];
  for (const item of owners) {
    try {
      await item.clear();
      completed.push(item.owner);
    } catch (error) {
      failed.push({ owner: item.owner, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { success: failed.length === 0, completed, failed };
}

/** Memory/background teardown only. Logout must not destroy durable history or ratchets. */
export async function teardownPrivateStores(isCurrent: () => boolean, outgoingUid = useAuthStore().user?.id): Promise<CleanupResult> {
  const pinia = getActivePinia();
  const modules = await Promise.all([
    import('src/stores/vault'), import('../stores/links'), import('../stores/groupStore'),
    import('../stores/broadcastStore'), import('../stores/messaging'), import('../stores/watcher'),
    import('../stores/security'), import('../stores/tickets'), import('../stores/archives'),
    import('../stores/dashboard'), import('../stores/notifications'), import('../stores/graveyard'),
    import('../stores/words'), import('../stores/accounts'),
  ]);
  if (!isCurrent()) throw new AccountOperationSuperseded();
  const [vault, links, groups, broadcast, messaging, watcher, security, tickets, archives,
    dashboard, notifications, graveyard, words, accounts] = modules;
  const result = await runCleanup([
    { owner: 'vault', clear: () => vault.useVaultStore(pinia).clearVaultState(outgoingUid) },
    { owner: 'links', clear: () => links.useLinksStore(pinia).clearState() },
    { owner: 'groups', clear: () => groups.useGroupStore(pinia).reset() },
    { owner: 'broadcast', clear: () => broadcast.useBroadcastStore(pinia).clearState() },
    { owner: 'drafts/files', clear: () => messaging.useMessagingStore(pinia).$reset() },
    { owner: 'watcher', clear: () => { const store = watcher.useWatcherStore(pinia); store.stopSyncInterval(); store.$reset(); } },
    { owner: 'security', clear: () => security.useSecurityStore(pinia).$reset() },
    { owner: 'tickets', clear: () => tickets.useTicketsStore(pinia).$reset() },
    { owner: 'archives', clear: () => archives.useArchivesStore(pinia).$reset() },
    { owner: 'dashboard', clear: () => dashboard.useDashboardStore(pinia).$reset() },
    { owner: 'notifications', clear: () => notifications.useNotificationsStore(pinia).$reset() },
    { owner: 'graveyard', clear: () => graveyard.useGraveyardStore(pinia).$reset() },
    { owner: 'words', clear: () => words.useWordsStore(pinia).$reset() },
    { owner: 'accounts', clear: () => accounts.useAccountsStore(pinia).clearActive() },
  ].map((item) => ({ ...item, clear: () => { if (!isCurrent()) throw new AccountOperationSuperseded(); return item.clear(); } })));
  if (!result.success) console.warn('[Account] Private teardown incomplete', result.failed);
  return result;
}

export interface RetentionPolicy { mode: 'persistent' | 'ephemeral_time' | 'ephemeral_session'; retainHours?: number }
/** Timed retention is checked at every read/write/export, not just when a chat opens. */
export function retainedMessages<T>(messages: T[], policy: RetentionPolicy | null, timestamp: (message: T) => number, now = Date.now()): T[] {
  if (policy?.mode !== 'ephemeral_time') return messages;
  const hours = policy.retainHours;
  if (!hours || !Number.isFinite(hours) || hours <= 0) return [];
  const cutoff = now - hours * 3_600_000;
  return messages.filter((message) => Number.isFinite(timestamp(message)) && timestamp(message) > cutoff);
}

/** Durable storage inventory for the explicit clearAllVaultDataForUser cleanup. */
export const ACCOUNT_STORAGE_OWNERS = [
  'idb-keyval: vault keys/ratchets/history/settings, group/broadcast history, offline account blobs',
  'mourn_mls/group_state: MLS clients (crypto owner)',
  'mourn-vault-attachments/attachments: cached files (UI owner)',
  'OS secure storage: device/identity keys and saved credentials',
  'native watcher SQLite: account-scoped logs (native owner; legacy rows retained separately)',
] as const;
