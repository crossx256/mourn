interface ScrollAreaLike {
  getScrollTarget?: () => Element | null;
}

export function scrollToHighlightedMessage(
  scrollArea: ScrollAreaLike | null | undefined,
  messageId: string,
): void {
  const target = scrollArea?.getScrollTarget?.() as HTMLElement | null;
  if (!target) return;

  const element = target.querySelector(
    `[data-msg-id="${CSS.escape(messageId)}"]`,
  ) as HTMLElement | null;
  if (!element) return;

  const containerRect = target.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const top =
    elementRect.top -
    containerRect.top +
    target.scrollTop -
    target.clientHeight / 2 +
    elementRect.height / 2;
  target.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });

  element.classList.remove('vault-msg--search-highlight');
  void element.offsetWidth;
  element.classList.add('vault-msg--search-highlight');
  window.setTimeout(() => element.classList.remove('vault-msg--search-highlight'), 2000);
}
