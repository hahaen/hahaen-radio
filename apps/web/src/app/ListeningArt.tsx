import { useEffect, useRef } from 'react';
import type { ImmersionEffect } from '../library/model';
import type { createImmersionScene } from '../graphics/immersion-scene';
import styles from './controls.module.css';

export function ListeningArt({
  mode,
  playing,
  powerSave,
}: {
  mode: ImmersionEffect;
  playing: boolean;
  powerSave: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<ReturnType<typeof createImmersionScene> | null>(null);
  const latest = useRef({ mode, playing, powerSave });
  useEffect(() => {
    latest.current = { mode, playing, powerSave };
    engine.current?.update(latest.current);
  }, [mode, playing, powerSave]);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let cancelled = false;
    let instance: ReturnType<typeof createImmersionScene> | undefined;
    void import('../graphics/immersion-scene')
      .then(({ createImmersionScene }) => {
        if (cancelled) return;
        instance = createImmersionScene(container, latest.current);
        engine.current = instance;
      })
      .catch(() => {
        if (!cancelled) container.dataset.rendered = 'false';
      });
    return () => {
      cancelled = true;
      instance?.destroy();
      if (engine.current === instance) engine.current = null;
    };
  }, []);
  return (
    <div
      ref={host}
      className={styles.artwork}
      data-effect={mode}
      data-playing={playing}
      data-still={powerSave}
      aria-hidden="true"
    >
      <svg
        className={styles.sceneFallback}
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
      >
        {mode === 'dunes' ? (
          Array.from({ length: 6 }, (_, i) => (
            <path
              key={i}
              d={`M-200 ${460 + i * 65} Q250 ${200 + i * 65} 700 ${420 + i * 45} T1800 ${330 + i * 70} V1000 H-200Z`}
              fill={['#254434', '#203e30', '#1a3329', '#142a22', '#0f221b', '#0a1914'][i]}
            />
          ))
        ) : mode === 'ocean' ? (
          <>
            <ellipse cx="850" cy="420" rx="700" ry="60" fill="#6eab8a" opacity=".18" />
            {Array.from({ length: 18 }, (_, i) => (
              <path
                key={i}
                d={`M${180 + i * 20} ${450 + i * i} Q800 ${430 + i * i} ${1450 - i * 20} ${450 + i * i}`}
                stroke="#91aaa0"
                strokeWidth={0.7 + i * 0.12}
                opacity={0.2 - i * 0.008}
                fill="none"
              />
            ))}
          </>
        ) : (
          Array.from({ length: 6 }, (_, i) => (
            <path
              key={i}
              d={`M-200 ${410 + i * 16} C260 ${50 + i * 25} 800 ${550 - i * 15} 1800 ${160 + i * 24}`}
              stroke={i % 2 ? '#6ba889' : '#8bbe9f'}
              strokeWidth={20 + i * 6}
              opacity={0.12 - i * 0.012}
              fill="none"
            />
          ))
        )}
      </svg>
    </div>
  );
}
