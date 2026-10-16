import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLibrary, LIBRARY_PREFIX } from '../library/store';
import { createSleepController, formatRemaining } from './sleep';
const cleanups: (() => void)[] = [];
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  for (const off of cleanups.splice(0)) off();
  vi.useRealTimers();
});
function setup() {
  const library = createLibrary(),
    pause = vi.fn(),
    controller = createSleepController(library, pause);
  cleanups.push(library.attach(), controller.attach());
  return { library, pause, controller };
}
it('expires by its deadline, pauses once, and stops all timers after expiry', async () => {
  const { library, pause, controller } = setup();
  library.setSleep(15);
  expect(formatRemaining(controller.store.getState().remaining)).toBe('15:00');
  await vi.advanceTimersByTimeAsync(15 * 60000);
  await vi.advanceTimersByTimeAsync(1);
  expect(pause).toHaveBeenCalledTimes(1);
  expect(controller.store.getState()).toEqual({ active: false, remaining: 0, expired: true });
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(pause).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it('distinguishes cancellation in another tab from expiry even before its storage event arrives', async () => {
  const { library, pause, controller } = setup();
  library.setSleep(15);
  const other = createLibrary();
  other.setSleep(0);
  await vi.advanceTimersByTimeAsync(15 * 60000);
  expect(pause).not.toHaveBeenCalled();
  expect(controller.store.getState().active).toBe(false);
  library.setSleep(15);
  other.setSleep(60);
  await vi.advanceTimersByTimeAsync(15 * 60000);
  expect(pause).not.toHaveBeenCalled();
  expect(controller.store.getState().remaining).toBe(45 * 60);
});
it('makes expiry visible to both tabs and rechecks a suspended clock on resume', async () => {
  const first = setup(),
    second = setup();
  first.library.setSleep(15);
  window.dispatchEvent(
    new StorageEvent('storage', { key: LIBRARY_PREFIX + 'sleep', storageArea: localStorage }),
  );
  await vi.advanceTimersByTimeAsync(16);
  vi.setSystemTime(20 * 60000);
  window.dispatchEvent(new Event('pageshow'));
  expect(first.pause).toHaveBeenCalledTimes(1);
  expect(second.pause).toHaveBeenCalledTimes(1);
  expect(second.controller.store.getState().expired).toBe(true);
});
it('keeps sleep usable without persistent storage and releases its active timer on detach', () => {
  const library = createLibrary({
    storage: () => {
      throw new Error('denied');
    },
  });
  const pause = vi.fn(),
    controller = createSleepController(library, pause),
    off = controller.attach();
  library.setSleep(30);
  expect(controller.store.getState().active).toBe(true);
  off();
  expect(vi.getTimerCount()).toBe(0);
  expect(pause).not.toHaveBeenCalled();
});
