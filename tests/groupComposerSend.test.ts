import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { computed, effectScope, reactive, ref, watch } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';

// Exercise the real Suite handler and its reactive state without rendering the history.
const source = readFileSync(
  new URL('../src/components/suites/GroupChatWindow.vue', import.meta.url),
  'utf8',
);
const state = source.slice(
  source.indexOf('const draftMessage ='),
  source.indexOf('const hoveredMessageId ='),
);
const handlers = source.slice(
  source.indexOf('async function handleSendMessage()'),
  source.indexOf('function startReply('),
);
const { outputText } = ts.transpileModule(state + handlers, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
});
const scopes: ReturnType<typeof effectScope>[] = [];
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.restoreAllMocks();
});

const reply = { id: 'previous', sender: 'Member', text: 'question' };
function composer() {
  const sendResult = Promise.withResolvers<string | null>();
  const groupStore = reactive({
    activeGroupId: 'suite',
    canSendMessages: true,
    isRateLimited: vi.fn(() => false),
    sendMessage: vi.fn(() => sendResult.promise),
  });
  const authStore = reactive({ user: { id: 'sender' }, authOperationGeneration: 1 });
  const notify = vi.fn();
  const scrollToBottom = vi.fn();
  const scope = effectScope();
  scopes.push(scope);
  const bindings = {
    ref,
    computed,
    watch,
    groupStore,
    authStore,
    hapticSuccess: vi.fn(),
    $q: { notify },
    scrollToBottom,
    onBeforeUnmount: vi.fn(),
    showEmojiPicker: ref(false),
    showGifPicker: ref(false),
  };
  const mounted = scope.run(() =>
    new Function(
      ...Object.keys(bindings),
      `${outputText}
    return { send: handleSendMessage, keydown: onInputKeydown, draftMessage, replyingTo, isSending };
  `,
    )(...Object.values(bindings)),
  ) as {
    send: () => Promise<void>;
    keydown: (event: {
      key: string;
      shiftKey: boolean;
      isComposing: boolean;
      preventDefault: () => void;
    }) => void;
    draftMessage: { value: string };
    replyingTo: { value: typeof reply | null };
    isSending: { value: boolean };
  };
  mounted.draftMessage.value = ' hello ';
  mounted.replyingTo.value = reply;
  return { ...mounted, sendResult, groupStore, authStore, notify, scrollToBottom };
}

it('clears the Suite composer at submit, while the send is still pending', async () => {
  const { send, sendResult, isSending, draftMessage, replyingTo, groupStore, scrollToBottom } =
    composer();
  const pending = send();
  expect(draftMessage.value).toBe('');
  expect(replyingTo.value).toBeNull();
  expect(isSending.value).toBe(true);
  expect(groupStore.sendMessage).toHaveBeenCalledWith('suite', 'hello', reply);
  draftMessage.value = 'next message';
  await send();
  expect(groupStore.sendMessage).toHaveBeenCalledOnce();
  expect(scrollToBottom).not.toHaveBeenCalled();
  sendResult.resolve('message');
  await pending;
  expect(draftMessage.value).toBe('next message');
  expect(isSending.value).toBe(false);
  expect(scrollToBottom).toHaveBeenCalledOnce();
});

it.each(['rejection', 'null result'])(
  'restores an untouched draft and reply on %s',
  async (failure) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { send, sendResult, draftMessage, replyingTo, isSending, notify } = composer();
    const pending = send();
    expect(draftMessage.value).toBe('');
    if (failure === 'rejection') sendResult.reject(new Error('offline'));
    else sendResult.resolve(null);
    await pending;
    expect(draftMessage.value).toBe(' hello ');
    expect(replyingTo.value).toEqual(reply);
    expect(isSending.value).toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
  },
);

it('does not restore over a draft the user typed and then erased while waiting', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { send, sendResult, draftMessage, replyingTo, notify } = composer();
  const pending = send();
  draftMessage.value = 'another draft';
  draftMessage.value = '';
  sendResult.reject(new Error('offline'));
  await pending;
  expect(draftMessage.value).toBe('');
  expect(replyingTo.value).toBeNull();
  expect(notify).toHaveBeenCalledOnce();
});

it.each(['Suite', 'account'])(
  'does not restore a failed send after the %s changes',
  async (scope) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { send, sendResult, groupStore, authStore, draftMessage, replyingTo, notify } =
      composer();
    const pending = send();
    if (scope === 'Suite') {
      groupStore.activeGroupId = 'other-suite';
      groupStore.activeGroupId = 'suite';
    } else {
      authStore.authOperationGeneration += 1;
    }
    draftMessage.value = 'new draft';
    sendResult.reject(new Error('old send'));
    await pending;
    expect(draftMessage.value).toBe('new draft');
    expect(replyingTo.value).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  },
);

it('leaves the draft alone when rate-limited or when Enter finishes IME composition', async () => {
  const { send, keydown, groupStore, draftMessage, notify } = composer();
  const preventDefault = vi.fn();
  keydown({ key: 'Enter', shiftKey: false, isComposing: true, preventDefault });
  expect(preventDefault).not.toHaveBeenCalled();
  groupStore.isRateLimited.mockReturnValue(true);
  await send();
  expect(draftMessage.value).toBe(' hello ');
  expect(groupStore.sendMessage).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledOnce();
});
