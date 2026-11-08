import { useStrings, useUiLang, type Strings } from '../../lib/i18n';
import type { CardVariant } from '../../lib/types';
import { variantLabel } from './format';

const STRINGS: Strings<'group' | 'help' | 'noPrice'> = {
  ko: { group: '카드 종류', help: '반짝이는 무늬가 다르면 바꿔 보세요', noPrice: '가격 없음' },
  en: { group: 'Card version', help: 'Pick the shiny pattern that matches your card', noPrice: 'No price' },
};

export interface VariantPickerProps {
  variants: CardVariant[];
  selected: string;
  onSelect: (key: string) => void;
}

/** Printing chips (normal / reverse holo / …). Render only when the card has more than one. */
export function VariantPicker({ variants, selected, onSelect }: VariantPickerProps) {
  const t = useStrings(STRINGS);
  const lang = useUiLang();
  return (
    <div className="card-variants center stack-8">
      <div className="chip-row card-variant-row" role="group" aria-label={t('group')}>
        {variants.map((v) => (
          <button
            key={v.key}
            type="button"
            className="chip card-variant"
            aria-pressed={v.key === selected}
            onClick={() => onSelect(v.key)}
          >
            {variantLabel(v.key, lang)}
            {!v.summary && <span className="card-variant-none">{t('noPrice')}</span>}
          </button>
        ))}
      </div>
      <p className="caption muted">{t('help')}</p>
    </div>
  );
}
