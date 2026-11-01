import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * H4: the "randomize file names" privacy toggle.
 *
 * What it does (verified in src/crypto/blobTransfer.ts): the uploaded blob is
 * opaque ciphertext with no name; the only filename transport is the E2EE message
 * metadata the sender and recipient can read. So the toggle replaces the name
 * everywhere a participant or the UI sees it — it does not and cannot alter file
 * contents. The old UI promised "original name is not stored" (false: it lives on
 * in the user's own file system and in the in-flight transfer log) and was the
 * only preference reset by logout while describing itself as account-scoped.
 *
 * The decision recorded here is: keep the feature, make every claim true, and
 * stop resetting it implicitly.
 */

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

describe('randomize-file-names toggle is truthful', () => {
  it('does not claim the original name is erased', () => {
    const privacy = read('components/dashboard/PrivacyTab.vue');
    expect(privacy).not.toMatch(/original name is not stored/i);
    expect(privacy).toMatch(/random identifier/i);
    // It must say what it does NOT do, so nobody reads it as content anonymisation.
    expect(privacy).toMatch(/contents (?:are )?not (?:altered|changed)|file contents are unchanged/i);
  });

  it('describes the scope it really has (this device)', () => {
    const privacy = read('components/dashboard/PrivacyTab.vue');
    expect(privacy).not.toMatch(/this setting is stored in your user\s+preferences/i);
    expect(privacy).toMatch(/on this device/i);
  });

  it('is not silently reset by logout', () => {
    const store = read('stores/dashboard.ts');
    const reset = store.split('$reset()')[1]?.split('\n    },\n')[0] ?? '';
    expect(reset).not.toContain('randomizeFileNames = false');
  });

  it('keeps reading the value before any upload path runs', () => {
    // Both senders and the attachment queue resolve names through one helper, and
    // the setting is loaded before the messaging page hydrates its lists.
    for (const path of ['pages/MessagingPage.vue', 'components/suites/GroupChatWindow.vue', 'stores/messaging.ts']) {
      expect(read(path)).toMatch(/resolveUploadFileName\(|generateRandomFileName\(/);
    }
    const page = read('pages/MessagingPage.vue');
    const mount = page.split('onMounted(async () => {')[1]?.split('const vaultEstablishment = (async')[0] ?? '';
    expect(mount).toContain('dashboardStore.hydrateRandomizeFileNames()');
  });

  it('shows the randomised name in the transfer UI, never the original', () => {
    // encryptAndUploadBlob is deliberately handed the renamed File, so its
    // transfer entry (and the toast) can only ever show the random name.
    const page = read('pages/MessagingPage.vue');
    expect(page).toMatch(/encryptAndUploadBlob\(upload,/);
    const suite = read('components/suites/GroupChatWindow.vue');
    expect(suite).toMatch(/encryptAndUploadBlob\(\s*uploadFile,/);
  });
});
