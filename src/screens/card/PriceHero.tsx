import { cx } from '../../components/cx';
import { Money } from '../../components/Money';
import { TierBadge } from '../../components/TierBadge';
import { fmtRelativeTime, useStrings, useUiLang, type Strings } from '../../lib/i18n';
import { useSettings } from '../../lib/store';
import type { PriceSummary, ValueTier } from '../../lib/types';
import { rangePosition, trendOf, type Trend } from './format';

type Key =
  | 'market'
  | 'low'
  | 'high'
  | Trend
  | 'cardmarketUsd'
  | 'cardmarketKrw'
  | 'updated'
  | 'mysteryTitle'
  | 'mysteryText';

const STRINGS: Strings<Key> = {
  ko: {
    market: '시세',
    low: '최저',
    high: '최고',
    up: '▲ {n}% 올랐어요',
    down: '▼ {n}% 내렸어요',
    steady: '그대로예요',
    cardmarketUsd: 'Cardmarket (유로 → 달러 환산)',
    cardmarketKrw: 'Cardmarket (유로 → 원 환산)',
    updated: '업데이트 {when}',
    mysteryTitle: '아직 가격이 없어요',
    mysteryText: '수수께끼 카드! 아래 eBay에서 찾아볼 수 있어요.',
  },
  en: {
    market: 'Market price',
    low: 'Low',
    high: 'High',
    up: '▲ Up {n}%',
    down: '▼ Down {n}%',
    steady: 'Steady',
    cardmarketUsd: 'Cardmarket (€ → $)',
    cardmarketKrw: 'Cardmarket (€ → ₩)',
    updated: 'updated {when}',
    mysteryTitle: 'No price yet',
    mysteryText: 'This card is still a mystery! Try eBay below.',
  },
};

export interface PriceHeroProps {
  /** Selected variant's summary; null (or no market) shows the mystery state. */
  summary: PriceSummary | null;
  tier: ValueTier | null;
}

/** The big number: tier cheer, market price (+ other currency), low–high range, trend and source. */
export function PriceHero({ summary, tier }: PriceHeroProps) {
  const t = useStrings(STRINGS);
  const lang = useUiLang();
  const { currency } = useSettings();

  if (!summary || summary.market === null) {
    return (
      <section className="surface card-price card-price-empty center stack-8">
        <span className="card-mystery" aria-hidden="true">
          🔍
        </span>
        <h2 className="h2">{t('mysteryTitle')}</h2>
        <p className="small muted">{t('mysteryText')}</p>
      </section>
    );
  }

  const { market, low, high, changePct, converted } = summary;
  const trend = trendOf(changePct);
  const source =
    summary.source === 'tcgplayer' ? 'TCGplayer' : t(currency === 'KRW' ? 'cardmarketKrw' : 'cardmarketUsd');
  const when = summary.updated ? fmtRelativeTime(summary.updated, lang) : '';

  return (
    <section className={cx('surface card-price center', tier && `card-price-tiered tier-${tier}`)}>
      {tier && (
        <div className="card-tier">
          <TierBadge tier={tier} cheer size="lg" className="pop-in" />
        </div>
      )}
      <div className="stack-4 center">
        <h2 className="card-price-label">{t('market')}</h2>
        <Money usd={market} approx={converted} secondary animate className="price-xl card-price-value" />
      </div>
      {trend && (
        <span className={cx('card-trend', `card-trend-${trend}`)}>
          {t(trend, { n: Math.round(Math.abs(changePct ?? 0)) })}
        </span>
      )}
      {low !== null && high !== null && high > low && (
        <div className="card-range">
          <div className="card-range-track" aria-hidden="true">
            <span className="card-range-dot" style={{ left: `${rangePosition(low, high, market) * 100}%` }} />
          </div>
          <div className="row-between card-range-ends">
            <span>
              <span className="muted">{t('low')} </span>
              <Money usd={low} />
            </span>
            <span>
              <span className="muted">{t('high')} </span>
              <Money usd={high} />
            </span>
          </div>
        </div>
      )}
      <p className="caption muted card-price-source">
        {when ? `${source} · ${t('updated', { when })}` : source}
      </p>
    </section>
  );
}
