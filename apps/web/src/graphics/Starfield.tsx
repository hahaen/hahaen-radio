import { useEffect, useId, useRef } from 'react';
import styles from './starfield.module.css';

// Fixed positions keep the sky still across playback and selection updates.
const stars = Array.from({ length: 210 }, (_, index) => {
  const seed = Math.sin((index + 1) * 127.1) * 43758.5453;
  const value = seed - Math.floor(seed);
  return {
    x: (index * 61.803398875 + 3.7) % 100,
    y: (index * 37.172 + value * 23) % 100,
    radius: 0.45 + value * 0.7,
    opacity: 0.18 + value * 0.42,
  };
});
const beacons = [
  [8, 28],
  [22, 19],
  [32, 43],
  [17, 60],
  [42, 12],
  [86, 37],
  [94, 58],
  [89, 76],
];

export function Starfield({ animated }: { animated: boolean }) {
  const haloId = useId();
  const sky = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const visibility = () => {
      if (sky.current) sky.current.dataset.visible = String(!document.hidden);
    };
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, []);
  return (
    <svg
      ref={sky}
      className={styles.starfield}
      width="100%"
      height="100%"
      aria-hidden="true"
      focusable="false"
      data-animated={animated}
    >
      <defs>
        <radialGradient id={haloId}>
          <stop stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="0.25" stopColor="currentColor" stopOpacity="0.09" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className={styles.distantStars} fill="currentColor">
        {stars.map((star, index) => (
          <circle
            key={index}
            cx={`${star.x}%`}
            cy={`${star.y}%`}
            r={star.radius}
            opacity={star.opacity}
          />
        ))}
      </g>
      <g className={styles.beacons}>
        {beacons.map(([x, y], index) => (
          <svg key={index} x={`${x}%`} y={`${y}%`} width="18" height="18" overflow="visible">
            <circle r="12" fill={`url(#${haloId})`} />
            <path
              d="M0-5.5 .65-.65 5.5 0 .65.65 0 5.5-.65.65-5.5 0-.65-.65Z"
              fill="currentColor"
              opacity={index % 3 === 0 ? 0.7 : 0.42}
            />
            <circle r="0.9" fill="currentColor" opacity="0.9" />
          </svg>
        ))}
      </g>
    </svg>
  );
}
