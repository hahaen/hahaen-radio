export function connectIdleImmersion(
  enter: () => void,
  canEnter: () => boolean,
  options: {
    window?: EventTarget;
    document?: Document;
    now?: () => number;
  } = {},
) {
  const browser = options.window ?? window,
    page = options.document ?? document,
    now = options.now ?? (() => Date.now());
  let last = now();
  const activity = () => {
    last = now();
  };
  const events = ['pointermove', 'pointerdown', 'keydown', 'scroll'];
  for (const event of events)
    browser.addEventListener(event, activity, { capture: true, passive: true });
  page.addEventListener('visibilitychange', activity);
  const timer = setInterval(() => {
    if (
      page.hidden ||
      !canEnter() ||
      page.querySelector('dialog[open]') ||
      page.activeElement?.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
      )
    ) {
      last = now();
      return;
    }
    if (now() - last >= 30000) {
      last = now();
      enter();
    }
  }, 1000);
  return () => {
    clearInterval(timer);
    for (const event of events) browser.removeEventListener(event, activity, true);
    page.removeEventListener('visibilitychange', activity);
  };
}
