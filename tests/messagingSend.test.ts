import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { computed, ref, watch } from 'vue';
import { expect, it, vi } from 'vitest';

it('keeps the active thread when Retry refresh falls back to an offline list without that thread', () => {
  const syncSource = page.slice(page.indexOf('function syncSelectedLinkFromStore()'), page.indexOf('function closeConversation()'));
  const { outputText: syncJs } = ts.transpileModule(syncSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  const original = { id: 'active-thread' };
  const selectedLink = ref<typeof original | null>(original);
  const linksStore = { links: [] as Array<typeof original>, offline: true, error: null };
  const sync = new Function('selectedLink', 'linksStore', `${syncJs}\nreturn syncSelectedLinkFromStore;`)(selectedLink, linksStore);
  expect(sync()).toBeNull();
  expect(selectedLink.value).toEqual(original);
  linksStore.offline = false;
  sync();
  expect(selectedLink.value).toBeNull();
});

// Exercise the actual page handler without mounting the unrelated Vault/Suites UI.
const page = readFileSync(new URL('../src/pages/MessagingPage.vue', import.meta.url), 'utf8');
const handler = page.slice(page.indexOf('async function sendVaultMessage()'), page.indexOf('function handleSendError('));
const { outputText } = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });

function composer() {
  const snapshot = { accountId: 'alice', linkId: 'link', recipientId: 'bob' };
  const draftMessage = ref('hello');
  const replyingTo = ref(null);
  const devices = ref<{ id: string; devicePub: string }[]>([]);
  const linkCurrent = ref(true);
  const fresh = [{ id: 'bob-current', devicePub: 'aa'.repeat(32) }];
  const vaultStore = { initialize: vi.fn(), sendMessage: vi.fn(), messages: {} };
  const handleSendError = vi.fn();
  const refreshLinks = vi.fn(async () => { devices.value = fresh; });
  const bindings = {
    isSending: ref(false), linksStore: { offline: false, error: null },
    syncSelectedLinkFromStore: vi.fn(), conversationSnapshot: () => snapshot,
    draftMessage, replyingTo, sanitizeText: (text: string) => text,
    currentConversation: () => linkCurrent.value, currentAccount: () => true,
    isChatUnavailable: computed(() => !linkCurrent.value), isRateLimited: ref(false),
    createClientMessageId: () => 'msg_test', buildMessageEnvelope: (text: string) => text,
    pinToBottom: vi.fn(), hapticSuccess: vi.fn(), vaultStore, refreshLinks,
    recipientDevices: () => devices.value, isMobile: ref(false), handleSendError,
    $q: { notify: vi.fn() }, watch,
  };
  const send = new Function(...Object.keys(bindings), `
    let draftRevision = 0;
    watch([draftMessage, replyingTo], () => { ++draftRevision; }, { flush: 'sync' });
    ${outputText}
    return sendVaultMessage;
  `)(...Object.values(bindings)) as () => Promise<void>;
  return { send, draftMessage, linkCurrent, refreshLinks, vaultStore, handleSendError, fresh };
}

it('refreshes recipient devices before a first 1:1 send from an outdated link snapshot', async () => {
  const { send, draftMessage, vaultStore, fresh } = composer();
  await send();
  expect(vaultStore.sendMessage).toHaveBeenCalledOnce();
  expect(vaultStore.sendMessage).toHaveBeenCalledWith('link', 'bob', fresh, 'hello', {
    persistLocal: true, localMessageId: 'msg_test',
  });
  expect(draftMessage.value).toBe('');
});

it('keeps the draft and reports missing devices after refresh', async () => {
  const { send, refreshLinks, draftMessage, vaultStore, handleSendError } = composer();
  refreshLinks.mockResolvedValueOnce(undefined);
  await send();
  expect(vaultStore.sendMessage).not.toHaveBeenCalled();
  expect(draftMessage.value).toBe('hello');
  expect(handleSendError).toHaveBeenCalledWith(new Error('NO_PARTNER_DEVICES'));
});

it('does not send to the old conversation after a refresh changes the selection', async () => {
  const { send, refreshLinks, linkCurrent, vaultStore } = composer();
  refreshLinks.mockImplementationOnce(async () => { linkCurrent.value = false; });
  await send();
  expect(refreshLinks).toHaveBeenCalledOnce();
  expect(vaultStore.sendMessage).not.toHaveBeenCalled();
});

it('sends with cached devices when the recipient refresh fails (offline/flaky network)', async () => {
  const snapshot = { accountId: 'alice', linkId: 'link', recipientId: 'bob' };
  const draftMessage = ref('hello');
  const replyingTo = ref(null);
  const linkCurrent = ref(true);
  const cached = [{ id: 'bob-cached', devicePub: 'bb'.repeat(32) }];
  // fetchLinks leaves `links` intact on failure and only flags offline/error.
  const linksStore = { offline: false, error: null };
  const vaultStore = { initialize: vi.fn(), sendMessage: vi.fn(), messages: {} };
  const handleSendError = vi.fn();
  const refreshLinks = vi.fn(async () => { linksStore.error = 'network down'; });
  const bindings = {
    isSending: ref(false), linksStore,
    syncSelectedLinkFromStore: vi.fn(), conversationSnapshot: () => snapshot,
    draftMessage, replyingTo, sanitizeText: (text: string) => text,
    currentConversation: () => linkCurrent.value, currentAccount: () => true,
    isChatUnavailable: computed(() => !linkCurrent.value), isRateLimited: ref(false),
    createClientMessageId: () => 'msg_test', buildMessageEnvelope: (text: string) => text,
    pinToBottom: vi.fn(), hapticSuccess: vi.fn(), vaultStore, refreshLinks,
    recipientDevices: () => cached, isMobile: ref(false), handleSendError,
    $q: { notify: vi.fn() }, watch,
  };
  const send = new Function(...Object.keys(bindings), `
    let draftRevision = 0;
    watch([draftMessage, replyingTo], () => { ++draftRevision; }, { flush: 'sync' });
    ${outputText}
    return sendVaultMessage;
  `)(...Object.values(bindings)) as () => Promise<void>;
  await send();
  expect(vaultStore.sendMessage).toHaveBeenCalledOnce();
  expect(vaultStore.sendMessage).toHaveBeenCalledWith('link', 'bob', cached, 'hello', {
    persistLocal: true, localMessageId: 'msg_test',
  });
  expect(handleSendError).not.toHaveBeenCalled();
});
