import { useEffect, useMemo, useState } from 'react';
import { ExternalLink } from '../../components/ExternalLink';
import { Icon } from '../../components/Icon';
import { Money } from '../../components/Money';
import { Skeleton } from '../../components/Skeleton';
import { ebayLinks, fetchEbaySummary } from '../../lib/ebay';
import { useRates } from '../../lib/fx';
import { useStrings, useUiLang, type Strings } from '../../lib/i18n';
import { formatMoney } from '../../lib/pricing';
import { useSettings } from '../../lib/store';
import type { EbayListing, EbaySummary } from '../../lib/types';
import { auctionHeading, bidsText, shippingNote, timeLeft, withShipping } from './format';

type Key =
  | 'title'
  | 'buyNowFrom'
  | 'typical'
  | 'totalIncl'
  | 'usOnly'
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
    usOnly: '미국 eBay 기준 · 한국으로 배송하면 더 비싸요',
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
    usOnly: 'eBay US prices · Shipping abroad costs more',
    startBid: 'Starting bid',
    currentBid: 'Current bid',
    auctions: 'Auction prices',
    buyNow: 'Buy-now prices',
    sold: 'Sold prices',
    opens: 'Opens the eBay website · Look with a grown‑up',
  },
};

const MAX_AUCTIONS = 3;

/** undefined while loading, null when the worker failed (we then just show the links). */
function useEbaySummary(workerUrl: string, query: string): EbaySummary | null | undefined {
  const [summary, setSummary] = useState<EbaySummary | null | undefined>(undefined);
  useEffect(() => {
    setSummary(undefined);
    if (!workerUrl) return;
    const ctrl = new AbortController();
    fetchEbaySummary(workerUrl, query, ctrl.signal).then(setSummary, () => {
      if (!ctrl.signal.aborted) setSummary(null);
    });
    return () => ctrl.abort();
  }, [workerUrl, query]);
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

function LiveSummary({ summary }: { summary: EbaySummary }) {
  const t = useStrings(STRINGS);
  const lang = useUiLang();
  const { buyNow } = summary;
  const shipping = useShippingNote(buyNow.lowestShipping);
  // Newer workers add shipping to both totals and report the lowest listing's part; older ones send price only.
  const totals = typeof buyNow.lowestShipping === 'number';
  // eBay's auction count can be > 0 while the worker filtered out every listing: then show nothing here.
  const auctions = summary.auctions.items.slice(0, MAX_AUCTIONS);

  return (
    <div className="stack-12 fade-in">
      {buyNow.lowest !== null && (
        <div className="stack-8">
          <div className="card-ebay-stats">
            <div className="stack-4">
              <span className="caption muted">{t('buyNowFrom')}</span>
              <Money usd={buyNow.lowest} className="card-ebay-big" />
              <span className="caption muted">{shipping}</span>
            </div>
            {buyNow.median !== null && (
              <div className="stack-4">
                <span className="caption muted">{t('typical')}</span>
                <Money usd={buyNow.median} className="card-ebay-big" />
                {totals && <span className="caption muted">{t('totalIncl')}</span>}
              </div>
            )}
          </div>
          <p className="caption muted card-ebay-note">{t('usOnly')}</p>
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
  const { ebayWorkerUrl } = useSettings();
  const links = useMemo(() => ebayLinks(query), [query]);
  const summary = useEbaySummary(ebayWorkerUrl, query);

  const tiles = [
    { href: links.auctions, emoji: '🔨', label: t('auctions') },
    { href: links.buyNow, emoji: '🏷️', label: t('buyNow') },
    { href: links.sold, emoji: '🧾', label: t('sold') },
  ];

  return (
    <section id={EBAY_PANEL_ID} className="surface card-ebay stack-16" aria-labelledby="card-ebay-title">
      <h2 id="card-ebay-title" className="h2" tabIndex={-1}>
        {t('title')}
      </h2>
      {ebayWorkerUrl && summary === undefined && <LiveSkeleton />}
      {ebayWorkerUrl && summary && <LiveSummary summary={summary} />}
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
