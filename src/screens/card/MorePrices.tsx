import { ExternalLink } from '../../components/ExternalLink';
import { Icon } from '../../components/Icon';
import { useRates, type Rates } from '../../lib/fx';
import { fmtRelativeTime, interpolate, useStrings, type Strings } from '../../lib/i18n';
import { formatMoney } from '../../lib/pricing';
import { useSettings } from '../../lib/store';
import type { CardVariant, UiLang } from '../../lib/types';

type Key =
  | 'title'
  | 'forVariant'
  | 'usd'
  | 'eur'
  | 'low'
  | 'mid'
  | 'market'
  | 'high'
  | 'avg'
  | 'trend'
  | 'avg7'
  | 'avg30'
  | 'ignored'
  | 'ignoredLow'
  | 'noSales'
  | 'mixedMirror'
  | 'openTcgplayer'
  | 'ebayQuery'
  | 'workerHint';

const STRINGS: Strings<Key> = {
  ko: {
    title: '가격 더 보기',
    forVariant: '{variant} 기준',
    usd: '달러 / USD',
    eur: '유로 / EUR',
    low: '최저',
    mid: '중간',
    market: '시세',
    high: '최고',
    avg: '평균',
    trend: '추세',
    avg7: '7일 평균',
    avg30: '30일 평균',
    ignored: '너무 높아서 뺐어요',
    ignoredLow: '너무 낮아서 뺐어요',
    noSales: '최근 거래 없음',
    mixedMirror: '미러 무늬 전체 평균',
    openTcgplayer: 'TCGplayer에서 보기',
    ebayQuery: 'eBay 검색어: {q}',
    workerHint: '부모님이 설정에서 eBay 실시간 가격을 켤 수 있어요.',
  },
  en: {
    title: 'More prices',
    forVariant: 'For {variant}',
    usd: 'USD',
    eur: 'EUR',
    low: 'Low',
    mid: 'Mid',
    market: 'Market',
    high: 'High',
    avg: 'Average',
    trend: 'Trend',
    avg7: '7-day avg',
    avg30: '30-day avg',
    ignored: 'Ignored: too high',
    ignoredLow: 'Ignored: too low',
    noSales: 'No recent sales',
    mixedMirror: 'All mirror patterns together',
    openTcgplayer: 'Open on TCGplayer',
    ebayQuery: 'eBay search words: {q}',
    workerHint: 'A grown\u2011up can turn on live eBay prices in Settings.',
  },
};

const RATE: Strings<'today' | 'older' | 'when'> = {
  ko: { today: '오늘 환율: 1달러 = {won}원', older: '환율: 1달러 = {won}원', when: '{line} · {ago} 업데이트' },
  en: { today: 'Today’s rate: $1 = ₩{won}', older: 'Rate: $1 = ₩{won}', when: '{line} · updated {ago}' },
};
const DAY_MS = 24 * 60 * 60 * 1000;
const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * The dollar-to-won rate the won prices use, in whole won, with how old it is: "오늘 환율: 1달러 = 1,359원 · 2시간 전
 * 업데이트" / "Today’s rate: $1 = ₩1,359 · updated 2h ago". Older than a day (offline, or the built-in snapshot), it
 * drops "today".
 */
export function rateLine(rates: Rates, lang: UiLang, now: number = Date.now()): string {
  const s = RATE[lang];
  const at = Date.parse(rates.fetchedAt);
  const fresh = Number.isFinite(at) && now - at < DAY_MS;
  const line = interpolate(fresh ? s.today : s.older, { won: WHOLE.format(Math.round(rates.KRW)) });
  const ago = Number.isFinite(at) ? fmtRelativeTime(rates.fetchedAt, lang, now) : '';
  return ago ? interpolate(s.when, { line, ago }) : line;
}

const EUR = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' });
const eur = (n: number | null) => (n === null ? '—' : EUR.format(n));
const usd = (n: number | null) => formatMoney(n, 'USD');

/** [label, value, note?]; a note marks a number the headline price ignores. */
type Row = [string, string, string?];

function PriceGrid({ rows }: { rows: Row[] }) {
  return (
    <dl className="card-more-grid">
      {rows.map(([label, value, note]) => (
        <div key={label} className="card-more-cell">
          <dt className="caption muted">{label}</dt>
          <dd className={note ? 'tabular muted' : 'tabular'}>
            {value}
            {note && <span className="card-more-note">{note}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface MorePricesProps {
  variant: CardVariant;
  /** Name of the selected variant, shown when the card has several. */
  variantName?: string;
  /** The Cardmarket numbers are for all mirror patterns of the card together (printing.isMixedMirror). */
  mixedMirror?: boolean;
  /** The words the eBay links search for (for grown-ups checking the results). */
  ebayQuery?: string;
  /** Tell grown-ups that live eBay prices can be turned on in Settings (no worker set up). */
  workerHint?: boolean;
}

/**
 * Raw source numbers for grown-ups: TCGplayer (USD) and Cardmarket (EUR), unconverted, plus eBay details. With won
 * prices, one line gives today's dollar-to-won rate so the dollar numbers here can be compared.
 */
export function MorePrices({ variant, variantName, mixedMirror, ebayQuery, workerHint }: MorePricesProps) {
  const t = useStrings(STRINGS);
  const { currency, uiLang } = useSettings();
  const rates = useRates();
  const { tcgplayer: tcg, cardmarket: cm, tcgplayerId, summary } = variant;
  if (!tcg && !cm && !tcgplayerId && !ebayQuery && !workerHint) return null;
  // The headline range leaves out TCGplayer's stray ends: a 999 placeholder listing, a lone 1-cent copy.
  const headline = summary?.source === 'tcgplayer' ? summary : null;
  const highIgnored = !!headline && tcg?.high != null && headline.high !== tcg.high;
  const lowIgnored = !!headline && tcg?.low != null && headline.low !== null && tcg.low < headline.low;

  return (
    <details className="surface card-more">
      <summary className="card-more-summary">
        {t('title')}
        <Icon name="chevron-right" size={20} className="card-more-chevron" />
      </summary>
      <div className="card-more-body stack-16">
        {variantName && <p className="caption muted">{t('forVariant', { variant: variantName })}</p>}
        {currency === 'KRW' && <p className="caption muted tabular">{rateLine(rates, uiLang)}</p>}
        {(tcg || tcgplayerId) && (
          <div className="stack-8">
            <h3 className="card-more-source">
              TCGplayer <span className="caption muted">{t('usd')}</span>
            </h3>
            {tcg && (
              <PriceGrid
                rows={[
                  [t('low'), usd(tcg.low), lowIgnored ? t('ignoredLow') : undefined],
                  [t('mid'), usd(tcg.mid)],
                  // No sales lately: the headline is an asking price (the middle or the cheapest listing).
                  [t('market'), usd(tcg.market), tcg.asking ? t('noSales') : undefined],
                  [t('high'), usd(tcg.high), highIgnored ? t('ignored') : undefined],
                ]}
              />
            )}
            {tcgplayerId && (
              <ExternalLink
                site="TCGplayer"
                className="btn btn-secondary btn-block"
                href={`https://www.tcgplayer.com/product/${tcgplayerId}`}
              >
                {t('openTcgplayer')}
                <Icon name="external-link" size={18} />
              </ExternalLink>
            )}
          </div>
        )}
        {cm && (
          <div className="stack-8">
            <h3 className="card-more-source">
              Cardmarket <span className="caption muted">{t('eur')}</span>
            </h3>
            {mixedMirror && <p className="caption muted">{t('mixedMirror')}</p>}
            <PriceGrid
              rows={[
                [t('avg'), eur(cm.avg)],
                [t('low'), eur(cm.low)],
                [t('trend'), eur(cm.trend)],
                [t('avg7'), eur(cm.avg7)],
                [t('avg30'), eur(cm.avg30)],
              ]}
            />
          </div>
        )}
        {(ebayQuery || workerHint) && (
          <div className="stack-4 card-more-ebay">
            {ebayQuery && <p className="caption muted">{t('ebayQuery', { q: ebayQuery })}</p>}
            {workerHint && <p className="caption muted">{t('workerHint')}</p>}
          </div>
        )}
      </div>
    </details>
  );
}
