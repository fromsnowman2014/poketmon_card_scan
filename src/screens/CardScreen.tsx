import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { CardImage } from '../components/CardImage';
import { Confetti } from '../components/Confetti';
import { cx } from '../components/cx';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { useValueTier } from '../components/TierBadge';
import { TopBar } from '../components/TopBar';
import { ebayQuery } from '../lib/ebay';
import { useRates } from '../lib/fx';
import { useStrings, useUiLang, type Strings } from '../lib/i18n';
import { applyRates } from '../lib/pricing';
import { Link, useRoute } from '../lib/router';
import { getScanPhoto, pushHistory, updateCollectionPrice, useCollection, useSettings } from '../lib/store';
import { splitCardId } from '../lib/tcgdex';
import type { CardDetail, CardLang, ValueTier } from '../lib/types';
import { CardSkeleton } from './card/CardSkeleton';
import { CollectButton } from './card/CollectButton';
import { EBAY_PANEL_ID, EbayPanel } from './card/EbayPanel';
import { cardNames, printedNumberOf, rarityLabel, speciesIds, variantLabel } from './card/format';
import { MorePrices } from './card/MorePrices';
import { FOLD_ATTR, PriceHero } from './card/PriceHero';
import { useCardDetail } from './card/useCardDetail';
import { VariantPicker } from './card/VariantPicker';
import './CardScreen.css';

type Key =
  | 'wrong'
  | 'zoom'
  | 'loading'
  | 'missingTitle'
  | 'missingText'
  | 'rescan'
  | 'byName'
  | 'offlineTitle'
  | 'offlineText'
  | 'errorTitle'
  | 'errorText'
  | 'retry'
  | 'disclaimer'
  | CardLang;

const STRINGS: Strings<Key> = {
  ko: {
    wrong: '다른 카드예요?',
    zoom: '카드 크게 보기',
    loading: '가격 확인 중…',
    missingTitle: '음… 못 찾았어요',
    missingText: '다시 찍거나 이름을 써 볼까요?',
    rescan: '다시 찍기',
    byName: '이름으로 찾기',
    offlineTitle: '인터넷이 없어요',
    offlineText: '연결되면 다시 볼게요. 내 카드는 안전해요.',
    errorTitle: '앗, 카드를 못 불러왔어요',
    errorText: '잠깐 뒤에 다시 해 볼까요?',
    retry: '다시 해 보기',
    disclaimer: '가격은 예상이에요. 사고팔 땐 어른과 함께!',
    ja: '일본판',
    en: '영문판',
    ko: '한글판',
  },
  en: {
    wrong: 'Not this card?',
    zoom: 'Zoom in on the card',
    loading: 'Checking prices…',
    missingTitle: "Hmm, can't find it",
    missingText: 'Try again or type the name.',
    rescan: 'Scan again',
    byName: 'Search by name',
    offlineTitle: 'No internet',
    offlineText: "We'll try again when you're back online. Your cards are safe here.",
    errorTitle: "Oops, the card didn't load",
    errorText: "Let's try again in a moment.",
    retry: 'Try again',
    disclaimer: 'Prices are guesses. Ask a grown\u2011up before buying or selling.',
    ja: 'Japanese',
    en: 'English',
    ko: 'Korean',
  },
};

const LANG_FLAGS: Record<CardLang, string> = { ja: '🇯🇵', en: '🇺🇸', ko: '🇰🇷' };
const CELEBRATE: ReadonlySet<ValueTier> = new Set(['rare', 'super', 'treasure']);

export interface CardScreenProps {
  lang: CardLang;
  id: string;
}

function priceOf(card: CardDetail, variantKey: string): number | null {
  return card.variants.find((v) => v.key === variantKey)?.summary?.market ?? null;
}

/** Saved copies of this card take the prices just loaded, so My Cards doesn't wait for its daily refresh. */
function useSyncSavedPrices(card: CardDetail): void {
  const items = useCollection();
  useEffect(() => {
    for (const item of items) {
      if (item.lang !== card.lang || item.id !== card.id) continue;
      const summary = card.variants.find((v) => v.key === item.variant)?.summary;
      if (!summary || summary.market === null) continue;
      if (summary.market === item.priceUsd && summary.converted === !!item.priceApprox) continue;
      updateCollectionPrice(item.key, summary.market, summary.converted);
    }
  }, [card, items]);
}

/**
 * Keeps the price readable on the first view. Measures everything from the page top to the end of the low–high
 * row except the card art (a two-line name, wrapped chips and a trend pill all take room) and hands it to CSS as
 * --card-fold-h, which sizes the art so that row ends above the tab bar and the raised Scan button (.card-art).
 * Re-measured whenever the body resizes (fonts loading, another variant, rotation). The art's height doesn't
 * change the number, so this settles at once.
 */
function useFitArt(ref: RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    const body = ref.current;
    if (!body || typeof ResizeObserver === 'undefined') return;
    let last = '';
    const measure = () => {
      const art = body.querySelector<HTMLElement>('.card-art');
      const ends = [...body.querySelectorAll(`[${FOLD_ATTR}]`)];
      if (!art || !ends.length) return;
      const bottom = Math.max(...ends.map((el) => el.getBoundingClientRect().bottom)) + window.scrollY;
      // offsetHeight: the layout size, not the pop-in animation's scaled one.
      const value = `${Math.ceil(bottom - art.offsetHeight)}px`;
      if (value === last) return;
      last = value;
      body.style.setProperty('--card-fold-h', value);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [ref]);
}

interface CardResultProps {
  card: CardDetail;
  /** Route language: 'ko' for Korean cards even though their data is Japanese. */
  lang: CardLang;
  photo?: string;
  fromScan: boolean;
}

function CardResult({ card: fetched, lang, photo, fromScan }: CardResultProps) {
  const t = useStrings(STRINGS);
  const uiLang = useUiLang();
  const { ebayWorkerUrl } = useSettings();
  const rates = useRates();
  // getCard converts EUR prices with the rates it had at hand (maybe last week's or the built-in ones); redo it
  // when live rates arrive so the price, the saved copy and the history all use the same numbers.
  const card = useMemo(() => applyRates(fetched, rates), [fetched, rates]);
  // Tiers in the money shown: 5,000원 makes a 💎 용돈 카드 for a kid who sees won, $5 for one who sees dollars.
  const tierOf = useValueTier();
  const [variantKey, setVariantKey] = useState(card.defaultVariant);
  const [zoomed, setZoomed] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useFitArt(bodyRef);
  // Decided once on arrival: switching variants later shouldn't throw confetti again.
  const [celebrate] = useState(() => {
    const market = priceOf(card, card.defaultVariant);
    return fromScan && market !== null && CELEBRATE.has(tierOf(market));
  });

  useEffect(() => {
    const summary = card.variants.find((v) => v.key === card.defaultVariant)?.summary;
    pushHistory(card, summary?.market ?? null, !!summary?.converted);
  }, [card]);
  useSyncSavedPrices(card);

  const variant = card.variants.find((v) => v.key === variantKey) ?? card.variants[0];
  const market = variant.summary?.market ?? null;
  const tier = market === null ? null : tierOf(market);
  const { title, subtitle } = cardNames(card, lang, uiLang);
  // Korean cards carry Japanese data, but the eBay query must say "Korean"; the English name needs the species.
  const query = useMemo(
    () => ebayQuery({ ...card, lang: lang === 'ko' ? lang : card.lang, dexIds: speciesIds(card) }),
    [card, lang],
  );
  const several = card.variants.length > 1;
  const variantName = several ? variantLabel(variant.key, uiLang) : undefined;

  const picture = (
    <CardImage
      image={card.image}
      fallback={card.imageFallback}
      photo={photo}
      alt={title}
      tier={tier}
      eager
      code={{ set: card.setId, number: printedNumberOf(card) }}
    />
  );

  return (
    <div ref={bodyRef} className="screen-pad card-body">
      <div className={cx('card-hero', tier && `tier-${tier}`)}>
        <button type="button" className="card-art pop-in" onClick={() => setZoomed(true)} aria-label={t('zoom')}>
          {picture}
          <span className="card-zoom-hint" aria-hidden="true">
            <Icon name="search" size={16} strokeWidth={2.5} />
          </span>
        </button>
        {celebrate && <Confetti />}
      </div>

      <div className="card-head">
        <h1 className="card-name">{title}</h1>
        {subtitle && <p className="card-subtitle">{subtitle}</p>}
        <div className="card-chips">
          <span className="chip card-chip-set">
            <span aria-hidden="true">{LANG_FLAGS[lang]}</span>
            <span className="sr-only">{t(lang)}</span>
            <span className="card-chip-setname">{card.setName}</span>
            <span className="card-chip-num tabular">#{printedNumberOf(card)}</span>
          </span>
          {card.rarity && <span className="chip">{rarityLabel(card.rarity, uiLang)}</span>}
        </div>
      </div>

      <PriceHero summary={variant.summary} tier={tier} variantName={variantName} ebayTarget={EBAY_PANEL_ID} />

      {several && <VariantPicker variants={card.variants} selected={variant.key} onSelect={setVariantKey} />}

      <CollectButton card={card} variantKey={variant.key} photo={photo} />

      <EbayPanel query={query} />

      <p className="caption muted card-disclaimer">{t('disclaimer')}</p>

      <MorePrices variant={variant} variantName={variantName} ebayQuery={query} workerHint={!ebayWorkerUrl} />

      <Sheet open={zoomed} onClose={() => setZoomed(false)} title={title}>
        <div className="card-zoom">{picture}</div>
      </Sheet>
    </div>
  );
}

export default function CardScreen({ lang, id }: CardScreenProps) {
  const t = useStrings(STRINGS);
  const uiLang = useUiLang();
  const { query } = useRoute();
  const { state, retry } = useCardDetail(lang, id);
  const [photo] = useState(() => getScanPhoto(id));

  const card = state.status === 'ready' ? state.card : undefined;
  const code = splitCardId(id);
  const searchText = card ? cardNames(card, lang, uiLang).title : `${code.setId} ${code.localId}`;

  return (
    <main className="screen card">
      <TopBar
        back="/"
        right={
          (state.status === 'loading' || card) && (
            <Link to={`/search?q=${encodeURIComponent(searchText)}&lang=${lang}`} className="btn btn-ghost card-wrong">
              {t('wrong')}
            </Link>
          )
        }
      />
      {state.status === 'loading' && <CardSkeleton label={t('loading')} />}
      {card && <CardResult card={card} lang={lang} photo={photo} fromScan={query.get('from') === 'scan'} />}
      {state.status === 'missing' && (
        <div className="screen-pad">
          <EmptyState
            emoji="🤔"
            title={t('missingTitle')}
            text={t('missingText')}
            action={
              <>
                <Link to="/scan" className="btn btn-primary btn-lg btn-block">
                  <Icon name="camera" />
                  {t('rescan')}
                </Link>
                <Link to={`/search?lang=${lang}`} className="btn btn-secondary btn-lg btn-block">
                  <Icon name="search" />
                  {t('byName')}
                </Link>
              </>
            }
          />
        </div>
      )}
      {state.status === 'error' && (
        <div className="screen-pad">
          <EmptyState
            emoji={state.offline ? '📡' : '😵'}
            title={t(state.offline ? 'offlineTitle' : 'errorTitle')}
            text={t(state.offline ? 'offlineText' : 'errorText')}
            action={
              <button type="button" className="btn btn-primary btn-lg btn-block" onClick={retry}>
                <Icon name="refresh" />
                {t('retry')}
              </button>
            }
          />
        </div>
      )}
    </main>
  );
}
