import { useMemo, type CSSProperties } from 'react';
import { cx } from './cx';
import './Confetti.css';

const COLORS = ['#60a5fa', '#22d3ee', '#4ade80', '#c084fc', '#fbbf24', '#f472b6', '#ffffff'];

export interface ConfettiProps {
  /** Number of pieces (default 36). */
  count?: number;
  className?: string;
}

/** Golden-angle spread: looks random, renders the same every time. */
function makePieces(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const angle = ((i * 137.508) % 360) * (Math.PI / 180);
    const distance = 80 + ((i * 53) % 120);
    return {
      '--x': `${Math.round(Math.cos(angle) * distance)}px`,
      '--y': `${Math.round(Math.sin(angle) * distance * 0.75)}px`,
      '--r': `${((i * 97) % 720) - 360}deg`,
      '--d': `${(i % 6) * 30}ms`,
      '--c': COLORS[i % COLORS.length],
    } as CSSProperties;
  });
}

/**
 * One-shot CSS confetti burst from the center of the nearest positioned parent.
 * Re-fire it by changing its `key`. Hidden for prefers-reduced-motion.
 */
export function Confetti({ count = 36, className }: ConfettiProps) {
  const pieces = useMemo(() => makePieces(count), [count]);
  return (
    <div className={cx('confetti', className)} aria-hidden="true">
      {pieces.map((style, i) => (
        <i key={i} className={`confetti-piece confetti-shape-${i % 3}`} style={style} />
      ))}
    </div>
  );
}
