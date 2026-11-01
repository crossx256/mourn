import { describe, expect, it } from 'vitest';
import { createKeyedOpener } from '../src/utils/chatOpenGuard';

type Link = { id: string; status: string };

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** MessagingPage's openChat ⇄ activeLinkId watcher cycle, reduced to its core. */
function cycle(loads: string[]) {
  const state = { activeLinkId: null as string | null, selectedLink: null as Link | null };
  const pending: Array<() => void> = [];
  const watchers: Array<(id: string | null) => void> = [];
  const linksStore = { links: [{ id: 'a', status: 'ESTABLISHED' }] as Link[] };

  const opener = createKeyedOpener<Link>(async (link) => {
    state.selectedLink = link;
    // setActiveLink fires the page watcher on the next flush, like Vue.
    state.activeLinkId = link.id;
    for (const watch of watchers) pending.push(() => watch(link.id));
    loads.push(link.id);
    await flush();
    loads.push(link.id);
  });

  watchers.push((linkId) => {
    if (!linkId) return;
    if (state.selectedLink?.id === linkId) return;
    if (opener.isOpening(linkId)) return;
    const link = linksStore.links.find((l) => l.id === linkId);
    if (link) void opener.open(link);
  });

  const settle = async () => {
    for (let i = 0; i < 10; i += 1) {
      pending.shift()?.();
      await flush();
    }
  };

  return { state, opener, settle };
}

describe('M5 — one message load per conversation open', () => {
  it('loads once when a second open arrives during the in-flight load', async () => {
    const loads: string[] = [];
    const { opener, settle } = cycle(loads);
    const first = opener.open({ id: 'a', status: 'ESTABLISHED' });
    // The interleaving the audit described: another caller reaches openChat's
    // load while the first is suspended on its await.
    const second = opener.open({ id: 'a', status: 'ESTABLISHED' });
    await Promise.all([first, second]);
    await settle();
    expect(loads).toEqual(['a', 'a']); // one load, two phases
  });

  it('keeps the activeLinkId watcher from re-opening the conversation it just opened', async () => {
    const loads: string[] = [];
    const { state, opener, settle } = cycle(loads);
    await opener.open({ id: 'a', status: 'ESTABLISHED' });
    await settle();
    expect(state.activeLinkId).toBe('a');
    expect(loads).toEqual(['a', 'a']);
  });

  it('lets a later open run again once the previous one settled', async () => {
    const loads: string[] = [];
    const { opener, settle } = cycle(loads);
    await opener.open({ id: 'a', status: 'ESTABLISHED' });
    await settle();
    await opener.open({ id: 'a', status: 'ESTABLISHED' });
    await settle();
    expect(loads).toEqual(['a', 'a', 'a', 'a']);
    expect(opener.isOpening('a')).toBe(false);
  });

  it('releases the key when the open rejects, so a retry is not swallowed', async () => {
    let calls = 0;
    const opener = createKeyedOpener<{ id: string }>(async () => {
      calls += 1;
      throw new Error('boom');
    });
    await expect(opener.open({ id: 'a' })).rejects.toThrow('boom');
    expect(opener.isOpening('a')).toBe(false);
    await expect(opener.open({ id: 'a' })).rejects.toThrow('boom');
    expect(calls).toBe(2);
  });
});
