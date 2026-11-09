import { cx } from '../../components/cx';
import { Money } from '../../components/Money';
import { TierBadge } from '../../components/TierBadge';
import { fmtRelativeTime, useStrings, useUiLang, type Strings } from '../../lib/i18n';
import { useSettings } from '../../lib/store';
import type { PriceSummary, ValueTier } from '../../lib/types';
import { rangePosition, trendOf, type Trend } from './format';

type Key =
  | 'market'
  | 'lowNow'
  | 'highest'
  | 'recent'
  | Trend
  | 'cardmarketUsd'
  | 'cardmarketKrw'
  | 'sourceUpdated'
  | 'mysteryTitle'
  | 'mysteryText';

const STRINGS: Strings<Key> = {
  ko: {
    market: '시세',
    lowNow: '지금 파는 최저가',
    highest: '최고가',
    recent: '요즘 거래 가격',
    up: '요즘 올랐어요',
    down: '요즘 내렸어요',
    cardmarketUsd: 'Cardmarket (유로 → 달러 환산)',
    cardmarketKrw: 'Cardmarket (유로 → 원 환산)',
    sourceUpdated: '{when} 업데이트 · {source}',
    mysteryTitle: '아직 가격이 없어요',
    mysteryText: '수수께끼 카드! 아래 eBay에서 찾아볼 수 있어요.',
  },
  en: {
    market: 'Market price',
    lowNow: 'Lowest for sale now',
    highest: 'Highest',
    recent: 'Recent prices',
    up: 'Up lately',
    down: 'Down lately',
    cardmarketUsd: 'Cardmarket (€ → $)',
    cardmarketKrw: 'Cardmarket (€ → ₩)',
    sourceUpdated: '{source} · updated {when}',
    mysteryTitle: 'No price yet',
    mysteryText: 'This card is still a mystery! Try eBay below.',
  },
};

export interface PriceHeroProps {
  /** Selected variant's summary; null (or no market) shows the mystery state. */
  summary: PriceSummary | null;
  tier: ValueTier | null;
  /** Name of the selected printing, shown next to "시세" when the card has several. */
  variantName?: string;
}

/**
 * Low–high range under the big number. TCGplayer: the cheapest listing for sale now and the highest price.
 * Cardmarket (converted, mostly JA/KO cards): recent sale averages, so one "요즘 거래 가격" label and ≈ on both.
 * The bar is a static picture of where 시세 sits, not a control.
 */
function PriceRange({ summary }: { summary: PriceSummary }) {
  const t = useStrings(STRINGS);
  const { market, low, high, converted } = summary;
  const tcg = summary.source === 'tcgplayer';
  if (market === null) return null;

  if (low === null || high === null || !(high > low)) {
    // No spread to draw. A TCGplayer listing price still answers "how cheap can I buy it now".
    if (!tcg || low === null) return null;
    return (
      <p className="card-range-single">
        <span className="caption muted">{t('lowNow')}</span>
        <Money usd={low} className="card-range-value" />
      </p>
    );
  }

  return (
    <div className={cx('card-range', !tcg && 'card-range-recent')}>
      {tcg ? (
        <>
          <span className="caption muted card-range-label-low">{t('lowNow')}</span>
          <span className="caption muted card-range-label-high">{t('highest')}</span>
        </>
      ) : (
        <span className="caption muted card-range-label">{t('recent')}</span>
      )}
      <Money usd={low} approx={converted} className="card-range-value card-range-low" />
      <span className="card-range-track" aria-hidden="true">
        <span className="card-range-dot" style={{ left: `${rangePosition(low, high, market) * 100}%` }} />
      </span>
      <Money usd={high} approx={converted} className="card-range-value card-range-high" />
    </div>
  );
}

/** The big number: tier cheer, market price (+ other currency), a calm trend pill, the price range and source. */
export function PriceHero({ summary, tier, variantName }: PriceHeroProps) {
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

  const { market, changePct, converted } = summary;
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
      <div className="card-price-main center">
        <h2 className="card-price-label">
          {t('market')}
          {variantName && <span className="card-price-variant"> · {variantName}</span>}
        </h2>
        <Money usd={market} approx={converted} secondary animate className="price-xl card-price-value" />
      </div>
      {trend && (
        <p className={cx('card-trend', `card-trend-${trend}`)}>
          {t(trend)}
          <b className="card-trend-pct tabular">
            {trend === 'up' ? '▲' : '▼'}
            {Math.round(Math.abs(changePct ?? 0))}%
          </b>
        </p>
      )}
      <PriceRange summary={summary} />
      <p className="caption muted card-price-source">{when ? t('sourceUpdated', { source, when }) : source}</p>
    </section>
  );
}
