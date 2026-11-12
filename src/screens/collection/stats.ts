// Pure numbers behind the My Cards screen (kept apart from React so they are unit-tested).
import type { Rates } from '../../lib/fx';
import { valueTier } from '../../lib/pricing';
import type { CollectionItem, DisplayCurrency, ValueTier } from '../../lib/types';

export type SortKey = 'price' | 'newest' | 'name';
export type MilestoneId = 'first' | 'ten' | 'rare' | 'treasure';

export interface Milestone {
  id: MilestoneId;
  earned: boolean;
  /** Cards so far / cards needed, for count milestones that are still locked. */
  progress?: { have: number; need: number };
  /**
   * For price milestones that are still locked: the lowest price (USD) that earns it in the money shown, e.g. 4.995
   * ("$5.00") in dollars or ≈3.68 ("5,000원") in won at 1,359원/$. Format it with formatMoney.
   */
  goalUsd?: number;
}

const TEN = 10;
/** Lowest to highest (TierBadge.TIER_ORDER; kept here so this file stays free of React). */
const RANK: Record<ValueTier, number> = { common: 0, nice: 1, rare: 2, super: 3, treasure: 4 };
/** Price milestones: the best card reaches this tier (or a higher one) in the money the kid sees. */
const PRICE_MILESTONES: readonly { id: MilestoneId; tier: ValueTier }[] = [
  { id: 'rare', tier: 'rare' },
  { id: 'treasure', tier: 'treasure' },
];

/** Number of physical cards (quantities included). */
export function cardCount(items: readonly CollectionItem[]): number {
  return items.reduce((n, i) => n + i.qty, 0);
}

/**
 * Cards per value tier in the money shown (`currency`, `rates`: see pricing.valueTier), quantities included; cards
 * without a price are left out (see `unpricedCount`).
 */
export function tierCounts(
  items: readonly CollectionItem[],
  currency: DisplayCurrency,
  rates: Rates,
): Record<ValueTier, number> {
  const counts: Record<ValueTier, number> = { common: 0, nice: 0, rare: 0, super: 0, treasure: 0 };
  for (const i of items) if (i.priceUsd !== null) counts[valueTier(i.priceUsd, currency, rates)] += i.qty;
  return counts;
}

/**
 * The lowest USD price that valueTier puts at `tier` (or higher) in `currency`: the "$5" / "5,000원" a kid needs for
 * a badge. Found from valueTier itself (it only rises with the price), so it always agrees with the tiers shown;
 * formatMoney of the result prints the threshold exactly ("$5.00", "5,000원"). 0 for 'common'.
 */
export function tierFloorUsd(tier: ValueTier, currency: DisplayCurrency, rates: Rates): number {
  const reaches = (usd: number) => RANK[valueTier(usd, currency, rates)] >= RANK[tier];
  if (reaches(0)) return 0;
  let lo = 0;
  let hi = 1;
  while (!reaches(hi) && hi < 1e9) [lo, hi] = [hi, hi * 2];
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (reaches(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
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

/**
 * The stalest price check: "updated 3 days ago" is true for every card once this is recent. Cards without a price
 * don't count: there is nothing to be out of date, and a check that finds no price leaves their time alone.
 */
export function oldestUpdate(items: readonly CollectionItem[]): string | undefined {
  return items.reduce<string | undefined>(
    (min, i) => (i.priceUsd !== null && (!min || i.priceUpdatedAt < min) ? i.priceUpdatedAt : min),
    undefined,
  );
}

/**
 * Badges worked out from the cards themselves, so removing cards or resetting the app keeps them honest. The price
 * badges follow the tiers in the money shown: 'rare' = a card at 💎 용돈 카드 or above ($5 / 5,000원), 'treasure' =
 * a 👑 보물 카드 ($100 / 150,000원). Locked price badges carry the price that earns them (`goalUsd`).
 */
export function milestones(items: readonly CollectionItem[], currency: DisplayCurrency, rates: Rates): Milestone[] {
  const count = cardCount(items);
  const best = bestItem(items);
  // valueTier only rises with the price, so the best card holds the highest tier.
  const top = best ? RANK[valueTier(best.priceUsd, currency, rates)] : -1;
  return [
    { id: 'first', earned: count >= 1 },
    { id: 'ten', earned: count >= TEN, progress: count < TEN ? { have: count, need: TEN } : undefined },
    ...PRICE_MILESTONES.map(({ id, tier }): Milestone => {
      const earned = top >= RANK[tier];
      return earned ? { id, earned } : { id, earned, goalUsd: tierFloorUsd(tier, currency, rates) };
    }),
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
