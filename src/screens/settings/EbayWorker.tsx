import { useId, useRef, useState } from 'react';
import { ExternalLink } from '../../components/ExternalLink';
import { Icon } from '../../components/Icon';
import { HttpError } from '../../lib/cache';
import { fetchEbaySummary } from '../../lib/ebay';
import { useStrings, type Strings } from '../../lib/i18n';
import { updateSettings, useSettings } from '../../lib/store';
import type { Country, EbaySummary } from '../../lib/types';

type Failure = 'offline' | 'noKeys' | 'ebayDown' | 'slow' | 'busy' | 'badUrl';

const STRINGS: Strings<
  'title' | 'intro' | 'label' | 'test' | 'testing' | 'ok' | 'auctions' | 'auctions1' | 'oldWorker' | 'guide' | Failure
> = {
  ko: {
    title: 'eBay 실시간 가격 (선택)',
    intro: '없어도 괜찮아요! eBay 버튼은 언제나 eBay 검색을 열어요. 어른이 무료 워커를 설치하면 앱 안에서 바로 최저가와 경매를 볼 수 있어요.',
    label: 'eBay 워커 주소',
    test: '연결 테스트',
    testing: '확인 중…',
    ok: '연결됐어요! 즉시구매 {buyNow}개 · {auctions}',
    auctions: '경매 {n}개',
    auctions1: '경매 1개',
    oldWorker: '한국까지 배송비를 보려면 워커를 새 버전으로 다시 배포해 주세요 (설치 방법 참고).',
    guide: '워커 설치 방법 보기 (GitHub)',
    offline: '인터넷이 없어요. 연결되면 다시 해 봐요.',
    noKeys: '워커에 eBay 키가 아직 없어요. 설치 방법 5단계를 확인해요.',
    ebayDown: 'eBay가 응답하지 않아요. 키를 확인하거나 잠시 뒤 다시 해 봐요.',
    slow: '응답이 너무 늦어요. 다시 해 봐요.',
    busy: '너무 자주 눌렀어요. 1분 뒤에 다시 해 봐요.',
    badUrl: '워커에 연결할 수 없어요. 주소를 확인해요.',
  },
  en: {
    title: 'Live eBay prices (optional)',
    intro: 'Not needed! The eBay buttons always open an eBay search. If a grown-up sets up the free worker, the app shows the lowest prices and auctions right inside.',
    label: 'eBay worker URL',
    test: 'Test connection',
    testing: 'Checking…',
    ok: 'Connected! {buyNow} Buy It Now · {auctions}',
    auctions: '{n} auctions',
    auctions1: '1 auction',
    oldWorker: 'To see shipping to Korea, redeploy the worker with the latest version (see the guide).',
    guide: 'How to set up the worker (GitHub)',
    offline: 'No internet. Try again when you’re back online.',
    noKeys: 'The worker has no eBay keys yet. See step 5 of the guide.',
    ebayDown: 'eBay didn’t answer. Check the keys or try again later.',
    slow: 'That took too long. Try again.',
    busy: 'Too many tries. Wait a minute and try again.',
    badUrl: 'Can’t reach the worker. Check the address.',
  },
};

const GUIDE_URL = 'https://github.com/fromsnowman2014/poketmon_card_scan/tree/main/worker';
const TEST_QUERY = 'Pikachu';

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  /** `old`: a kid in Korea, but the worker priced shipping to the US (deployed before `&country=KR`). */
  | { kind: 'ok'; buyNow: number; auctions: number; old: boolean }
  | { kind: 'fail'; why: Failure };

/**
 * True when a kid in Korea tests a worker deployed before `&country=KR` existed: it priced shipping to the US (no
 * `shipTo: "KR"` echo), so the parent should redeploy it. Always false for a kid in the US.
 */
export function workerOutdated(country: Country, summary: Pick<EbaySummary, 'shipTo'>): boolean {
  return country === 'KR' && summary.shipTo !== 'KR';
}

function failureOf(err: unknown): Failure {
  if (!navigator.onLine) return 'offline';
  if (err instanceof HttpError) {
    if (err.status === 429) return 'busy'; // the worker's per-minute limit
    return err.status === 500 ? 'noKeys' : err.status === 502 ? 'ebayDown' : 'badUrl';
  }
  if (err instanceof DOMException && err.name === 'AbortError') return 'slow';
  return 'badUrl';
}

/** Optional eBay worker address with a one-tap connection test. Label text is promised by worker/README.md. */
export function EbayWorker() {
  const t = useStrings(STRINGS);
  const { ebayWorkerUrl, country } = useSettings();
  const [draft, setDraft] = useState(ebayWorkerUrl);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const run = useRef(0);
  const inputId = useId();
  const titleId = useId();

  const change = (value: string) => {
    run.current++; // a test still running checks the old address: ignore its answer
    setDraft(value);
    setTest({ kind: 'idle' });
    updateSettings({ ebayWorkerUrl: value });
  };

  const runTest = async () => {
    const id = ++run.current;
    if (!navigator.onLine) return setTest({ kind: 'fail', why: 'offline' });
    setTest({ kind: 'testing' });
    try {
      // The same request the Card screen makes, so a kid in Korea also learns whether the worker is new enough.
      const summary = await fetchEbaySummary(draft, TEST_QUERY, undefined, country);
      const old = workerOutdated(country, summary);
      if (id === run.current) setTest({ kind: 'ok', buyNow: summary.buyNow.count, auctions: summary.auctions.count, old });
    } catch (err) {
      if (id === run.current) setTest({ kind: 'fail', why: failureOf(err) });
    }
  };

  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="settings-heading">
        <Icon name="gavel" size={20} />
        {t('title')}
      </h2>
      <div className="surface stack-16">
        <p className="small muted settings-text">{t('intro')}</p>
        <div className="stack-8">
          <label htmlFor={inputId} className="settings-label">
            {t('label')}
          </label>
          <input
            id={inputId}
            className="input"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://….workers.dev"
            value={draft}
            onChange={(e) => change(e.target.value)}
          />
        </div>
        <div className="settings-test">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!draft.trim() || test.kind === 'testing'}
            onClick={() => void runTest()}
          >
            {test.kind === 'testing' ? <span className="spinner settings-spinner" aria-hidden="true" /> : <Icon name="zap" size={18} />}
            {t(test.kind === 'testing' ? 'testing' : 'test')}
          </button>
          <p className="settings-test-result" role="status">
            {test.kind === 'ok' && (
              <span className="text-up">
                <Icon name="check" size={18} />
                {t('ok', {
                  buyNow: test.buyNow,
                  auctions: test.auctions === 1 ? t('auctions1') : t('auctions', { n: test.auctions }),
                })}
              </span>
            )}
            {test.kind === 'ok' && test.old && <span className="settings-test-old muted">{t('oldWorker')}</span>}
            {test.kind === 'fail' && (
              <span className="text-down">
                <Icon name="x" size={18} />
                {t(test.why)}
              </span>
            )}
          </p>
        </div>
        <ExternalLink kind="site" site="GitHub" className="link settings-ext" href={GUIDE_URL}>
          {t('guide')}
          <Icon name="external-link" size={16} />
        </ExternalLink>
      </div>
    </section>
  );
}
