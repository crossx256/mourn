import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import * as vue from 'vue';

/**
 * H2: a message report captured the picked thread into `messageContent` keyed to
 * whatever conversation the dropdown showed at submit time. If the reporter
 * opened the picker in chat A, then switched the dropdown to chat B, the ticket
 * went out as "report chat B" while quoting chat A's private messages — which
 * the reviewer cannot open. This executes the real <script setup> and asserts
 * the submitted payload can never mix the two.
 */
const base = new URL('../', import.meta.url);
const require = createRequire(fileURLToPath(new URL('../package.json', import.meta.url)));
const ts = require('typescript') as typeof import('typescript');
const sfc = require('@vue/compiler-sfc') as typeof import('@vue/compiler-sfc');

type Composer = {
  setType: (type: string) => void;
  setTargetKind: (kind: string) => void;
  selectedLinkId: { value: string };
  selectedCategory: { value: string };
  description: { value: string };
  messageContent: { value: string };
  canSubmit: { value: boolean };
  applyThreadSelection: (ids: string[]) => void;
  submit: () => Promise<void>;
};

function mountComposer() {
  const source = readFileSync(new URL('../src/components/tickets/TicketComposer.vue', import.meta.url), 'utf8');
  const { content } = sfc.compileScript(sfc.parse(source).descriptor, { id: 'composer' } as never);
  const code = ts.transpileModule(sfc.parse(source).descriptor.scriptSetup!.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  void content;

  const submissions: Array<Record<string, unknown>> = [];
  const stores = {
    tickets: {
      submitTicket: async (payload: Record<string, unknown>) => {
        submissions.push(payload);
        return { id: 'synthetic-ticket' };
      },
    },
    links: {
      links: [
        { id: 'A', senderId: 'reporter', receiverId: 'peer-a', status: 'ESTABLISHED', sender: { username: 'peer-a' }, receiver: { username: 'peer-a' } },
        { id: 'B', senderId: 'reporter', receiverId: 'peer-b', status: 'ESTABLISHED', sender: { username: 'peer-b' }, receiver: { username: 'peer-b' } },
      ],
      chatChains: [],
    },
    vault: {
      messages: {
        A: [{ id: 'A1', plaintext: 'synthetic A-only message', timestamp: 0, senderId: 'peer-a' }],
        B: [],
      },
    },
    groups: { groupsList: [] },
    graveyard: { approvedLetters: [] },
    auth: { user: { id: 'reporter' }, authOperationGeneration: 1 },
  };
  const mocks: Record<string, unknown> = {
    quasar: { Notify: { create: () => undefined } },
    'src/components/tickets/TicketThreadPicker.vue': {},
    'src/stores/tickets': { useTicketsStore: () => stores.tickets },
    'src/stores/links': { useLinksStore: () => stores.links },
    'src/stores/vault': { useVaultStore: () => stores.vault },
    'src/stores/groupStore': { useGroupStore: () => stores.groups },
    'src/stores/graveyard': { useGraveyardStore: () => stores.graveyard },
    'src/stores/auth': { useAuthStore: () => stores.auth },
    'src/types/ticket': {
      TICKET_DESCRIPTION_MIN: 10,
      MAX_TICKET_ATTACHMENTS: 5,
      SUPPORT_CATEGORIES: [],
      REPORT_CATEGORIES: ['harassment'],
      PROFILE_REPORT_CATEGORIES: [],
    },
  };
  const module = { exports: {} as Record<string, unknown> };
  const composer = runInNewContext(
    `(function(){ ${code};
      return { setType, setTargetKind, selectedLinkId, selectedCategory, description,
               messageContent, canSubmit, applyThreadSelection, submit }; })()`,
    {
      module,
      exports: module.exports,
      console: { ...console, warn: () => undefined },
      require: (id: string) => (id in mocks ? mocks[id] : require(id)),
      defineProps: () => ({ prefill: undefined }),
      withDefaults: (props: object, defaults: object) => ({ ...defaults, ...props }),
      defineEmits: () => () => undefined,
      URL,
      Blob,
      File,
    },
  ) as Composer;
  return { composer, submissions };
}

it('never quotes one conversation inside a report about another', async () => {
  const { composer, submissions } = mountComposer();
  composer.setType('report');
  composer.setTargetKind('message');
  composer.selectedLinkId.value = 'A';
  composer.selectedCategory.value = 'harassment';
  composer.description.value = 'synthetic report description';

  // Pick a message in chat A...
  composer.applyThreadSelection(['A1']);
  await vue.nextTick();
  expect(composer.messageContent.value).toContain('synthetic A-only message');

  // ...then decide the report is about chat B.
  composer.selectedLinkId.value = 'B';
  await vue.nextTick();

  expect(composer.messageContent.value).toBe('');
  expect(composer.canSubmit.value).toBe(false);

  // Submitting anyway (e.g. a stale click) must not send A's text under B.
  await composer.submit();
  for (const payload of submissions) {
    expect(payload).not.toMatchObject({ targetRef: 'B', messageContent: expect.stringContaining('A-only') });
  }
});

it('keeps the capture when the reporter stays in the same conversation', async () => {
  const { composer, submissions } = mountComposer();
  composer.setType('report');
  composer.setTargetKind('message');
  composer.selectedLinkId.value = 'A';
  composer.selectedCategory.value = 'harassment';
  composer.description.value = 'synthetic report description';
  composer.applyThreadSelection(['A1']);
  await vue.nextTick();
  // Re-selecting the same value must not clear what was just captured.
  composer.selectedLinkId.value = 'A';
  await vue.nextTick();
  expect(composer.messageContent.value).toContain('synthetic A-only message');
  await composer.submit();
  expect(submissions[0]).toMatchObject({ targetType: 'message', targetRef: 'A' });
  expect(String(submissions[0].messageContent)).toContain('synthetic A-only message');
});
