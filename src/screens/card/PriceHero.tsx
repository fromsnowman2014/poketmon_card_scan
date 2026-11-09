import type { CSSProperties } from 'react';
import { cx } from '../../components/cx';
import { Money } from '../../components/Money';
import { TierBadge } from '../../components/TierBadge';
import { fmtRelativeTime, useStrings, useUiLang, type Strings } from '../../lib/i18n';
import { useSettings } from '../../lib/store';
import type { PriceSummary, ValueTier } from '../../lib/types';
import { rangeMarker, trendOf, type Trend } from './format';

type Key =
  | 'market'
  | 'marker'
  | 'lowNow'
  | 'highest'
  | 'recent'
  | Trend
  | 'cardmarketUsd'
  | 'cardmarketKrw'
  | 'sourceUpdated'
  | 'mysteryTitle'
  | 'mysteryText'
  | 'ebayBelow'
  | 'to';

const STRINGS: Strings<Key> = {
  ko: {
    market: '시세',
    marker: '시세',
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
    ebayBelow: 'eBay 가격은 아래에 있어요',
    to: '~',
  },
  en: {
    market: 'Market price',
    marker: 'Market',
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
    ebayBelow: 'eBay prices are below',
    to: '–',
  },
};

export interface PriceHeroProps {
  /** Selected variant's summary; null (or no market) shows the mystery state. */
  summary: PriceSummary | null;
  tier: ValueTier | null;
  /** Name of the selected printing, shown next to "시세" when the card has several. */
  variantName?: string;
  /** id of the eBay panel further down: adds a small "eBay 가격은 아래에 있어요 ↓" button that scrolls to it. */
  ebayTarget?: string;
}

/** Elements that must be readable on the first view carry this attribute (CardScreen sizes the art to fit them). */
export const FOLD_ATTR = 'data-card-fold';
const fold = { [FOLD_ATTR]: '' };

/**
 * Low–high range under the big number. TCGplayer: the cheapest listing for sale now and the highest price.
 * Cardmarket (converted, mostly JA/KO cards): recent sale averages, so one "요즘 거래 가격" label and ≈ on both.
 * The bar is a static picture of where 시세 sits (a small "시세" tag on it), not a control. When 시세 is at one
 * end, a bar would only pin the tag to it: then just the two numbers ("4,760원 ~ 9,000원").
 */
function PriceRange({ summary }: { summary: PriceSummary }) {
  const t = useStrings(STRINGS);
  const { market, low, high, converted } = summary;
  const tcg = summary.source === 'tcgplayer';
  if (market === null) return null;
  const marker = low === null || high === null ? null : rangeMarker(low, high, market);

  if (low === null || high === null || !(high > low)) {
    // No spread to draw. A TCGplayer listing price still answers "how cheap can I buy it now".
    if (!tcg || low === null) return null;
    return (
      <p className="card-range-single" {...fold}>
        <span className="caption muted">{t('lowNow')}</span>
        <Money usd={low} className="card-range-value" />
      </p>
    );
  }

  return (
    <div className={cx('card-range', !tcg && 'card-range-recent')} {...fold}>
      {tcg ? (
        <>
          <span className="caption muted card-range-label-low">{t('lowNow')}</span>
          <span className="caption muted card-range-label-high">{t('highest')}</span>
        </>
      ) : (
        <span className="caption muted card-range-label">{t('recent')}</span>
      )}
      <Money usd={low} approx={converted} className="card-range-value card-range-low" />
      {marker === null ? (
        <span className="card-range-to" aria-hidden="true">
          {t('to')}
        </span>
      ) : (
        <span className="card-range-track" aria-hidden="true">
          <span className="card-range-dot" style={{ '--pos': marker } as CSSProperties}>
            {t('marker')}
          </span>
        </span>
      )}
      <Money usd={high} approx={converted} className="card-range-value card-range-high" />
    </div>
  );
}

/** Scrolls to the eBay panel and moves focus to its heading (for keyboards and screen readers). */
function goTo(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  target.querySelector<HTMLElement>('h2, h3')?.focus({ preventScroll: true });
}

/**
 * The big number: tier cheer, "시세" with a calm trend pill beside it, the market price (+ other currency), the
 * price range and source. The pill shares the label's row so the range stays above the tab bar on an iPhone SE.
 */
export function PriceHero({ summary, tier, variantName, ebayTarget }: PriceHeroProps) {
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
      <div className="card-price-main center" {...fold}>
        <div className="card-price-head">
          <h2 className="card-price-label">
            {t('market')}
            {variantName && <span className="card-price-variant"> · {variantName}</span>}
          </h2>
          {trend && (
            <p className={cx('card-trend', `card-trend-${trend}`)}>
              {t(trend)}
              <b className="card-trend-pct tabular">
                {trend === 'up' ? '▲' : '▼'}
                {Math.round(Math.abs(changePct ?? 0))}%
              </b>
            </p>
          )}
        </div>
        <Money usd={market} approx={converted} secondary animate className="price-xl card-price-value" />
      </div>
      <PriceRange summary={summary} />
      {ebayTarget && (
        // Part of the first view (its text carries FOLD_ATTR, so the art leaves room for it): kids should know
        // eBay prices are further down without scrolling. CSS draws it under the source line; on phones up to 800px
        // tall (iPhone SE) it comes first, right under the low–high row, and the source line follows it.
        <button type="button" className="card-ebay-jump" onClick={() => goTo(ebayTarget)}>
          <span className="card-ebay-jump-text" {...fold}>
            {t('ebayBelow')}
            <span aria-hidden="true"> ↓</span>
          </span>
        </button>
      )}
      <p className="caption muted card-price-source">{when ? t('sourceUpdated', { source, when }) : source}</p>
    </section>
  );
}
