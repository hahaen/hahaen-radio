import { createStore } from 'zustand/vanilla';
import type { Library } from '../library/store';

export function formatRemaining(seconds: number) {
  return `${Math.floor(Math.max(0, seconds) / 60)
    .toString()
    .padStart(2, '0')}:${(Math.max(0, seconds) % 60).toString().padStart(2, '0')}`;
}
export function createSleepController(
  library: Library,
  pause: () => void,
  options: {
    now?: () => number;
    window?: EventTarget;
    document?: EventTarget;
  } = {},
) {
  const store = createStore(() => ({ active: false, remaining: 0, expired: false }));
  const now = options.now ?? (() => Date.now());
  let timer: ReturnType<typeof setInterval> | undefined,
    attached = false,
    handled: string | null = null;
  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  const check = () => {
    if (!attached) return;
    const value = library.store.getState().sleep;
    if (!value) {
      stopTimer();
      store.setState({ active: false, remaining: 0, expired: false });
      return;
    }
    if (value.expired) {
      stopTimer();
      if (handled !== value.id) {
        handled = value.id;
        pause();
      }
      store.setState({ active: false, remaining: 0, expired: true });
      return;
    }
    const remaining = Math.max(0, Math.ceil((value.deadline - now()) / 1000));
    if (!remaining) {
      library.expireSleep(value.id, now());
      return;
    }
    store.setState({ active: true, remaining, expired: false });
    timer ??= setInterval(check, 1000);
  };
  return {
    store,
    attach() {
      if (attached) throw new Error('SLEEP_ALREADY_ATTACHED');
      attached = true;
      const browser = options.window ?? window,
        page = options.document ?? document;
      const off = library.store.subscribe((state, previous) => {
        if (state.sleep !== previous.sleep) check();
      });
      browser.addEventListener('focus', check);
      browser.addEventListener('pageshow', check);
      page.addEventListener('visibilitychange', check);
      check();
      return () => {
        attached = false;
        stopTimer();
        off();
        browser.removeEventListener('focus', check);
        browser.removeEventListener('pageshow', check);
        page.removeEventListener('visibilitychange', check);
      };
    },
  };
}
