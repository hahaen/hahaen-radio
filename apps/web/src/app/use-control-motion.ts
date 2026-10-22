import { useEffect, type RefObject } from 'react';

/** Decorative feedback follows input without changing playback or layout. */
export function useControlMotion(ref: RefObject<HTMLElement | null>, powerSave: boolean) {
  useEffect(() => {
    const controls = ref.current;
    if (!controls) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const animations = new Set<Animation>();
    let frame = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      for (const animation of animations) animation.cancel();
      animations.clear();
    };
    const enabled = () => !powerSave && !document.hidden && !reduced.matches;
    const update = () => {
      controls.dataset.controlsMotion = String(enabled());
      if (!enabled()) stop();
    };
    const feedback = (event: MouseEvent) => {
      if (!enabled() || !(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>('button[data-control-motion]');
      if (!button || !controls.contains(button) || button.disabled) return;
      stop();
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!enabled() || !controls.contains(button)) return;
        const icon = button.querySelector('svg');
        if (!icon || typeof icon.animate !== 'function') return;
        const direction = button.dataset.controlMotion;
        const accent =
          direction === 'next'
            ? 'translateX(3px)'
            : direction === 'previous'
              ? 'translateX(-3px)'
              : 'scale(1.12)';
        const animation = icon.animate(
          [{ transform: 'none' }, { transform: accent, offset: 0.4 }, { transform: 'none' }],
          { duration: 260, easing: 'ease-out' },
        );
        animations.add(animation);
        animation.onfinish = () => animations.delete(animation);
      });
    };
    update();
    controls.addEventListener('click', feedback);
    document.addEventListener('visibilitychange', update);
    reduced.addEventListener('change', update);
    return () => {
      stop();
      delete controls.dataset.controlsMotion;
      controls.removeEventListener('click', feedback);
      document.removeEventListener('visibilitychange', update);
      reduced.removeEventListener('change', update);
    };
  }, [ref, powerSave]);
}
