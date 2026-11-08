import { useId, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { HttpError } from '../../lib/cache';
import { fetchEbaySummary } from '../../lib/ebay';
import { useStrings, type Strings } from '../../lib/i18n';
import { updateSettings, useSettings } from '../../lib/store';

type Failure = 'offline' | 'noKeys' | 'ebayDown' | 'slow' | 'badUrl';

const STRINGS: Strings<'title' | 'intro' | 'label' | 'test' | 'testing' | 'ok' | 'guide' | Failure> = {
  ko: {
    title: 'eBay 실시간 가격 (선택)',
    intro: '없어도 괜찮아요! eBay 버튼은 언제나 eBay 검색을 열어요. 어른이 무료 워커를 설치하면 앱 안에서 바로 최저가와 경매를 볼 수 있어요.',
    label: 'eBay 워커 주소',
    test: '연결 테스트',
    testing: '확인 중…',
    ok: '연결됐어요! 즉시구매 {buyNow}개 · 경매 {auctions}개',
    guide: '워커 설치 방법 보기 (GitHub)',
    offline: '인터넷이 없어요. 연결되면 다시 해 봐요.',
    noKeys: '워커에 eBay 키가 아직 없어요. 설치 방법 5단계를 확인해요.',
    ebayDown: 'eBay가 응답하지 않아요. 키를 확인하거나 잠시 뒤 다시 해 봐요.',
    slow: '응답이 너무 늦어요. 다시 해 봐요.',
    badUrl: '워커에 연결할 수 없어요. 주소를 확인해요.',
  },
  en: {
    title: 'Live eBay prices (optional)',
    intro: 'Not needed! The eBay buttons always open an eBay search. If a grown-up sets up the free worker, the app shows the lowest prices and auctions right inside.',
    label: 'eBay worker URL',
    test: 'Test connection',
    testing: 'Checking…',
    ok: 'Connected! {buyNow} Buy It Now · {auctions} auctions',
    guide: 'How to set up the worker (GitHub)',
    offline: 'No internet. Try again when you’re back online.',
    noKeys: 'The worker has no eBay keys yet. See step 5 of the guide.',
    ebayDown: 'eBay didn’t answer. Check the keys or try again later.',
    slow: 'That took too long. Try again.',
    badUrl: 'Can’t reach the worker. Check the address.',
  },
};

const GUIDE_URL = 'https://github.com/fromsnowman2014/poketmon_card_scan/tree/main/worker';
const TEST_QUERY = 'Pikachu';

type TestState = { kind: 'idle' } | { kind: 'testing' } | { kind: 'ok'; buyNow: number; auctions: number } | { kind: 'fail'; why: Failure };

function failureOf(err: unknown): Failure {
  if (!navigator.onLine) return 'offline';
  if (err instanceof HttpError) return err.status === 500 ? 'noKeys' : err.status === 502 ? 'ebayDown' : 'badUrl';
  if (err instanceof DOMException && err.name === 'AbortError') return 'slow';
  return 'badUrl';
}

/** Optional eBay worker address with a one-tap connection test. Label text is promised by worker/README.md. */
export function EbayWorker() {
  const t = useStrings(STRINGS);
  const { ebayWorkerUrl } = useSettings();
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
      const summary = await fetchEbaySummary(draft, TEST_QUERY);
      if (id === run.current) setTest({ kind: 'ok', buyNow: summary.buyNow.count, auctions: summary.auctions.count });
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
                {t('ok', { buyNow: test.buyNow, auctions: test.auctions })}
              </span>
            )}
            {test.kind === 'fail' && (
              <span className="text-down">
                <Icon name="x" size={18} />
                {t(test.why)}
              </span>
            )}
          </p>
        </div>
        <a className="link settings-ext" href={GUIDE_URL} target="_blank" rel="noopener noreferrer">
          {t('guide')}
          <Icon name="external-link" size={16} />
        </a>
      </div>
    </section>
  );
}
