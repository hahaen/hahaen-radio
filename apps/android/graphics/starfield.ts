const svgNamespace = 'http://www.w3.org/2000/svg';

function element<Tag extends keyof SVGElementTagNameMap>(
  tag: Tag,
  attributes: Record<string, string>,
): SVGElementTagNameMap[Tag] {
  const node = document.createElementNS(svgNamespace, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

/** The fixed night sky remains independent of the globe's camera and touch surface. */
export function createStarfield(host: HTMLElement) {
  const sky = element('svg', {
    class: 'starfield',
    width: '100%',
    height: '100%',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  sky.style.display = 'none';
  const definitions = element('defs', {});
  const halo = element('radialGradient', { id: 'haen-star-halo' });
  for (const [offset, opacity] of [
    ['0', '0.18'],
    ['0.25', '0.045'],
    ['1', '0'],
  ] as const) {
    halo.append(
      element('stop', {
        offset,
        'stop-color': 'currentColor',
        'stop-opacity': opacity,
      }),
    );
  }
  definitions.append(halo);
  sky.append(definitions);

  const distant = element('g', { class: 'distant-stars', fill: 'currentColor' });
  // Match the existing sky's stable distribution; playback never reseeds positions.
  for (let index = 0; index < 210; index++) {
    const seed = Math.sin((index + 1) * 127.1) * 43758.5453;
    const value = seed - Math.floor(seed);
    distant.append(
      element('circle', {
        cx: `${(index * 61.803398875 + 3.7) % 100}%`,
        cy: `${(index * 37.172 + value * 23) % 100}%`,
        r: String(0.4 + value * 0.55),
        opacity: String(0.12 + value * 0.29),
      }),
    );
  }
  sky.append(distant);

  const beacons = element('g', { class: 'star-beacons' });
  const positions = [
    [8, 28],
    [22, 19],
    [32, 43],
    [17, 60],
    [42, 12],
    [86, 37],
    [94, 58],
    [89, 76],
  ] as const;
  for (const [index, [x, y]] of positions.entries()) {
    const beacon = element('svg', {
      x: `${x}%`,
      y: `${y}%`,
      width: '18',
      height: '18',
      overflow: 'visible',
    });
    beacon.append(
      element('circle', { r: '9', fill: 'url(#haen-star-halo)' }),
      element('path', {
        d: 'M0-3.5 .28-.28 3.5 0 .28.28 0 3.5-.28.28-3.5 0-.28-.28Z',
        fill: 'currentColor',
        opacity: index % 3 === 0 ? '0.26' : '0.16',
      }),
      element('circle', { r: '0.65', fill: 'currentColor', opacity: '0.76' }),
    );
    beacons.append(beacon);
  }
  sky.append(beacons);
  host.prepend(sky);

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let visible = false;
  let animated = false;
  const refresh = () => {
    sky.style.display = visible ? '' : 'none';
    sky.dataset.animated = String(visible && animated && !document.hidden && !motion.matches);
  };
  document.addEventListener('visibilitychange', refresh);
  motion.addEventListener('change', refresh);

  return {
    update(options: { visible: boolean; animated: boolean }) {
      visible = options.visible;
      animated = options.animated;
      refresh();
    },
    destroy() {
      document.removeEventListener('visibilitychange', refresh);
      motion.removeEventListener('change', refresh);
      sky.remove();
    },
  };
}
