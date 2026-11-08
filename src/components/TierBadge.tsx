import { useStrings, type Strings } from '../lib/i18n';
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

/** Short tier names: `useStrings(TIER_LABELS)(tier)`. */
export const TIER_LABELS: Strings<ValueTier> = {
  ko: { common: '흔한 카드', nice: '좋은 카드', rare: '레어', super: '슈퍼 레어', treasure: '보물' },
  en: { common: 'Common', nice: 'Nice', rare: 'Rare', super: 'Super Rare', treasure: 'Treasure' },
};

const CHEERS: Strings<ValueTier> = {
  ko: {
    common: '흔한 카드예요',
    nice: '좋은 카드예요!',
    rare: '레어 발견!',
    super: '슈퍼 레어 등장!',
    treasure: '보물이에요! 소중히 보관해요!',
  },
  en: {
    common: 'A common card',
    nice: 'Nice card!',
    rare: 'Rare find!',
    super: 'Super rare!',
    treasure: 'Treasure! Keep it safe!',
  },
};

export interface TierBadgeProps {
  tier: ValueTier;
  /** Longer, excited copy for the result screen ("💎 Rare find!"). */
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
