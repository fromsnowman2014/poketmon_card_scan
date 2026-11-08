import type { ValueSnapshot } from './types';

export interface WeekChange {
  /** Current total minus the baseline snapshot, in USD (cents). */
  deltaUsd: number;
  /** How many days before today the baseline snapshot was taken. */
  days: number;
}

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const pad = (n: number) => String(n).padStart(2, '0');

/** Today's local date as YYYY-MM-DD (the snapshot date format). */
export function todayLocal(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Change of `totalUsd` against the snapshot closest to 7 days before `today`, preferring the older one on a tie
 * so "since last week" really spans a week. Only earlier days count; null when there is none yet.
 */
export function weekChange(snapshots: readonly ValueSnapshot[], totalUsd: number, today: string): WeekChange | null {
  const now = dayNumber(today);
  let best: { totalUsd: number; days: number } | undefined;
  for (const s of snapshots) {
    const days = Math.round(now - dayNumber(s.date));
    if (!(days >= 1)) continue;
    const off = Math.abs(days - 7);
    const bestOff = best ? Math.abs(best.days - 7) : Infinity;
    if (off < bestOff || (off === bestOff && best && days > best.days)) best = { totalUsd: s.totalUsd, days };
  }
  if (!best) return null;
  return { deltaUsd: Math.round((totalUsd - best.totalUsd) * 100) / 100, days: best.days };
}
