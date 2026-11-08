import type { CSSProperties } from 'react';
import { cx } from './cx';

export interface SkeletonProps {
  /** 'line' (text row, default), 'card' (63:88 card picture) or 'circle'. */
  shape?: 'line' | 'card' | 'circle';
  width?: number | string;
  height?: number | string;
  className?: string;
}

const SHAPES: Record<NonNullable<SkeletonProps['shape']>, CSSProperties> = {
  line: { height: '1em', width: '100%' },
  card: { width: '100%', aspectRatio: '63 / 88', borderRadius: '4.8% / 3.4%' },
  circle: { width: 44, height: 44, borderRadius: '50%' },
};

/** Shimmering placeholder block. Decorative: pair it with visible loading copy. */
export function Skeleton({ shape = 'line', width, height, className }: SkeletonProps) {
  const style: CSSProperties = { ...SHAPES[shape] };
  if (width !== undefined) style.width = width;
  if (height !== undefined) style.height = height;
  return <span className={cx('skeleton', className)} style={style} aria-hidden="true" />;
}
