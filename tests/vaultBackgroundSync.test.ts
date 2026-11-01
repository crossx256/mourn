// tests/vaultBackgroundSync.test.ts
// The vault must establish in the background. Opening the app or the messaging
// page may never be gated on a sync the user did not ask for: the page used to
// render a full-pane "SYNCING ACROSS DEVICES" blocker (and later a strip) driven
// by a page-level ref, which is exactly the wait krul asked to remove. Guard the
// property, not the wording of one implementation.
//
// Run: npx vitest run tests/vaultBackgroundSync.test.ts

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page = readFileSync(resolve(__dirname, '../src/pages/MessagingPage.vue'), 'utf8');
const mobileRuntime = readFileSync(resolve(__dirname, '../src/boot/mobileRuntime.ts'), 'utf8');

describe('messaging page never blocks on vault sync', () => {
  it('has no sync overlay, strip, or page-level establishing state', () => {
    expect(page).not.toContain('SYNCING ACROSS DEVICES');
    expect(page).not.toContain('vault-establishing-overlay');
    expect(page).not.toContain('vault-sync-strip');
    expect(page).not.toMatch(/const vaultEstablishing = ref\(/);
  });

  it('still establishes the vault in the background (not awaited by mount)', () => {
    expect(page).toMatch(/const vaultEstablishment = \(async \(\) => \{/);
    expect(page).toMatch(/vaultStore\.beginBatchSync\(\(\) => vaultStore\.initialize\(\)\)/);
    // Fire-and-forget: onMounted must not await establishment.
    expect(page).toMatch(/void vaultEstablishment;/);
  });

  it('reads locally stored threads without waiting for the vault', () => {
    // `messagesReady` must not depend on the vault: the stored thread is plain
    // ClientMessage rows from IndexedDB, so gating it on isInitialized puts a
    // loader over messages that are already on disk.
    expect(page).toMatch(/const messagesReady = computed/);
    const messagesReadyBlock = page.slice(
      page.indexOf('const messagesReady = computed'),
      page.indexOf('const vaultMessages = computed'),
    );
    expect(messagesReadyBlock).not.toContain('isInitialized');
    expect(messagesReadyBlock).toContain("messageLoadState[id] === 'ready'");

    // Opening a chat loads from local storage directly, no init gate in front.
    const openChatBlock = page.slice(
      page.indexOf('async function openChat'),
      page.indexOf('async function openChat') + 4000,
    );
    expect(openChatBlock).toContain('vaultStore.loadMessages(link.id)');
    expect(openChatBlock).not.toContain('vaultStore.initialize()');
  });

  it('still holds only the send path on vault readiness', () => {
    // The composer stays usable while the vault is cold; only send waits, because
    // encrypting genuinely needs the keys.
    expect(page).toMatch(
      /const isSendBlocked = computed\(\(\) => isChatUnavailable\.value \|\| !vaultStore\.isInitialized\)/,
    );
  });
});

describe('mobile resume warms the vault before messaging is opened', () => {
  it('kicks a background establishment when logged in and cold', () => {
    expect(mobileRuntime).toMatch(/appStateChange/);
    expect(mobileRuntime).toMatch(
      /if \(authStore\.isLoggedIn && !vaultStore\.isInitialized\) \{\s*void vaultStore\.initialize\(\)/,
    );
  });
});
