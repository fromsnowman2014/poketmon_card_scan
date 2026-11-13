import { Fragment, useEffect, useId, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';
import { fmtRelativeTime, useStrings, useUiLang, type Strings } from '../../lib/i18n';
import { inAppLabel, useStorageContext, type StorageKind } from '../../lib/storageContext';
import { useCollection, useCollectionSaveState } from '../../lib/store';
import './StorageInfo.css';

type Key =
  | 'title'
  | 'intro'
  | 'place'
  | StorageKind
  | 'inAppNamed'
  | 'address'
  | 'testAddress'
  | 'cards'
  | 'count'
  | 'count1'
  | 'protection'
  | 'on'
  | 'off'
  | 'unknown'
  | 'checking'
  | 'lastSaved'
  | 'notYet'
  | 'status'
  | 'ok'
  | 'notSaved'
  | 'blocked'
  | 'full'
  | 'why';

const STRINGS: Strings<Key> = {
  ko: {
    title: '내 카드 저장 위치',
    intro: '아이폰은 홈 화면 앱, 사파리, 다른 앱 안에서 연 화면마다 내 카드를 따로 저장해요.',
    place: '저장 위치',
    app: '홈 화면 앱',
    browser: '브라우저(사파리 등)',
    'in-app': '다른 앱 안',
    inAppNamed: '다른 앱 안({app})',
    desktop: '컴퓨터·안드로이드 브라우저',
    address: '주소',
    testAddress: '테스트용 주소',
    cards: '카드',
    count: '{n}장',
    count1: '1장',
    protection: '저장 보호',
    on: '켜짐',
    off: '꺼짐',
    unknown: '알 수 없음',
    checking: '확인 중…',
    lastSaved: '마지막 저장',
    notYet: '이번에 연 뒤로 아직 없음',
    status: '저장 상태',
    ok: '정상',
    notSaved: '저장 안 됨',
    blocked: '저장이 막혀 있어요',
    full: '저장 공간이 꽉 찼어요',
    why: '이유를 알 수 없어요',
  },
  en: {
    title: 'Where My Cards is saved',
    intro: 'iPhone keeps a separate My Cards for the Home Screen app, Safari, and pages opened inside other apps.',
    place: 'Place',
    app: 'Home Screen app',
    browser: 'Browser (Safari or another)',
    'in-app': 'Inside another app',
    inAppNamed: 'Inside another app ({app})',
    desktop: 'Computer or Android browser',
    address: 'Address',
    testAddress: 'test address',
    cards: 'Cards',
    count: '{n} cards',
    count1: '1 card',
    protection: 'Storage protection',
    on: 'On',
    off: 'Off',
    unknown: 'Unknown',
    checking: 'Checking…',
    lastSaved: 'Last saved',
    notYet: 'Not yet since the app opened',
    status: 'Save status',
    ok: 'OK',
    notSaved: 'Not saved',
    blocked: 'saving is blocked',
    full: 'storage is full',
    why: 'unknown reason',
  },
};

type Protection = 'checking' | 'on' | 'off' | 'unknown';

/** navigator.storage.persisted(): whether the browser promised to keep this site's storage when space runs low. */
function useProtection(): Protection {
  const [state, setState] = useState<Protection>('checking');
  useEffect(() => {
    let alive = true;
    const done = (next: Protection) => {
      if (alive) setState(next);
    };
    try {
      const manager = (typeof navigator === 'undefined' ? undefined : navigator.storage) as Partial<StorageManager> | undefined;
      if (typeof manager?.persisted !== 'function') done('unknown');
      else manager.persisted().then((on) => done(on ? 'on' : 'off'), () => done('unknown'));
    } catch {
      done('unknown');
    }
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/** Re-renders every half minute, so "Last saved: just now" doesn't go stale while the screen stays open. */
function useTick(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}

/** "fromsnowman2014.github.io" may break after a dot ("fromsnowman2014." / "github.io"), not inside a name. */
function Host({ host }: { host: string }) {
  return host.split('.').map((part, i) => (
    <Fragment key={i}>
      {i > 0 && (
        <>
          .<wbr />
        </>
      )}
      {part}
    </Fragment>
  ));
}

/**
 * Settings › Where My Cards is saved: the place (Home Screen app, browser, inside another app, computer/Android),
 * the address, how many cards, storage protection, the last save and whether saving works. A parent reads it out to
 * tell where the app runs, so the words stay plain and exact.
 */
export function StorageInfo() {
  const t = useStrings(STRINGS);
  const lang = useUiLang();
  const titleId = useId();
  const check = useStorageContext();
  const items = useCollection();
  const save = useCollectionSaveState();
  const protection = useProtection();
  const now = useTick();

  const app = check.kind === 'in-app' ? inAppLabel(check, lang) : undefined;
  const place = app ? t('inAppNamed', { app }) : t(check.kind);
  const count = items.reduce((n, i) => n + i.qty, 0);
  // Not saved now, or storage refused the check at startup (nothing tried to save since).
  const problem = !save.saved ? (save.problem ?? 'unknown') : check.probe !== 'ok' ? check.probe : undefined;
  const why = problem === 'blocked' || problem === 'full' ? t(problem) : t('why');

  const rows: [label: string, value: ReactNode][] = [
    [t('place'), place],
    [
      t('address'),
      <>
        {check.host ? <Host host={check.host} /> : '—'}
        {check.testAddress && ` · ${t('testAddress')}`}
      </>,
    ],
    [t('cards'), count === 1 ? t('count1') : t('count', { n: count })],
    [t('protection'), t(protection)],
    [t('lastSaved'), save.lastSavedAt ? fmtRelativeTime(save.lastSavedAt, lang, now) : t('notYet')],
    [
      t('status'),
      problem ? (
        <>
          <span aria-hidden="true">⚠️ </span>
          {/* "저장 안 됨 · / 저장 공간이 꽉 찼어요": a second line starts with the reason. */}
          <span className="storage-notice-clause">{t('notSaved')} ·</span> <span className="storage-notice-clause">{why}</span>
        </>
      ) : (
        <>
          <span aria-hidden="true">✅ </span>
          {t('ok')}
        </>
      ),
    ],
  ];

  return (
    <section id="settings-storage" className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="settings-heading">
        <Icon name="cards" size={20} />
        {t('title')}
      </h2>
      <div className="surface stack-12">
        <p className="small settings-text">{t('intro')}</p>
        <dl className="storage-info-list">
          {rows.map(([label, value]) => (
            <div key={label} className="storage-info-row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
