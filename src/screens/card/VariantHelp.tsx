import { useId, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Money } from '../../components/Money';
import { Sheet } from '../../components/Sheet';
import { useStrings, useUiLang, type Strings } from '../../lib/i18n';
import { isApproxPrice } from '../../lib/pricing';
import type { CardVariant } from '../../lib/types';
import { foilName, variantLabel, type VariantLabelContext } from './format';
import { hasShinyPatterns, howToTell, patternArt, type HowKey, type PatternArt } from './printing';

type Key = 'depends' | 'dependsPlain' | 'howTo' | 'title' | 'intro' | 'introPlain' | 'foot' | 'noPrice' | HowKey;

const STRINGS: Strings<Key> = {
  ko: {
    depends: '반짝이 무늬에 따라 가격이 달라요.',
    dependsPlain: '어떤 카드인지에 따라 가격이 달라요.',
    howTo: '구별하는 법',
    title: '내 카드는 어떤 거예요?',
    intro: '카드를 빛에 살짝 기울여서 아래쪽을 봐요.',
    introPlain: '카드를 빛에 살짝 기울여서 어디가 반짝이는지 봐요.',
    foot: '맨 위 그림은 내 카드와 무늬가 다를 수 있어요.',
    noPrice: '가격 없음',
    normal: '반짝이지 않아요.',
    normalNoBall: '반짝이지 않아요. 볼 무늬가 없어요.',
    holo: '그림만 반짝여요.',
    mirror: '그림만 빼고 다 반짝여요.',
    pokeball: '반짝이고 몬스터볼 무늬가 있어요.',
    masterball: '반짝이고 볼에 M이 있어요. 드물어요!',
    energy: '반짝이고 큰 에너지 마크가 있어요.',
    ball: '반짝이고 {ball} 무늬가 있어요.',
    rocket: '반짝이고 큰 R 무늬가 있어요.',
    firstEdition: '작은 1st 에디션 마크가 있어요.',
    stamp: '도장이 하나 더 찍혀 있어요.',
    jumbo: '다른 카드보다 훨씬 큰 카드예요.',
  },
  en: {
    depends: 'The price depends on the shiny pattern.',
    dependsPlain: 'The price depends on which one you have.',
    howTo: 'How to tell',
    title: 'Which one is your card?',
    intro: 'Tilt your card in the light and look at the bottom half.',
    introPlain: 'Tilt your card in the light and see where it shines.',
    foot: 'The picture at the top may show a different pattern than your card.',
    noPrice: 'No price',
    normal: 'Not shiny.',
    normalNoBall: 'Not shiny. No ball pattern.',
    holo: 'Only the picture is shiny.',
    mirror: 'Shiny all over, except the picture.',
    pokeball: 'Shiny, with a Poké Ball pattern.',
    masterball: 'Shiny, and the ball has an M on it. Rare!',
    energy: 'Shiny, with one big energy symbol.',
    ball: 'Shiny, with a {ball} pattern.',
    rocket: 'Shiny, with a big R.',
    firstEdition: 'Has a small 1st Edition mark.',
    stamp: 'Has an extra stamp on it.',
    jumbo: 'A giant card, much bigger than the others.',
  },
};

const INK = '#334155';

/**
 * Our own little drawing of what to look for (simple shapes, not card art): a card that is flat, shiny in the picture
 * or shiny all over, with the mark of its pattern in the bottom half: a ball, a ball with an M, a spark, an R.
 */
function PatternPicture({ art }: { art: PatternArt }) {
  const shine = `${useId().replace(/:/g, '')}-shine`;
  const letter = art.mark === 'master' ? 'M' : art.mark === 'rocket' ? 'R' : null;
  return (
    <svg className="card-help-art" viewBox="0 0 46 64" width="46" height="64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={shine} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset=".35" stopColor="#a5f3fc" />
          <stop offset=".65" stopColor="#f5d0fe" />
          <stop offset="1" stopColor="#fde68a" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="44" height="62" rx="4" fill={art.shine === 'body' ? `url(#${shine})` : '#fcd34d'} stroke="#94a3b8" strokeWidth="1.5" />
      <rect x="5" y="8" width="36" height="20" rx="1.5" fill={art.shine === 'picture' ? `url(#${shine})` : '#e0f2fe'} stroke="#64748b" />
      {art.shine === 'picture' && <path fill="#fff" d="M33 11l1.3 3.2 3.2 1.3-3.2 1.3L33 20l-1.3-3.2-3.2-1.3 3.2-1.3z" />}
      {art.shine === 'body' && (
        <g fill="#fff">
          <path d="M39 3l1.1 2.7 2.7 1.1-2.7 1.1L39 10.6l-1.1-2.7-2.7-1.1 2.7-1.1z" />
          <path d="M7 53l.9 2.1 2.1.9-2.1.9L7 59l-.9-2.1L4 56l2.1-.9z" />
        </g>
      )}
      {art.mark && <circle cx="23" cy="45" r="10.5" fill="#fff" stroke={INK} strokeWidth="1.6" />}
      {art.mark === 'ball' && (
        <g fill="#fff" stroke={INK} strokeWidth="1.6">
          <path d="M12.5 45h21" />
          <circle cx="23" cy="45" r="3" />
        </g>
      )}
      {art.mark === 'energy' && <path fill={INK} d="M23 37.6l2 5.4 5.4 2-5.4 2-2 5.4-2-5.4-5.4-2 5.4-2z" />}
      {letter && (
        <text x="23" y="49.4" textAnchor="middle" fontSize="12.5" fontWeight="900" fill={INK}>
          {letter}
        </text>
      )}
      {art.stamp && <circle cx="10" cy="34" r="3.6" fill="#f59e0b" stroke={INK} strokeWidth="1.2" />}
    </svg>
  );
}

export interface VariantHelpProps {
  variants: CardVariant[];
  selected: string;
  onSelect: (key: string) => void;
  /** Card language and sibling keys, for the names and the drawings. */
  labels: VariantLabelContext;
  /** Show every price as approximate (Korean-card route). */
  approx?: boolean;
}

/**
 * One line under the price panel ("The price depends on the shiny pattern. How to tell ›") that opens a sheet with
 * every printing: our drawing of its pattern, its full name, how to recognize it and its price. Tapping a row picks
 * that printing and closes the sheet. Render only when the card has more than one printing.
 */
export function VariantHelp({ variants, selected, onSelect, labels, approx }: VariantHelpProps) {
  const t = useStrings(STRINGS);
  const lang = useUiLang();
  const [open, setOpen] = useState(false);
  const arts = variants.map((v) => patternArt(v, labels));

  const pick = (key: string) => {
    onSelect(key);
    setOpen(false);
  };

  return (
    <>
      <p className="caption muted card-variant-how">
        <span>{t(hasShinyPatterns(variants) ? 'depends' : 'dependsPlain')}</span>
        <button type="button" className="link card-variant-how-link" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          {t('howTo')}
          <span aria-hidden="true">›</span>
        </button>
      </p>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('title')}>
        <div className="card-help">
          <p className="small muted card-help-intro">{t(arts.some((a) => a.mark) ? 'intro' : 'introPlain')}</p>
          <div className="card-help-rows">
            {variants.map((v, i) => {
              const how = howToTell(v, labels);
              const market = v.summary?.market ?? null;
              return (
                <button key={v.key} type="button" className="card-help-row" aria-pressed={v.key === selected} onClick={() => pick(v.key)}>
                  <PatternPicture art={arts[i]} />
                  <span className="card-help-text">
                    <span className="card-help-name">{variantLabel(v.key, lang, labels)}</span>
                    {how && <span className="card-help-how">{t(how, how === 'ball' && v.foil ? { ball: foilName(v.foil, lang) } : undefined)}</span>}
                  </span>
                  {market === null ? (
                    <span className="card-help-none">{t('noPrice')}</span>
                  ) : (
                    <Money usd={market} approx={approx || isApproxPrice(v.summary)} className="card-help-price" />
                  )}
                  <span className="card-tile-check" aria-hidden="true">
                    <Icon name="check" size={12} strokeWidth={3.5} />
                  </span>
                </button>
              );
            })}
          </div>
          <p className="caption muted card-help-foot">{t('foot')}</p>
        </div>
      </Sheet>
    </>
  );
}
