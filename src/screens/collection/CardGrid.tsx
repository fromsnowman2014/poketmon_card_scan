import { useMemo, useState, type ReactNode } from 'react';
import { CardImage } from '../../components/CardImage';
import { Icon } from '../../components/Icon';
import { Money } from '../../components/Money';
import { Sheet } from '../../components/Sheet';
import { useValueTier } from '../../components/TierBadge';
import { showToast } from '../../components/Toast';
import { useStrings, useUiLang, type Strings } from '../../lib/i18n';
import { Link } from '../../lib/router';
import { removeFromCollection, setQuantity } from '../../lib/store';
import type { CollectionItem } from '../../lib/types';
import { cardPath, foilOf, variantLabel } from '../card/format';
import { itemNames } from './itemName';

type Key =
  | 'noPrice'
  | 'less'
  | 'more'
  | 'qty'
  | 'qty1'
  | 'remove'
  | 'confirmTitle'
  | 'confirmText'
  | 'confirmYes'
  | 'keep'
  | 'removed';

const STRINGS: Strings<Key> = {
  ko: {
    noPrice: '가격 없음',
    less: '한 장 빼기',
    more: '한 장 더하기',
    qty: '{n}장',
    qty1: '1장',
    remove: '지우기',
    confirmTitle: '이 카드를 뺄까요?',
    confirmText: '{name} 카드가 내 카드에서 빠져요.',
    confirmYes: '빼기',
    keep: '그냥 둘래요',
    removed: '카드를 뺐어요',
  },
  en: {
    noPrice: 'No price',
    less: 'One less',
    more: 'One more',
    qty: '{n} cards',
    qty1: '1 card',
    remove: 'Remove',
    confirmTitle: 'Remove this card?',
    confirmText: '{name} will leave My Cards.',
    confirmYes: 'Remove',
    keep: 'Keep it',
    removed: 'Card removed',
  },
};

interface TileProps {
  item: CollectionItem;
  photo?: string;
  /** Saved printings of this card (this one included). */
  siblings: readonly string[];
  editing: boolean;
  onRemove: (item: CollectionItem) => void;
}

function Tile({ item, photo, siblings, editing, onRemove }: TileProps) {
  const t = useStrings(STRINGS);
  const lang = useUiLang();
  const tierOf = useValueTier();
  const tier = item.priceUsd === null ? null : tierOf(item.priceUsd);
  // Says which printing it is when the same card is saved in more than one, or when it is a special pattern
  // (Master Ball mirror…): its price is far from the usual card's.
  const showVariant = siblings.length > 1 || !!foilOf(item.variant);
  // Same name order as the Card screen title: "루차불" over "ルチャブル" in Korean; the set when there is no second name.
  const { title, subtitle } = itemNames(item, lang);
  const body: ReactNode = (
    <>
      <span className="collection-art">
        <CardImage
          image={item.image}
          fallback={item.imageFallback}
          photo={photo}
          alt={title}
          size="thumb"
          code={{ set: item.setId, number: item.localId }}
        />
        {showVariant && (
          <span className="collection-variant">{variantLabel(item.variant, lang, { cardLang: item.lang, siblings })}</span>
        )}
        {item.qty > 1 && !editing && <span className="collection-qty">×{item.qty}</span>}
      </span>
      <span className="collection-name truncate">{title}</span>
      <span className="collection-sub truncate">{subtitle ?? item.setName}</span>
      <span className="collection-price">
        {tier && <span className={`tier-dot tier-${tier}`} aria-hidden="true" />}
        {item.priceUsd === null ? <span className="muted">{t('noPrice')}</span> : <Money usd={item.priceUsd} approx={item.priceApprox} />}
      </span>
    </>
  );

  return (
    <li className="collection-item">
      {editing ? (
        <div className="collection-card">{body}</div>
      ) : (
        <Link to={cardPath(item, item.variant)} className="collection-card">
          {body}
        </Link>
      )}
      {editing && (
        // Delete sits on the card's corner (like iOS edit mode) so the − / + stepper gets the whole row.
        <button
          type="button"
          className="btn btn-icon collection-remove pop-in"
          onClick={() => onRemove(item)}
          aria-label={`${t('remove')}: ${title}`}
        >
          <Icon name="trash" size={18} />
        </button>
      )}
      {editing && (
        <div className="collection-edit pop-in">
          <div className="collection-stepper" role="group" aria-label={title}>
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => setQuantity(item.key, item.qty - 1)}
              disabled={item.qty <= 1}
              aria-label={t('less')}
            >
              <Icon name="minus" size={20} />
            </button>
            <span className="tabular" aria-live="polite">
              <span aria-hidden="true">{item.qty}</span>
              <span className="sr-only">{item.qty === 1 ? t('qty1') : t('qty', { n: item.qty })}</span>
            </span>
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => setQuantity(item.key, item.qty + 1)}
              aria-label={t('more')}
            >
              <Icon name="plus" size={20} />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export interface CardGridProps {
  items: CollectionItem[];
  thumbs: Readonly<Record<string, string>>;
  editing: boolean;
}

/** Two-column grid of saved cards; in edit mode each card gets a − / + stepper and a remove button. */
export function CardGrid({ items, thumbs, editing }: CardGridProps) {
  const t = useStrings(STRINGS);
  const lang = useUiLang();
  const [removing, setRemoving] = useState<CollectionItem | null>(null);
  // Saved printings per card. Names only know these, not every printing the card has.
  const variantsOf = useMemo(() => {
    const keys = new Map<string, string[]>();
    for (const i of items) keys.set(`${i.lang}:${i.id}`, [...(keys.get(`${i.lang}:${i.id}`) ?? []), i.variant]);
    return keys;
  }, [items]);

  const confirmRemove = () => {
    if (!removing) return;
    removeFromCollection(removing.key);
    setRemoving(null);
    showToast(t('removed'), { icon: '👋' });
  };

  return (
    <>
      <ul className="grid-2 collection-grid">
        {items.map((item) => (
          <Tile
            key={item.key}
            item={item}
            photo={thumbs[item.key]}
            siblings={variantsOf.get(`${item.lang}:${item.id}`) ?? []}
            editing={editing}
            onRemove={setRemoving}
          />
        ))}
      </ul>
      <Sheet open={!!removing} onClose={() => setRemoving(null)} title={t('confirmTitle')}>
        {removing && (
          <div className="stack-16">
            <p className="small muted">{t('confirmText', { name: itemNames(removing, lang).title })}</p>
            <div className="stack-8">
              <button type="button" className="btn btn-lg btn-block collection-danger" onClick={confirmRemove}>
                <Icon name="trash" />
                {t('confirmYes')}
              </button>
              <button type="button" className="btn btn-secondary btn-lg btn-block" onClick={() => setRemoving(null)}>
                {t('keep')}
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
