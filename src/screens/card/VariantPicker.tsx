import { useEffect, useId, useRef } from 'react';
import { cx } from '../../components/cx';
import { Icon } from '../../components/Icon';
import { Money } from '../../components/Money';
import { useStrings, useUiLang, type Strings } from '../../lib/i18n';
import { isApproxPrice } from '../../lib/pricing';
import type { CardVariant } from '../../lib/types';
import { variantLabel, variantShortLabel, type VariantLabelContext } from './format';
import { tileLayout } from './printing';

const STRINGS: Strings<'group' | 'noPrice'> = {
  ko: { group: '내 카드는 어떤 거예요?', noPrice: '가격 없음' },
  en: { group: 'Which one is your card?', noPrice: 'No price' },
};

export interface VariantPickerProps {
  /** In the order to show (CardDetail.variants: most common first). */
  variants: CardVariant[];
  selected: string;
  onSelect: (key: string) => void;
  /** Card language and sibling keys, for the names (format.variantLabel). */
  labels: VariantLabelContext;
  /** Show every price as approximate (Korean-card route). */
  approx?: boolean;
}

/**
 * The printings of a card as one row of tiles above the price: short name over its price ("Master Ball / $2.27").
 * Up to three share the row in equal columns; more, or long names, scroll sideways. Render only when the card has
 * more than one. The question is a visible heading on tall phones only (CSS); it always names the group.
 */
export function VariantPicker({ variants, selected, onSelect, labels, approx }: VariantPickerProps) {
  const t = useStrings(STRINGS);
  const lang = useUiLang();
  const headId = useId();
  const row = useRef<HTMLDivElement>(null);
  const names = variants.map((v) => variantShortLabel(v.key, lang, labels));
  const scroll = tileLayout(names) === 'scroll';

  // Keep the picked tile in view inside the row (never scrolls the page).
  useEffect(() => {
    const box = row.current;
    const tile = scroll ? box?.querySelector<HTMLElement>('[aria-pressed="true"]') : null;
    if (!box || !tile) return;
    const edge = parseFloat(getComputedStyle(box).paddingLeft) || 0;
    const [b, r] = [box.getBoundingClientRect(), tile.getBoundingClientRect()];
    if (r.left < b.left + edge) box.scrollLeft -= b.left + edge - r.left;
    else if (r.right > b.right - edge) box.scrollLeft += r.right - (b.right - edge);
  }, [scroll, selected]);

  return (
    <div className="card-variants" role="group" aria-labelledby={headId}>
      <p id={headId} className="card-variants-head">
        {t('group')}
      </p>
      <div ref={row} className={cx('card-tiles', scroll && 'scroll-x card-tiles-scroll')}>
        {variants.map((v, i) => {
          const full = variantLabel(v.key, lang, labels);
          const market = v.summary?.market ?? null;
          return (
            <button
              key={v.key}
              type="button"
              className="card-tile"
              aria-pressed={v.key === selected}
              onClick={() => onSelect(v.key)}
            >
              {/* Screen readers hear the full name ("Master Ball mirror"), then the price. */}
              {full !== names[i] && <span className="sr-only">{full}</span>}
              <span className="card-tile-name" aria-hidden={full !== names[i] || undefined}>
                {names[i]}
              </span>
              {market === null ? (
                <span className="card-tile-none">{t('noPrice')}</span>
              ) : (
                <Money usd={market} approx={approx || isApproxPrice(v.summary)} className="card-tile-price" />
              )}
              <span className="card-tile-check" aria-hidden="true">
                <Icon name="check" size={12} strokeWidth={3.5} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
