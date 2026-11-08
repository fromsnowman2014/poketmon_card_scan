// Pure numbers behind the My Cards screen (kept apart from React so they are unit-tested).
import { valueTier } from '../../lib/pricing';
import type { CollectionItem, ValueTier } from '../../lib/types';

export type SortKey = 'price' | 'newest' | 'name';
export type MilestoneId = 'first' | 'ten' | 'rare' | 'treasure';

export interface Milestone {
  id: MilestoneId;
  earned: boolean;
  /** Cards so far / cards needed, for count milestones that are still locked. */
  progress?: { have: number; need: number };
}

const RARE_USD = 5;
const TREASURE_USD = 100;
const TEN = 10;

/** Number of physical cards (quantities included). */
export function cardCount(items: readonly CollectionItem[]): number {
  return items.reduce((n, i) => n + i.qty, 0);
}

/** Cards per value tier, quantities included; cards without a price are left out (see `unpricedCount`). */
export function tierCounts(items: readonly CollectionItem[]): Record<ValueTier, number> {
  const counts: Record<ValueTier, number> = { common: 0, nice: 0, rare: 0, super: 0, treasure: 0 };
  for (const i of items) if (i.priceUsd !== null) counts[valueTier(i.priceUsd)] += i.qty;
  return counts;
}

export function unpricedCount(items: readonly CollectionItem[]): number {
  return cardCount(items.filter((i) => i.priceUsd === null));
}

/** The most valuable card, if any card has a price. */
export function bestItem(items: readonly CollectionItem[]): CollectionItem | undefined {
  let best: CollectionItem | undefined;
  for (const i of items) if (i.priceUsd !== null && (!best || i.priceUsd > (best.priceUsd ?? 0))) best = i;
  return best;
}

/** The stalest price check: "updated 3 days ago" is true for every card once this is recent. */
export function oldestUpdate(items: readonly CollectionItem[]): string | undefined {
  return items.reduce<string | undefined>(
    (min, i) => (!min || i.priceUpdatedAt < min ? i.priceUpdatedAt : min),
    undefined,
  );
}

/** Badges worked out from the cards themselves, so removing cards or resetting the app keeps them honest. */
export function milestones(items: readonly CollectionItem[]): Milestone[] {
  const count = cardCount(items);
  const top = bestItem(items)?.priceUsd ?? 0;
  return [
    { id: 'first', earned: count >= 1 },
    { id: 'ten', earned: count >= TEN, progress: count < TEN ? { have: count, need: TEN } : undefined },
    { id: 'rare', earned: top >= RARE_USD },
    { id: 'treasure', earned: top >= TREASURE_USD },
  ];
}

/**
 * price: highest first, cards without a price last; newest: most recently added first;
 * name: alphabetical by `nameOf` (the name shown to the kid) in the UI language's order.
 */
export function sortItems(
  items: readonly CollectionItem[],
  key: SortKey,
  nameOf: (item: CollectionItem) => string,
  locale: string,
): CollectionItem[] {
  const list = [...items];
  if (key === 'price') return list.sort((a, b) => (b.priceUsd ?? -1) - (a.priceUsd ?? -1));
  if (key === 'newest') return list.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  return list.sort((a, b) => collator.compare(nameOf(a), nameOf(b)));
}
