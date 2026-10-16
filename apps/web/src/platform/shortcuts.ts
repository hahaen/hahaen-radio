export interface ShortcutActions {
  toggle(): void;
  previous(): void;
  next(): void;
  view(): void;
  search(): void;
  favorite(): void;
  pin(): void;
  mute(): void;
  enter(): void;
  escape(): void;
}
export function connectShortcuts(actions: ShortcutActions, target: EventTarget = window) {
  const handle = (event: Event) => {
    const key = event as KeyboardEvent;
    if (
      key.defaultPrevented ||
      key.isComposing ||
      key.keyCode === 229 ||
      key.repeat ||
      key.altKey ||
      key.ctrlKey ||
      key.metaKey
    )
      return;
    if (document.querySelector('dialog[open]')) return;
    const element = key.target instanceof Element ? key.target : null;
    if (
      element?.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="slider"]',
      )
    )
      return;
    if ((key.key === ' ' || key.key === 'Enter') && element?.closest('button,a,summary')) return;
    const bindings = {
      ' ': 'toggle',
      ArrowLeft: 'previous',
      ArrowUp: 'previous',
      ArrowRight: 'next',
      ArrowDown: 'next',
      g: 'view',
      '/': 'search',
      f: 'favorite',
      l: 'pin',
      m: 'mute',
      Enter: 'enter',
      Escape: 'escape',
    };
    const normalized = key.key.length === 1 ? key.key.toLowerCase() : key.key;
    const action = Object.hasOwn(bindings, normalized)
      ? (bindings[normalized as keyof typeof bindings] as keyof ShortcutActions)
      : undefined;
    if (action) {
      key.preventDefault();
      actions[action]();
    }
  };
  target.addEventListener('keydown', handle);
  return () => target.removeEventListener('keydown', handle);
}
