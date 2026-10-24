export function connectFocusInput() {
  const root = document.documentElement;
  const pointer = (event: PointerEvent) => {
    root.toggleAttribute(
      'data-touch-focus',
      event.pointerType === 'touch' || event.pointerType === 'pen',
    );
  };
  const keyboard = (event: KeyboardEvent) => {
    if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing)
      root.removeAttribute('data-touch-focus');
  };
  document.addEventListener('pointerdown', pointer, true);
  document.addEventListener('keydown', keyboard, true);
  return () => {
    document.removeEventListener('pointerdown', pointer, true);
    document.removeEventListener('keydown', keyboard, true);
    root.removeAttribute('data-touch-focus');
  };
}
