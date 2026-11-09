import { useEffect } from 'react';
import { cx } from '../../components/cx';
import { Icon } from '../../components/Icon';
import { Money } from '../../components/Money';
import { showToast } from '../../components/Toast';
import { fmtRelativeTime, useStrings, useUiLang, type Strings } from '../../lib/i18n';
import { collectionTotalUsd, recordSnapshot, useSnapshots } from '../../lib/store';
import type { CollectionItem } from '../../lib/types';
import { useOnline } from '../../lib/useOnline';
import { todayLocal, weekChange, type WeekChange } from '../../lib/weekChange';
import { cardCount, oldestUpdate } from './stats';
import { useAutoRefreshPrices, useRefreshPrices } from './useRefreshPrices';

type Key =
  | 'total'
  | 'count'
  | 'count1'
  | 'up'
  | 'down'
  | 'sinceWeek'
  | 'sinceYesterday'
  | 'sinceDays'
  | 'refresh'
  | 'refreshing'
  | 'updated'
  | 'refreshed'
  | 'someFailed'
  | 'offline';

const STRINGS: Strings<Key> = {
  ko: {
    total: '모두 합치면',
    count: '{n}장',
    count1: '1장',
    up: '올랐어요',
    down: '내려갔어요',
    sinceWeek: '지난주보다',
    sinceYesterday: '어제보다',
    sinceDays: '{n}일 전보다',
    refresh: '가격 새로고침',
    refreshing: '가격 확인 중… {done}/{total}',
    updated: '{when} 확인',
    refreshed: '가격을 새로 확인했어요',
    someFailed: '{n}장은 가격을 못 가져왔어요',
    offline: '인터넷이 없어요. 내 카드는 안전해요.',
  },
  en: {
    total: 'All together',
    count: '{n} cards',
    count1: '1 card',
    up: 'up',
    down: 'down',
    sinceWeek: 'since last week',
    sinceYesterday: 'since yesterday',
    sinceDays: 'since {n} days ago',
    refresh: 'Refresh prices',
    refreshing: 'Checking prices… {done}/{total}',
    updated: 'Checked {when}',
    refreshed: 'Prices are fresh!',
    someFailed: "Couldn't check some prices ({n})",
    offline: 'No internet. Your cards are safe here.',
  },
};

function ChangeLine({ change }: { change: WeekChange }) {
  const t = useStrings(STRINGS);
  const up = change.deltaUsd > 0;
  const when =
    change.days === 1
      ? t('sinceYesterday')
      : change.days >= 7 && change.days <= 13
        ? t('sinceWeek')
        : t('sinceDays', { n: change.days });
  return (
    <p className="collection-change">
      <span className={cx('collection-change-pill', up ? 'collection-change-up' : 'collection-change-down')}>
        <span aria-hidden="true">{up ? '▲' : '▼'}</span>
        <span className="sr-only">{t(up ? 'up' : 'down')}</span>
        <Money usd={Math.abs(change.deltaUsd)} />
      </span>
      <span className="muted">{when}</span>
    </p>
  );
}

/** Total value, card count, change since last week and the price refresh. */
export function SummaryCard({ items }: { items: CollectionItem[] }) {
  const t = useStrings(STRINGS);
  const lang = useUiLang();
  const online = useOnline();
  const snapshots = useSnapshots();
  const { progress, refresh } = useRefreshPrices(items);
  useAutoRefreshPrices(items);
  const total = collectionTotalUsd(items);
  const count = cardCount(items);
  // Price movement of the cards saved then and now only: adding a card is not "went up".
  const change = weekChange(snapshots, items, todayLocal());
  const checked = oldestUpdate(items);

  useEffect(() => {
    // Keeps the daily history "since last week" compares against, including right after a refresh.
    if (items.length) recordSnapshot(items);
  }, [items]);

  const onRefresh = async () => {
    const { failed } = await refresh();
    if (failed) showToast(t('someFailed', { n: failed }), { icon: '🔌' });
    else showToast(t('refreshed'), { icon: '✨' });
  };

  return (
    <section className="surface surface-glow collection-hero fade-in" aria-labelledby="collection-total-label">
      <div className="row-between">
        <span id="collection-total-label" className="small muted collection-hero-label">
          {t('total')}
        </span>
        <span className="collection-count">{count === 1 ? t('count1') : t('count', { n: count })}</span>
      </div>
      <Money
        usd={total}
        approx={items.some((i) => i.priceApprox)}
        secondary
        animate
        className="price-xl collection-total"
      />
      {change && change.deltaUsd !== 0 && <ChangeLine change={change} />}

      <div className="divider" />
      {online ? (
        <div className="row-between">
          <button
            type="button"
            className="btn btn-secondary btn-sm collection-refresh"
            onClick={() => void onRefresh()}
            aria-busy={!!progress}
          >
            {progress ? (
              <span className="spinner collection-refresh-spinner" aria-hidden="true" />
            ) : (
              <Icon name="refresh" size={18} />
            )}
            {progress ? t('refreshing', { done: progress.done, total: progress.total }) : t('refresh')}
          </button>
          {checked && !progress && (
            <span className="caption muted">{t('updated', { when: fmtRelativeTime(checked, lang) })}</span>
          )}
        </div>
      ) : (
        <p className="small muted collection-offline">
          <Icon name="info" size={18} />
          {t('offline')}
        </p>
      )}
      {progress && (
        <div className="collection-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${progress.total ? progress.done / progress.total : 0})` }} />
        </div>
      )}
    </section>
  );
}
