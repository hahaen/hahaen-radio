import { useEffect } from 'react';
import { applicationPath } from './paths';

/** A small playback signal, not an audio spectrum. */
export function usePlaybackFavicon(playing: boolean, powerSave: boolean) {
  useEffect(() => {
    if (!playing || powerSave) return;
    const icons = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'));
    if (!icons.length) return;
    const originals = icons.map((icon) => ({
      icon,
      href: icon.getAttribute('href'),
      type: icon.getAttribute('type'),
      sizes: icon.getAttribute('sizes'),
    }));
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let disposed = false;
    let timer: number | undefined;
    let frames: string[] = [];
    let frame = 0;
    const restore = () => {
      for (const { icon, ...attributes } of originals) {
        for (const [name, value] of Object.entries(attributes)) {
          if (value === null) icon.removeAttribute(name);
          else icon.setAttribute(name, value);
        }
      }
    };
    const draw = () => {
      const href = frames[frame % frames.length];
      if (!href) return;
      for (const icon of icons) {
        icon.type = 'image/png';
        icon.sizes.value = '32x32';
        icon.href = href;
      }
      frame += 1;
    };
    const sync = () => {
      window.clearInterval(timer);
      timer = undefined;
      if (disposed) return;
      if (motion.matches) {
        restore();
        return;
      }
      if (!frames.length) return;
      draw();
      // Background tabs retain a still playback signal without a running timer.
      if (!document.hidden) timer = window.setInterval(draw, 240);
    };
    const source = new Image();
    source.onload = () => {
      if (disposed) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const context = canvas.getContext('2d');
        if (!context) return;
        frames = Array.from({ length: 12 }, (_, index) => {
          context.clearRect(0, 0, 32, 32);
          context.drawImage(source, 0, 0, 32, 32);
          context.fillStyle = '#E89B82';
          for (let bar = 0; bar < 3; bar += 1) {
            const height = 3 + 4 * (0.5 + 0.5 * Math.sin((index * Math.PI) / 6 + bar * 2));
            context.beginPath();
            context.roundRect(10 + bar * 5, 30 - height, 3, height, 1.5);
            context.fill();
          }
          return canvas.toDataURL('image/png');
        });
        sync();
      } catch {
        // A failed image decode or restricted canvas leaves the original icons intact.
        restore();
      }
    };
    source.src = applicationPath('haen-favicon-v2.png');
    motion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      disposed = true;
      source.onload = null;
      window.clearInterval(timer);
      motion.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
      restore();
    };
  }, [playing, powerSave]);
}
