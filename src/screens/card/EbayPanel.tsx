import { useEffect, useMemo, useState } from 'react';
import { Money } from '../../components/Money';
import { Skeleton } from '../../components/Skeleton';
import { ebayLinks, ebayQuery, fetchEbaySummary, type EbayCard } from '../../lib/ebay';
import { useStrings, useUiLang, type Strings } from '../../lib/i18n';
import { useSettings } from '../../lib/store';
import type { EbayListing, EbaySummary } from '../../lib/types';
import { timeLeft } from './format';

type Key =
  | 'title'
  | 'searching'
  | 'buyNowFrom'
  | 'typical'
  | 'auctionCount'
  | 'bids'
  | 'auctions'
  | 'buyNow'
  | 'sold'
  | 'newTab'
  | 'grownUp';

const STRINGS: Strings<Key> = {
  ko: {
    title: 'eBay에서 보기',
    searching: '검색어: {q}',
    buyNowFrom: '바로 구매 최저가',
    typical: '보통',
    auctionCount: '경매 중 {n}개',
    bids: '입찰 {n}번',
    auctions: '경매 중',
    buyNow: '바로 구매',
    sold: '팔린 가격',
    newTab: '(새 탭)',
    grownUp: '부모님이 설정에서 eBay 실시간 가격을 켤 수 있어요',
  },
  en: {
    title: 'On eBay',
    searching: 'Searching: {q}',
    buyNowFrom: 'Buy It Now from',
    typical: 'Typical',
    auctionCount: '{n} auctions',
    bids: '{n} bids',
    auctions: 'Auctions',
    buyNow: 'Buy It Now',
    sold: 'Sold prices',
    newTab: '(new tab)',
    grownUp: 'A grown\u2011up can turn on live eBay prices in Settings',
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

/** Listing prices are usually USD (eBay US); other currencies are shown as listed. */
function ListingPrice({ item }: { item: EbayListing }) {
  if (item.currency === 'USD') return <Money usd={item.price} />;
  return (
    <span className="tabular">
      {new Intl.NumberFormat('en-US', { style: 'currency', currency: item.currency }).format(item.price)}
    </span>
  );
}

function LiveSummary({ summary }: { summary: EbaySummary }) {
  const t = useStrings(STRINGS);
  const lang = useUiLang();
  const auctions = summary.auctions.items.slice(0, MAX_AUCTIONS);

  return (
    <div className="stack-12 fade-in">
      {summary.buyNow.lowest !== null && (
        <div className="card-ebay-stats">
          <div className="stack-4">
            <span className="caption muted">{t('buyNowFrom')}</span>
            <Money usd={summary.buyNow.lowest} className="card-ebay-big" />
          </div>
          {summary.buyNow.median !== null && (
            <div className="stack-4">
              <span className="caption muted">{t('typical')}</span>
              <Money usd={summary.buyNow.median} className="card-ebay-big" />
            </div>
          )}
        </div>
      )}
      {summary.auctions.count > 0 && (
        <div className="stack-8">
          <h3 className="small muted card-ebay-sub">{t('auctionCount', { n: summary.auctions.count })}</h3>
          <ul className="card-auctions">
            {auctions.map((item) => (
              <li key={item.url}>
                <a className="card-auction" href={item.url} target="_blank" rel="noopener">
                  {item.image ? (
                    <img className="card-auction-thumb" src={item.image} alt="" loading="lazy" />
                  ) : (
                    <span className="card-auction-thumb" aria-hidden="true" />
                  )}
                  <span className="grow stack-4">
                    <span className="truncate small card-auction-title">{item.title}</span>
                    <span className="caption muted">
                      {[
                        item.bidCount !== undefined && t('bids', { n: item.bidCount }),
                        item.endsAt && timeLeft(item.endsAt, lang),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="card-auction-price">
                    <ListingPrice item={item} />
                  </span>
                </a>
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

/** eBay search links (always) plus live Buy It Now / auction prices when a parent set up the worker. */
export function EbayPanel({ card }: { card: EbayCard }) {
  const t = useStrings(STRINGS);
  const { ebayWorkerUrl } = useSettings();
  const query = useMemo(() => ebayQuery(card), [card]);
  const links = useMemo(() => ebayLinks(query), [query]);
  const summary = useEbaySummary(ebayWorkerUrl, query);

  const buttons = [
    { href: links.auctions, emoji: '🔨', label: t('auctions') },
    { href: links.buyNow, emoji: '🛒', label: t('buyNow') },
    { href: links.sold, emoji: '🧾', label: t('sold') },
  ];

  return (
    <section className="surface card-ebay stack-16" aria-labelledby="card-ebay-title">
      <div className="stack-4">
        <h2 id="card-ebay-title" className="h2">
          {t('title')}
        </h2>
        <p className="caption muted truncate">{t('searching', { q: query })}</p>
      </div>
      {ebayWorkerUrl && summary === undefined && <LiveSkeleton />}
      {ebayWorkerUrl && summary && <LiveSummary summary={summary} />}
      <div className="card-ebay-links">
        {buttons.map((b) => (
          <a key={b.label} className="card-ebay-link" href={b.href} target="_blank" rel="noopener">
            <span className="card-ebay-emoji" aria-hidden="true">
              {b.emoji}
            </span>
            {b.label}
            <span className="sr-only">{t('newTab')}</span>
          </a>
        ))}
      </div>
      {!ebayWorkerUrl && <p className="caption muted card-ebay-hint">{t('grownUp')}</p>}
    </section>
  );
}
