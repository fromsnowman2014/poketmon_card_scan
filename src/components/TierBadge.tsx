import { useCallback } from 'react';
import { useRates } from '../lib/fx';
import { useStrings, type Strings } from '../lib/i18n';
import { valueTier } from '../lib/pricing';
import { useSettings } from '../lib/store';
import type { ValueTier } from '../lib/types';
import { cx } from './cx';
import './TierBadge.css';

/** Lowest to highest. */
export const TIER_ORDER: readonly ValueTier[] = ['common', 'nice', 'rare', 'super', 'treasure'];

export const TIER_EMOJI: Record<ValueTier, string> = {
  common: '🍃',
  nice: '⭐',
  rare: '💎',
  super: '🔥',
  treasure: '👑',
};

/**
 * Short tier names: `useStrings(TIER_LABELS)(tier)`. Tiers are price bands (see pricing.valueTier), so they use
 * money words a kid can't mistake for the rarity printed on the card (커먼, 레어, 슈퍼 레어 …).
 */
export const TIER_LABELS: Strings<ValueTier> = {
  ko: { common: '동전 카드', nice: '과자값 카드', rare: '용돈 카드', super: '귀한 카드', treasure: '보물 카드' },
  en: { common: 'Pocket change', nice: 'Snack money', rare: 'Allowance', super: 'Prized', treasure: 'Treasure' },
};

/** Kind, upbeat lines for the result screen, cheap cards included. */
const CHEERS: Strings<ValueTier> = {
  ko: {
    common: '가격은 작아도 멋진 카드!',
    nice: '과자값 카드예요!',
    rare: '용돈 카드 발견!',
    super: '귀한 카드 등장!',
    treasure: '보물 카드예요! 소중히 보관해요!',
  },
  en: {
    common: 'Small price, still awesome!',
    nice: 'A snack-money card!',
    rare: 'An allowance-size find!',
    super: 'A prized card!',
    treasure: 'Treasure! Keep it safe!',
  },
};

/**
 * `(usd) => ValueTier` in the money the kid sees (settings.currency, live rates), so a tier always matches the number
 * on screen: a $0.80 card is 🍃 동전 카드 in dollars but ⭐ 과자값 카드 as 1,090원. Use it for every tier shown.
 */
export function useValueTier(): (usd: number | null | undefined) => ValueTier {
  const { currency } = useSettings();
  const rates = useRates();
  return useCallback((usd: number | null | undefined) => valueTier(usd, currency, rates), [currency, rates]);
}

export interface TierBadgeProps {
  tier: ValueTier;
  /** Longer, excited copy for the result screen ("💎 용돈 카드 발견!"). */
  cheer?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function TierBadge({ tier, cheer, size = 'md', className }: TierBadgeProps) {
  const label = useStrings(TIER_LABELS);
  const cheers = useStrings(CHEERS);
  return (
    <span className={cx('tier-badge', `tier-badge-${size}`, `tier-${tier}`, className)}>
      <span className="tier-badge-emoji" aria-hidden="true">
        {TIER_EMOJI[tier]}
      </span>
      {cheer ? cheers(tier) : label(tier)}
    </span>
  );
}
