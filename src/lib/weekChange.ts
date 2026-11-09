import type { CollectionItem, ValueSnapshot } from './types';

export interface WeekChange {
  /** How much the prices of the cards saved both now and at the baseline moved, in USD (cents). */
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
 * Price change of My Cards against the snapshot closest to 7 days before `today`, preferring the older one on a tie
 * so "since last week" really spans a week. Only earlier days with per-card data count (snapshots saved before
 * `cards` existed are skipped).
 *
 * Only cards present in both count, each as min(qty now, qty then) × (price now − price then): adding or removing
 * cards (or copies) never shows as a rise or drop. null when there is no baseline or no card in common.
 */
export function weekChange(
  snapshots: readonly ValueSnapshot[],
  items: readonly Pick<CollectionItem, 'key' | 'priceUsd' | 'qty'>[],
  today: string,
): WeekChange | null {
  const now = dayNumber(today);
  let best: { cards: NonNullable<ValueSnapshot['cards']>; days: number } | undefined;
  for (const s of snapshots) {
    const days = Math.round(now - dayNumber(s.date));
    if (!(days >= 1) || !s.cards) continue;
    const off = Math.abs(days - 7);
    const bestOff = best ? Math.abs(best.days - 7) : Infinity;
    if (off < bestOff || (off === bestOff && best && days > best.days)) best = { cards: s.cards, days };
  }
  if (!best) return null;

  let delta = 0;
  let common = 0;
  for (const item of items) {
    const then = best.cards[item.key];
    if (!then || item.priceUsd === null) continue;
    common++;
    delta += Math.min(item.qty, then[1]) * (item.priceUsd - then[0]);
  }
  return common ? { deltaUsd: Math.round(delta * 100) / 100, days: best.days } : null;
}
