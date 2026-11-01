/**
 * "This link leaves the recognised platforms" warning, shared by every surface that
 * renders user links (the classic icon row and the v2 link list).
 *
 * Why a composable: both call sites must behave IDENTICALLY — a recognised link navigates
 * natively, an unrecognised one opens a dialog that prints the full destination and only
 * continues if the visitor chooses to. Duplicating that logic is how the two surfaces would
 * drift apart (and one of them would quietly stop warning).
 *
 * Rules:
 *   • recognised links are left completely alone — no dialog, no interception
 *   • the destination is shown in full, and the confirm action is a real anchor with
 *     rel="noopener noreferrer" (so the warning is never the thing that breaks the link)
 *   • middle/aux clicks on an unrecognised link are ignored rather than hijacked
 *   • nothing here runs during SSR: the dialog only opens from a user event
 */

import { ref, useId, type Ref } from 'vue';

export interface ExternalLinkWarning {
  /** Dialog visibility. */
  showWarning: Ref<boolean>;
  /** The destination awaiting confirmation (also what the dialog prints). */
  pendingUrl: Ref<string>;
  /** Stable ids so the dialog can be labelled for screen readers. */
  titleId: string;
  descriptionId: string;
  /** Call from click/auxclick/keydown. Returns false when the caller should keep the default. */
  activate: (event: Event, url: string | null | undefined, recognized: boolean) => void;
  /** Clear the pending destination (dialog hidden). */
  reset: () => void;
}

export function useExternalLinkWarning(): ExternalLinkWarning {
  const showWarning = ref(false);
  const pendingUrl = ref('');
  const titleId = useId();
  const descriptionId = useId();

  function activate(event: Event, url: string | null | undefined, recognized: boolean) {
    if (recognized || !url) return;
    // A middle/right click opens a new tab/window: not ours to intercept.
    // `MouseEvent` is absent outside a DOM (SSR / the DOM-free test environment), so it is
    // checked by name rather than assumed to exist.
    const isMouseEvent = typeof MouseEvent !== 'undefined' && event instanceof MouseEvent;
    if (isMouseEvent && (event as MouseEvent).button > 1) return;
    event.preventDefault();
    pendingUrl.value = url;
    showWarning.value = true;
  }

  function reset() {
    pendingUrl.value = '';
    showWarning.value = false;
  }

  return { showWarning, pendingUrl, titleId, descriptionId, activate, reset };
}
