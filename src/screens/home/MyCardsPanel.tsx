import { useEffect } from 'react';
import { CardImage } from '../../components/CardImage';
import { cx } from '../../components/cx';
import { Icon } from '../../components/Icon';
import { Money } from '../../components/Money';
import { StorageNotice } from '../../components/StorageNotice';
import { useStrings, type Strings } from '../../lib/i18n';
import { Link } from '../../lib/router';
import { collectionTotalUsd, recordSnapshot, useCollectionThumbs, useSnapshots } from '../../lib/store';
import type { CollectionItem } from '../../lib/types';
import { todayLocal, weekChange, type WeekChange } from '../../lib/weekChange';
import { useAutoRefreshPrices } from '../collection/useRefreshPrices';

type Key =
  | 'title'
  | 'count'
  | 'count1'
  | 'up'
  | 'down'
  | 'sinceWeek'
  | 'sinceYesterday'
  | 'sinceDays'
  | 'emptyTitle'
  | 'emptyText';

const STRINGS: Strings<Key> = {
  ko: {
    title: '내 카드',
    count: '{n}장',
    count1: '1장',
    up: '올랐어요',
    down: '내려갔어요',
    sinceWeek: '지난주보다',
    sinceYesterday: '어제보다',
    sinceDays: '{n}일 전보다',
    emptyTitle: '내 카드를 모아 봐요',
    emptyText: "카드 화면에서 '내 카드에 추가'를 눌러요",
  },
  en: {
    title: 'My Cards',
    count: '{n} cards',
    count1: '1 card',
    up: 'up',
    down: 'down',
    sinceWeek: 'since last week',
    sinceYesterday: 'since yesterday',
    sinceDays: 'since {n} days ago',
    emptyTitle: 'Start your collection',
    emptyText: 'Tap “Add to My Cards” on any card',
  },
};

const STACK_SIZE = 3;

function ChangeLine({ change }: { change: WeekChange }) {
  const t = useStrings(STRINGS);
  const up = change.deltaUsd > 0;
  const when =
    change.days === 1 ? t('sinceYesterday') : change.days >= 7 && change.days <= 13 ? t('sinceWeek') : t('sinceDays', { n: change.days });
  return (
    <p className="home-change">
      <span className={cx('home-change-pill', up ? 'home-change-up' : 'home-change-down')}>
        <span aria-hidden="true">{up ? '▲' : '▼'}</span>
        <span className="sr-only">{t(up ? 'up' : 'down')}</span>
        <Money usd={Math.abs(change.deltaUsd)} />
      </span>
      <span className="muted">{when}</span>
    </p>
  );
}

/**
 * Total value of My Cards with the change since last week; a friendly nudge when nothing is saved yet. Under it, one
 * line says where the cards are saved when that matters (StorageNotice; a button can't sit inside the panel's link).
 */
export function MyCardsPanel({ items }: { items: CollectionItem[] }) {
  return (
    <div className="stack-8">
      <Panel items={items} />
      <StorageNotice variant="compact" />
    </div>
  );
}

function Panel({ items }: { items: CollectionItem[] }) {
  const t = useStrings(STRINGS);
  const snapshots = useSnapshots();
  const thumbs = useCollectionThumbs();
  const total = collectionTotalUsd(items);
  // Opening the app keeps saved prices fresh (background refresh of prices older than a day, hourly at most).
  useAutoRefreshPrices(items);

  useEffect(() => {
    // Opening the app is enough to keep the daily history that "since last week" compares against.
    if (items.length) recordSnapshot(items);
  }, [items]);

  if (!items.length) {
    return (
      <Link to="/collection" className="surface home-mycards-empty">
        <span className="home-mycards-emoji" aria-hidden="true">
          📦
        </span>
        <span className="grow stack-4">
          <span className="body">{t('emptyTitle')}</span>
          <span className="small muted">{t('emptyText')}</span>
        </span>
        <Icon name="chevron-right" className="home-chevron" />
      </Link>
    );
  }

  const count = items.reduce((n, i) => n + i.qty, 0);
  // Price movement of the cards saved then and now only: adding a card is not "went up".
  const change = weekChange(snapshots, items, todayLocal());
  const best = [...items].sort((a, b) => (b.priceUsd ?? -1) - (a.priceUsd ?? -1)).slice(0, STACK_SIZE);

  return (
    <Link to="/collection" className="surface surface-glow home-mycards slide-up">
      <span className="grow stack-4">
        <span className="row home-mycards-label">
          <Icon name="cards" size={20} />
          {t('title')}
          <span className="home-count">{count === 1 ? t('count1') : t('count', { n: count })}</span>
        </span>
        <Money usd={total} approx={items.some((i) => i.priceApprox)} className="home-mycards-total" />
        {change && change.deltaUsd !== 0 && <ChangeLine change={change} />}
      </span>
      <span className="home-mycards-stack" aria-hidden="true">
        {best.map((item) => (
          <CardImage
            key={item.key}
            image={item.image}
            fallback={item.imageFallback}
            photo={thumbs[item.key]}
            alt=""
            size="thumb"
            className="home-mycards-thumb"
          />
        ))}
      </span>
      <Icon name="chevron-right" className="home-chevron" />
    </Link>
  );
}
