import { cx } from '../../components/cx';
import { TIER_EMOJI, TIER_LABELS, TIER_ORDER } from '../../components/TierBadge';
import { useStrings, type Strings } from '../../lib/i18n';
import type { ValueTier } from '../../lib/types';

const STRINGS: Strings<'title' | 'mystery' | 'count'> = {
  ko: { title: '가격별 카드', mystery: '가격 없음', count: '{n}장' },
  en: { title: 'Cards by price', mystery: 'No price', count: '{n}' },
};

export interface TierBarProps {
  counts: Record<ValueTier, number>;
  /** Cards without a price yet. */
  unpriced: number;
}

/** Stacked bar of how many cards sit in each value tier, with an emoji legend. */
export function TierBar({ counts, unpriced }: TierBarProps) {
  const t = useStrings(STRINGS);
  const label = useStrings(TIER_LABELS);
  const shown = TIER_ORDER.filter((tier) => counts[tier] > 0);
  return (
    <section className="surface stack-12" aria-labelledby="collection-tiers">
      <h2 id="collection-tiers" className="h2">
        {t('title')}
      </h2>
      {shown.length > 0 && (
        <div className="collection-bar" aria-hidden="true">
          {shown.map((tier) => (
            <span key={tier} className={`tier-${tier}`} style={{ flexGrow: counts[tier] }} />
          ))}
        </div>
      )}
      <ul className="collection-legend">
        {TIER_ORDER.map((tier) => (
          <li key={tier} className={cx(`tier-${tier}`, counts[tier] === 0 && 'collection-legend-zero')}>
            <span aria-hidden="true">{TIER_EMOJI[tier]}</span>
            <span className="grow truncate">{label(tier)}</span>
            <b className="tier-text tabular">{t('count', { n: counts[tier] })}</b>
          </li>
        ))}
        {unpriced > 0 && (
          <li>
            <span aria-hidden="true">🔍</span>
            <span className="grow truncate">{t('mystery')}</span>
            <b className="tabular">{t('count', { n: unpriced })}</b>
          </li>
        )}
      </ul>
    </section>
  );
}
