import { afterEach, expect, it, vi } from 'vitest';
import { connectShortcuts, type ShortcutActions } from './shortcuts';
let off = () => {};
afterEach(() => {
  off();
  document.body.replaceChildren();
});
function setup() {
  const actions = Object.fromEntries(
    ['toggle', 'previous', 'next', 'search', 'favorite', 'pin', 'mute', 'enter', 'escape'].map(
      (key) => [key, vi.fn()],
    ),
  ) as unknown as ShortcutActions;
  off = connectShortcuts(actions);
  return actions;
}
const key = (target: Element, value: string, extra: KeyboardEventInit = {}) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra }),
  );
it('handles intentional page shortcuts once while preserving composition, modifiers and repeated keys', () => {
  const actions = setup();
  key(document.body, 'F');
  expect(actions.favorite).toHaveBeenCalledOnce();
  key(document.body, 'f', { isComposing: true });
  key(document.body, 'f', { repeat: true });
  key(document.body, 'f', { ctrlKey: true });
  expect(actions.favorite).toHaveBeenCalledOnce();
  key(document.body, 'Enter');
  key(document.body, 'Escape');
  expect(actions.enter).toHaveBeenCalledOnce();
  expect(actions.escape).toHaveBeenCalledOnce();
  expect(() => key(document.body, 'constructor')).not.toThrow();
});
it('preserves text fields, native controls, modal scope and canvas-owned arrow keys', () => {
  const actions = setup();
  const input = document.createElement('input'),
    button = document.createElement('button'),
    canvas = document.createElement('canvas'),
    dialog = document.createElement('dialog');
  document.body.append(input, button, canvas, dialog);
  key(input, 'f');
  key(button, ' ');
  key(button, 'Enter');
  expect(actions.favorite).not.toHaveBeenCalled();
  expect(actions.toggle).not.toHaveBeenCalled();
  expect(actions.enter).not.toHaveBeenCalled();
  canvas.addEventListener('keydown', (event) => event.stopPropagation());
  key(canvas, 'ArrowRight');
  expect(actions.next).not.toHaveBeenCalled();
  dialog.open = true;
  key(document.body, 'm');
  expect(actions.mute).not.toHaveBeenCalled();
  dialog.open = false;
  key(document.body, 'm');
  expect(actions.mute).toHaveBeenCalledOnce();
});
