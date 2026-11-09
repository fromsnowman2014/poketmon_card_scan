import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ExternalLink } from '../../components/ExternalLink';
import { Icon } from '../../components/Icon';
import { Money } from '../../components/Money';
import { moneyChars } from '../../components/moneyChars';
import { Skeleton } from '../../components/Skeleton';
import { ebayLinks, fetchEbaySummary } from '../../lib/ebay';
import { useRates } from '../../lib/fx';
import { useStrings, useUiLang, type Strings } from '../../lib/i18n';
import { formatMoney } from '../../lib/pricing';
import { useSettings } from '../../lib/store';
import type { Country, EbayListing, EbaySummary } from '../../lib/types';
import { auctionHeading, bidsText, shippingNote, timeLeft, withShipping } from './format';

type Key =
  | 'title'
  | 'buyNowFrom'
  | 'typical'
  | 'totalIncl'
  | ShipNote
  | 'startBid'
  | 'currentBid'
  | 'auctions'
  | 'buyNow'
  | 'sold'
  | 'opens';

const STRINGS: Strings<Key> = {
  ko: {
    title: 'eBay에서 보기',
    buyNowFrom: '지금 살 수 있는 최저가',
    typical: '보통 가격',
    totalIncl: '배송비 포함',
    fromUs: '미국 eBay 가격이에요 · 한국으로 받으면 배송비가 더 들어요',
    toKorea: '한국까지 오는 배송비로 계산했어요',
    startBid: '시작가',
    currentBid: '현재가',
    auctions: '경매 가격 보기',
    buyNow: '지금 살 수 있는 가격',
    sold: '팔린 가격 보기',
    opens: 'eBay 웹사이트가 열려요 · 어른과 함께 봐요',
  },
  en: {
    title: 'On eBay',
    buyNowFrom: 'Lowest buy-now price',
    typical: 'Typical price',
    totalIncl: 'incl. shipping',
    fromUs: 'Prices from eBay US · Shipping to Korea costs extra',
    toKorea: 'Shipping is priced to Korea',
    startBid: 'Starting bid',
    currentBid: 'Current bid',
    auctions: 'Auction prices',
    buyNow: 'Buy-now prices',
    sold: 'Sold prices',
    opens: 'Opens the eBay website · Look with a grown‑up',
  },
};

const MAX_AUCTIONS = 3;

/**
 * The shipping caveat under the panel heading, by where the kid lives (settings.country, not the UI language):
 * - a kid in the US: none (eBay US prices with US shipping are simply the prices);
 * - a kid in Korea with live prices the worker priced to Korea (shipTo 'KR'): "한국까지 오는 배송비로 계산했어요";
 * - a kid in Korea otherwise (links only, the worker failed, or an older worker that priced shipping to the US):
 *   "미국 eBay 가격이에요 · 한국으로 받으면 배송비가 더 들어요".
 * `live` is the worker's answer when it has prices to show, else null.
 */
export type ShipNote = 'fromUs' | 'toKorea';
export function shipNote(country: Country, live: Pick<EbaySummary, 'shipTo'> | null): ShipNote | null {
  if (country !== 'KR') return null;
  return live?.shipTo === 'KR' ? 'toKorea' : 'fromUs';
}

/** True when the worker's answer has something to show: a Buy It Now price or an auction the worker kept. */
export function hasLivePrices(summary: EbaySummary): boolean {
  return summary.buyNow.lowest !== null || summary.auctions.items.length > 0;
}

/**
 * --ebay-chars for the two Buy It Now numbers: the wider of the two amounts as shown (moneyChars), so both columns
 * get one font size ("4,760원" next to "123,400원" shrinks both, not just the long one).
 */
export function statChars(amounts: readonly (number | null)[], format: (usd: number) => string): number {
  const widths = amounts.filter((usd): usd is number => usd !== null).map((usd) => moneyChars(format(usd)));
  return widths.length ? Math.max(...widths) : 8;
}

/**
 * undefined while loading, null when the worker failed (we then just show the links). Refetches when the kid's
 * country changes: Korean and US answers differ (shipping, and which listings ship there).
 */
function useEbaySummary(workerUrl: string, query: string, country: Country): EbaySummary | null | undefined {
  const [summary, setSummary] = useState<EbaySummary | null | undefined>(undefined);
  useEffect(() => {
    setSummary(undefined);
    if (!workerUrl) return;
    const ctrl = new AbortController();
    fetchEbaySummary(workerUrl, query, ctrl.signal, country).then(setSummary, () => {
      if (!ctrl.signal.aborted) setSummary(null);
    });
    return () => ctrl.abort();
  }, [workerUrl, query, country]);
  return summary;
}

/** Shipping note in the display currency ("배송비 1,700원 포함" in the Korean UI with won). */
function useShippingNote(shipping: number | null | undefined): string {
  const { currency } = useSettings();
  const rates = useRates();
  const lang = useUiLang();
  return shippingNote(shipping, lang, (usd) => formatMoney(usd, currency, rates, { lang }));
}

/**
 * An auction's price so far. USD listings (eBay US) show bid + shipping with the same note as the Buy It Now
 * totals above ("배송비 … 포함", "무료 배송", or "배송비 별도" when eBay doesn't say), so a kid can compare them.
 * Other currencies are shown as listed.
 */
function AuctionPrice({ item }: { item: EbayListing }) {
  const note = useShippingNote(item.shipping);
  if (item.currency !== 'USD') {
    return (
      <span className="tabular">
        {new Intl.NumberFormat('en-US', { style: 'currency', currency: item.currency }).format(item.price)}
      </span>
    );
  }
  return (
    <>
      <Money usd={withShipping(item.price, item.shipping)} />
      <span className="caption muted card-auction-ship">{note}</span>
    </>
  );
}

export function LiveSummary({ summary }: { summary: EbaySummary }) {
  const t = useStrings(STRINGS);
  const lang = useUiLang();
  const { currency } = useSettings();
  const rates = useRates();
  const { buyNow } = summary;
  const shipping = useShippingNote(buyNow.lowestShipping);
  // Newer workers add shipping to both totals and report the lowest listing's part; older ones send price only.
  const totals = typeof buyNow.lowestShipping === 'number';
  // eBay's auction count can be > 0 while the worker filtered out every listing: then show nothing here.
  const auctions = summary.auctions.items.slice(0, MAX_AUCTIONS);
  const chars = statChars([buyNow.lowest, buyNow.median], (usd) => formatMoney(usd, currency, rates, { lang }));

  return (
    <div className="stack-12 fade-in">
      {buyNow.lowest !== null && (
        // One grid for both columns (labels, numbers and notes in shared rows): the numbers sit on one line even
        // when one label wraps, and --ebay-chars gives them one font size.
        <div className="card-ebay-stats" style={{ '--ebay-chars': chars } as CSSProperties}>
          <span className="caption muted card-ebay-label">{t('buyNowFrom')}</span>
          <Money usd={buyNow.lowest} className="card-ebay-big" />
          <span className="caption muted card-ebay-stat-note">{shipping}</span>
          {buyNow.median !== null && (
            <>
              <span className="caption muted card-ebay-label card-ebay-c2">{t('typical')}</span>
              <Money usd={buyNow.median} className="card-ebay-big card-ebay-c2" />
              {totals && <span className="caption muted card-ebay-stat-note card-ebay-c2">{t('totalIncl')}</span>}
            </>
          )}
        </div>
      )}
      {auctions.length > 0 && (
        <div className="stack-8">
          <h3 className="small muted card-ebay-sub">
            {auctionHeading(summary.auctions.count, summary.auctions.items.length, lang)}
          </h3>
          <ul className="card-auctions">
            {auctions.map((item) => (
              <li key={item.url}>
                <ExternalLink site="eBay" className="card-auction" href={item.url}>
                  {item.image ? (
                    <img className="card-auction-thumb" src={item.image} alt="" loading="lazy" />
                  ) : (
                    <span className="card-auction-thumb" aria-hidden="true" />
                  )}
                  <span className="grow stack-4">
                    <span className="truncate small card-auction-title">{item.title}</span>
                    <span className="caption muted">
                      {[item.bidCount !== undefined && bidsText(item.bidCount, lang), item.endsAt && timeLeft(item.endsAt, lang)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="card-auction-price">
                    <span className="caption muted">{t(item.bidCount === 0 ? 'startBid' : 'currentBid')}</span>
                    <AuctionPrice item={item} />
                  </span>
                </ExternalLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function LiveSkeleton() {
  return (
    <div className="stack-12" aria-hidden="true">
      <div className="card-ebay-stats">
        <div className="stack-4">
          <Skeleton width={96} height={13} />
          <Skeleton width={84} height={26} />
        </div>
        <div className="stack-4">
          <Skeleton width={56} height={13} />
          <Skeleton width={84} height={26} />
        </div>
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="row">
          <Skeleton shape="circle" width={48} height={48} />
          <span className="grow stack-4">
            <Skeleton width="85%" height={15} />
            <Skeleton width="45%" height={13} />
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * "A · B" that wraps at the dot when it doesn't fit one line ("미국 eBay 가격이에요 ·" / "한국으로 받으면 배송비가 더
 * 들어요"), not in the middle of a phrase. Each phrase only breaks inside when it is wider than the line by itself.
 */
function Phrases({ text }: { text: string }) {
  const parts = text.split(' · ');
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && ' '}
          <span className="card-ebay-phrase">{i < parts.length - 1 ? `${part} ·` : part}</span>
        </span>
      ))}
    </>
  );
}

/** The panel's element id (PriceHero's "eBay 가격은 아래에 있어요" button scrolls to it). */
export const EBAY_PANEL_ID = 'card-ebay';

export interface EbayPanelProps {
  /** eBay search words for the card (lib/ebay `ebayQuery`). */
  query: string;
}

/**
 * eBay price links (always) plus live Buy It Now / auction prices when a parent set up the worker.
 * Every link goes through the grown-up check (ExternalLink).
 */
export function EbayPanel({ query }: EbayPanelProps) {
  const t = useStrings(STRINGS);
  const { ebayWorkerUrl, country } = useSettings();
  const links = useMemo(() => ebayLinks(query), [query]);
  const summary = useEbaySummary(ebayWorkerUrl, query, country);
  const loading = Boolean(ebayWorkerUrl) && summary === undefined;
  const live = ebayWorkerUrl && summary && hasLivePrices(summary) ? summary : null;
  // No note while the worker is still answering, so it doesn't change under the kid's eyes.
  const note = loading ? null : shipNote(country, live);

  const tiles = [
    { href: links.auctions, emoji: '🔨', label: t('auctions') },
    { href: links.buyNow, emoji: '🏷️', label: t('buyNow') },
    { href: links.sold, emoji: '🧾', label: t('sold') },
  ];

  return (
    <section id={EBAY_PANEL_ID} className="surface card-ebay stack-16" aria-labelledby="card-ebay-title">
      <div className="stack-4">
        <h2 id="card-ebay-title" className="h2" tabIndex={-1}>
          {t('title')}
        </h2>
        {note && (
          <p className="caption muted card-ebay-ship">
            <Phrases text={t(note)} />
          </p>
        )}
      </div>
      {loading && <LiveSkeleton />}
      {live && <LiveSummary summary={live} />}
      <div className="stack-8">
        <div className="card-ebay-links">
          {tiles.map((tile) => (
            <ExternalLink key={tile.href} site="eBay" className="card-ebay-link" href={tile.href}>
              <Icon name="external-link" size={14} strokeWidth={2.5} className="card-ebay-out" />
              <span className="card-ebay-emoji" aria-hidden="true">
                {tile.emoji}
              </span>
              {tile.label}
            </ExternalLink>
          ))}
        </div>
        <p className="caption muted card-ebay-hint">{t('opens')}</p>
      </div>
    </section>
  );
}
