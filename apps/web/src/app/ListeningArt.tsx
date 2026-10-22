import { useEffect, useId, useRef } from 'react';
import type { ImmersionEffect } from '../library/model';
import type { createImmersionScene } from '../graphics/immersion-scene';
import styles from './controls.module.css';

const portraitRidges = Array.from({ length: 5 }, (_, layer) => {
  const points = Array.from({ length: 81 }, (_, step) => {
    const x = step / 80;
    const phase = x * 2.8 + layer * 3.7;
    const ridge =
      0.045 * Math.sin(phase * 2.1 + layer) +
      0.02 * Math.sin(phase * 4.8 + layer * 1.4) +
      0.008 * Math.sin(phase * 13 + layer * 2) +
      0.004 * Math.sin(phase * 29 + layer);
    return `${step === 0 ? 'M' : 'L'}${(x * 390).toFixed(1)} ${((0.3 + layer * 0.056 - ridge) * 844).toFixed(1)}`;
  });
  return points.join(' ') + 'V844H0Z';
});

export function ListeningArt({
  mode,
  playing,
  powerSave,
}: {
  mode: ImmersionEffect;
  playing: boolean;
  powerSave: boolean;
}) {
  const gradientId = useId();
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
      {mode !== 'aurora' && (
        <svg
          className={`${styles.sceneFallback} ${styles.portraitFallback}`}
          viewBox="0 0 390 844"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="var(--color-secondary)" stopOpacity=".10" />
              <stop offset="1" stopColor="var(--color-bg)" />
            </linearGradient>
          </defs>
          <circle cx="281" cy="194" r="8" fill="var(--color-text)" opacity=".72" />
          {mode === 'ocean' ? (
            <>
              <path d="M0 329H390V844H0Z" fill={`url(#${gradientId})`} />
              <path d="M0 329H390" stroke="var(--color-secondary)" opacity=".28" />
              {Array.from({ length: 32 }, (_, i) => {
                const y = 333 + i * i * 0.25;
                const half = (3 + i * 0.9) * (0.5 + 0.5 * Math.sin(i * 1.7) ** 2);
                const x = 281 + Math.sin(i * 2.4) * (4 + i * 0.3);
                return (
                  <path
                    key={i}
                    d={`M${x - half} ${y}q${half} -1 ${half * 2} 0`}
                    fill="none"
                    stroke="var(--color-secondary)"
                    strokeWidth={0.7 + i * 0.025}
                    opacity={0.38 - i * 0.009}
                  />
                );
              })}
            </>
          ) : (
            portraitRidges.map((ridge, i) => (
              <path
                key={i}
                d={ridge}
                fill={`color-mix(in srgb, var(--color-secondary) ${28 - i * 6}%, var(--color-bg))`}
              />
            ))
          )}
        </svg>
      )}
      <svg
        className={`${styles.sceneFallback} ${styles.wideFallback}`}
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
      >
        {mode === 'dunes' ? (
          Array.from({ length: 6 }, (_, i) => (
            <path
              key={i}
              d={`M-200 ${460 + i * 65} Q250 ${200 + i * 65} 700 ${420 + i * 45} T1800 ${330 + i * 70} V1000 H-200Z`}
              fill={`color-mix(in srgb, var(--color-surface) ${100 - i * 16}%, var(--color-bg))`}
            />
          ))
        ) : mode === 'ocean' ? (
          <>
            <ellipse
              cx="850"
              cy="420"
              rx="700"
              ry="60"
              fill="var(--color-secondary)"
              opacity=".08"
            />
            {Array.from({ length: 18 }, (_, i) => (
              <path
                key={i}
                d={`M${180 + i * 20} ${450 + i * i} Q800 ${430 + i * i} ${1450 - i * 20} ${450 + i * i}`}
                stroke="var(--color-secondary)"
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
              stroke={i % 2 ? 'var(--color-surface)' : 'var(--color-secondary)'}
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
