import { useMemo, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { StorageNotice } from '../components/StorageNotice';
import { TopBar } from '../components/TopBar';
import { useRates } from '../lib/fx';
import { useStrings, useUiLang, type Strings } from '../lib/i18n';
import { Link } from '../lib/router';
import { useCollection, useCollectionThumbs, useSettings } from '../lib/store';
import { Badges } from './collection/Badges';
import { BestCard } from './collection/BestCard';
import { CardGrid } from './collection/CardGrid';
import { itemNames } from './collection/itemName';
import {
  bestItem,
  cardCount,
  milestones,
  sortItems,
  tierCounts,
  unpricedCount,
  type SortKey,
} from './collection/stats';
import { SummaryCard } from './collection/SummaryCard';
import { TierBar } from './collection/TierBar';
import './CollectionScreen.css';

type Key = 'title' | 'edit' | 'done' | 'all' | 'sort' | SortKey | 'emptyTitle' | 'emptyText' | 'scan' | 'disclaimer';

const STRINGS: Strings<Key> = {
  ko: {
    title: '내 카드',
    edit: '편집',
    done: '완료',
    all: '모든 카드',
    sort: '정렬',
    price: '가격순',
    newest: '최신순',
    name: '이름순',
    emptyTitle: '아직 카드가 없어요!',
    emptyText: '첫 카드를 찍어볼까요?',
    scan: '카드 찍기',
    disclaimer: '가격은 예상이에요. 사고팔 땐 어른과 함께!',
  },
  en: {
    title: 'My Cards',
    edit: 'Edit',
    done: 'Done',
    all: 'All cards',
    sort: 'Sort',
    price: 'Price',
    newest: 'Newest',
    name: 'Name',
    emptyTitle: 'No cards yet!',
    emptyText: 'Scan your first one',
    scan: 'Scan a card',
    disclaimer: 'Prices are guesses. Ask a grown-up before buying or selling.',
  },
};

const SORTS: SortKey[] = ['price', 'newest', 'name'];

export default function CollectionScreen() {
  const t = useStrings(STRINGS);
  const lang = useUiLang();
  const items = useCollection();
  const thumbs = useCollectionThumbs();
  // Tiers and price badges follow the money shown (a $4 card is a 💎 용돈 카드 as 5,440원, not as $4.00).
  const { currency } = useSettings();
  const rates = useRates();
  const [sort, setSort] = useState<SortKey>('price');
  const [editingWanted, setEditing] = useState(false);
  const editing = editingWanted && items.length > 0;
  const sorted = useMemo(() => sortItems(items, sort, (i) => itemNames(i, lang).title, lang), [items, sort, lang]);
  const best = bestItem(items);

  const editButton = items.length > 0 && (
    <button
      type="button"
      className="btn btn-ghost btn-sm collection-edit-btn"
      onClick={() => setEditing(!editing)}
      aria-pressed={editing}
    >
      {editing ? t('done') : t('edit')}
    </button>
  );

  return (
    <main className="screen collection">
      <TopBar title={t('title')} right={editButton} />
      <div className="screen-pad stack-24">
        {/* Where these cards are saved, when that matters (a Safari tab, another app, a test address, not saved). */}
        <StorageNotice variant="full" className="collection-storage" />
        {items.length === 0 ? (
          <EmptyState
            emoji="📸"
            title={t('emptyTitle')}
            text={t('emptyText')}
            action={
              <Link to="/scan" className="btn btn-primary btn-lg btn-block">
                <Icon name="camera" />
                {t('scan')}
              </Link>
            }
          />
        ) : (
          <>
            <SummaryCard items={items} />
            {best && items.length > 1 && <BestCard item={best} photo={thumbs[best.key]} />}
            <TierBar counts={tierCounts(items, currency, rates)} unpriced={unpricedCount(items)} />
            <Badges list={milestones(items, currency, rates)} />

            <section className="stack-12" aria-labelledby="collection-all">
              <div className="row-between wrap">
                <h2 id="collection-all" className="h2">
                  {t('all')} <span className="muted tabular">{cardCount(items)}</span>
                </h2>
                <div className="chip-row" role="group" aria-label={t('sort')}>
                  {SORTS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className="chip"
                      aria-pressed={sort === key}
                      onClick={() => setSort(key)}
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>
              <CardGrid items={sorted} thumbs={thumbs} editing={editing} />
            </section>

            <p className="caption muted collection-disclaimer">{t('disclaimer')}</p>
          </>
        )}
      </div>
    </main>
  );
}
