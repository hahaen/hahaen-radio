import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectIdleImmersion } from './idle';
let off = () => {};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => {
  off();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('requires 30 visible idle seconds and restarts on activity without creating per-event timers', async () => {
  const enter = vi.fn();
  off = connectIdleImmersion(enter, () => true);
  await vi.advanceTimersByTimeAsync(29000);
  window.dispatchEvent(new Event('pointermove'));
  await vi.advanceTimersByTimeAsync(29000);
  expect(enter).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(enter).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(1);
  off();
  expect(vi.getTimerCount()).toBe(0);
});
it('does not steal focus from editing or enter while playback is paused or a panel is open', async () => {
  const enter = vi.fn(),
    input = document.createElement('input'),
    dialog = document.createElement('dialog');
  document.body.append(input, dialog);
  let playing = false;
  off = connectIdleImmersion(enter, () => playing);
  await vi.advanceTimersByTimeAsync(31000);
  playing = true;
  input.focus();
  await vi.advanceTimersByTimeAsync(31000);
  input.blur();
  dialog.open = true;
  await vi.advanceTimersByTimeAsync(31000);
  expect(enter).not.toHaveBeenCalled();
  dialog.open = false;
  await vi.advanceTimersByTimeAsync(30000);
  expect(enter).toHaveBeenCalledOnce();
});
