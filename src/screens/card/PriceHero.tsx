import type { CSSProperties } from 'react';
import { cx } from '../../components/cx';
import { Money } from '../../components/Money';
import { TierBadge } from '../../components/TierBadge';
import { fmtRelativeTime, useStrings, useUiLang, type Strings } from '../../lib/i18n';
import { isApproxPrice } from '../../lib/pricing';
import { useSettings } from '../../lib/store';
import type { CardVariant, PriceSummary, ValueTier } from '../../lib/types';
import { rangeView, trendOf, type Trend } from './format';

type Key =
  | 'market'
  | 'asking'
  | 'marker'
  | 'askingMarker'
  | 'lowNow'
  | 'highest'
  | 'usual'
  | Trend
  | 'cardmarketUsd'
  | 'cardmarketKrw'
  | 'noSales'
  | 'mixedMirror'
  | 'sourceChecked'
  | 'mysteryTitle'
  | 'mysteryText'
  | 'rareText'
  | 'ebayBelow'
  | 'ebaySee'
  | 'to';

const STRINGS: Strings<Key> = {
  ko: {
    market: '시세',
    asking: '파는 사람이 부른 가격',
    marker: '시세',
    askingMarker: '부른 가격',
    lowNow: '지금 파는 최저가',
    highest: '최고가',
    usual: '보통 가격',
    up: '요즘 올랐어요',
    down: '요즘 내렸어요',
    cardmarketUsd: 'Cardmarket (유로 → 달러 환산)',
    cardmarketKrw: 'Cardmarket (유로 → 원 환산)',
    noSales: 'TCGplayer · 최근 거래 없음',
    mixedMirror: '{source} · 미러 무늬 전체 평균',
    sourceChecked: '{when} 확인 · {source}',
    mysteryTitle: '아직 가격이 없어요',
    mysteryText: '수수께끼 카드! 아래 eBay에서 찾아볼 수 있어요.',
    rareText: '드문 무늬예요. 보통 다른 무늬보다 비싸요.',
    ebayBelow: 'eBay 가격은 아래에 있어요',
    ebaySee: '아래에서 eBay 가격 보기',
    to: '~',
  },
  en: {
    market: 'Market price',
    asking: 'Asking price',
    marker: 'Market',
    askingMarker: 'Asking',
    lowNow: 'Lowest for sale now',
    highest: 'Highest',
    usual: 'Usual prices',
    up: 'Up lately',
    down: 'Down lately',
    cardmarketUsd: 'Cardmarket (€ → $)',
    cardmarketKrw: 'Cardmarket (€ → ₩)',
    noSales: 'TCGplayer · no recent sales',
    mixedMirror: '{source} · all mirror patterns together',
    sourceChecked: '{source} · checked {when}',
    mysteryTitle: 'No price yet',
    mysteryText: 'This card is still a mystery! Try eBay below.',
    rareText: 'This pattern is rare. It’s usually worth more than the others.',
    ebayBelow: 'eBay prices are below',
    ebaySee: 'See eBay prices below',
    to: '–',
  },
};

export interface PriceHeroProps {
  /** The selected printing. Without a market price the panel shows the no-price state. */
  variant: Pick<CardVariant, 'summary' | 'tcgplayer'>;
  tier: ValueTier | null;
  /** Name of the selected printing, shown next to "시세" when the card has several. */
  variantName?: string;
  /** id of the eBay panel further down: adds a small "eBay 가격은 아래에 있어요 ↓" button that scrolls to it. */
  ebayTarget?: string;
  /** Show every amount as approximate whatever its source (Korean-card route: it is the Japanese card's price). */
  approx?: boolean;
  /** The price is Cardmarket's number for all mirror patterns of the card together (printing.isMixedMirror). */
  mixedMirror?: boolean;
  /** No price, and it is the rare pattern of a card whose other printings have one (printing.isRarePattern). */
  rarePattern?: boolean;
  /** No count-up: an invisible copy that is only there to be measured (CardScreen sizes the art for the tallest panel). */
  still?: boolean;
}

/** Elements that must be readable on the first view carry this attribute (CardScreen sizes the art to fit them). */
export const FOLD_ATTR = 'data-card-fold';
const fold = { [FOLD_ATTR]: '' };

/**
 * Low–high range under the big number (format.rangeView). "지금 파는 최저가" … "최고가" only when both ends are
 * TCGplayer's own cheapest and dearest listing; otherwise one "보통 가격" label: Cardmarket's recent averages, or ends
 * the summary replaced (a 1-cent stray listing, a 999 placeholder).
 * The bar is a static picture of where 시세 sits (a small "시세" tag on it), not a control. When 시세 is at one
 * end, a bar would only pin the tag to it: then just the two numbers ("4,760원 ~ 9,000원").
 */
function PriceRange({ variant, summary, approx }: { variant: PriceHeroProps['variant']; summary: PriceSummary; approx: boolean }) {
  const t = useStrings(STRINGS);
  const view = rangeView(summary, variant.tcgplayer);
  if (view.kind === 'none') return null;

  if (view.kind === 'single') {
    return (
      <p className="card-range-single" {...fold}>
        <span className="caption muted">{t('lowNow')}</span>
        <Money usd={view.low} approx={approx} className="card-range-value" />
      </p>
    );
  }

  const ends = view.labels === 'ends';
  return (
    <div className={cx('card-range', !ends && 'card-range-usual')} {...fold}>
      {ends ? (
        <>
          <span className="caption muted card-range-label-low">{t('lowNow')}</span>
          <span className="caption muted card-range-label-high">{t('highest')}</span>
        </>
      ) : (
        <span className="caption muted card-range-label">{t('usual')}</span>
      )}
      <Money usd={view.low} approx={approx} className="card-range-value card-range-low" />
      {view.marker === null ? (
        <span className="card-range-to" aria-hidden="true">
          {t('to')}
        </span>
      ) : (
        <span className="card-range-track" aria-hidden="true">
          <span className="card-range-dot" style={{ '--pos': view.marker } as CSSProperties}>
            {t(summary.asking ? 'askingMarker' : 'marker')}
          </span>
        </span>
      )}
      <Money usd={view.high} approx={approx} className="card-range-value card-range-high" />
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
 * An asking price (TCGplayer listings, no recent sales) is called that and shown as approximate. Without a price:
 * the mystery panel, with the way down to eBay.
 */
export function PriceHero({ variant, tier, variantName, ebayTarget, approx: forceApprox, mixedMirror, rarePattern, still }: PriceHeroProps) {
  const t = useStrings(STRINGS);
  const lang = useUiLang();
  const { currency } = useSettings();
  const { summary } = variant;

  if (!summary || summary.market === null) {
    return (
      <section className="surface card-price card-price-empty center">
        <span className="card-mystery" aria-hidden="true">
          🔍
        </span>
        <h2 className="h2">{t('mysteryTitle')}</h2>
        {/* The last thing that must be readable on the first view carries FOLD_ATTR: the art is sized for it. */}
        <p className="small muted card-mystery-text" {...(ebayTarget ? {} : fold)}>
          {t(rarePattern ? 'rareText' : 'mysteryText')}
        </p>
        {ebayTarget && (
          <button type="button" className="card-ebay-jump card-ebay-jump-empty" onClick={() => goTo(ebayTarget)}>
            <span className="card-ebay-jump-text" {...fold}>
              {t('ebaySee')}
              <span aria-hidden="true"> ↓</span>
            </span>
          </button>
        )}
      </section>
    );
  }

  const { market, changePct } = summary;
  const approx = !!forceApprox || isApproxPrice(summary);
  // The ends of an asking price's range are real listings: exact, unlike the headline picked from them.
  const rangeApprox = !!forceApprox || summary.converted;
  const trend = trendOf(changePct);
  const seller = summary.asking
    ? t('noSales')
    : summary.source === 'tcgplayer'
      ? 'TCGplayer'
      : t(currency === 'KRW' ? 'cardmarketKrw' : 'cardmarketUsd');
  const source = mixedMirror ? t('mixedMirror', { source: seller }) : seller;
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
            {t(summary.asking ? 'asking' : 'market')}
            {variantName && <span className="card-price-variant"> · {variantName}</span>}
          </h2>
          {trend && (
            <p className={cx('card-trend', `card-trend-${trend}`)}>
              <span className="card-trend-words">{t(trend)}</span>
              <b className="card-trend-pct tabular">
                {trend === 'up' ? '▲' : '▼'}
                {Math.round(Math.abs(changePct ?? 0))}%
              </b>
            </p>
          )}
        </div>
        <Money usd={market} approx={approx} secondary animate={!still} className="price-xl card-price-value" />
      </div>
      <PriceRange variant={variant} summary={summary} approx={rangeApprox} />
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
      <p className="caption muted card-price-source">{when ? t('sourceChecked', { source, when }) : source}</p>
    </section>
  );
}
