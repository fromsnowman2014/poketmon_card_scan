import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { CardImage } from '../components/CardImage';
import { Confetti } from '../components/Confetti';
import { cx } from '../components/cx';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { useValueTier } from '../components/TierBadge';
import { showToast } from '../components/Toast';
import { TopBar } from '../components/TopBar';
import { ebayQuery } from '../lib/ebay';
import { useRates } from '../lib/fx';
import { useStrings, useUiLang, type Strings } from '../lib/i18n';
import { applyRates, isApproxPrice } from '../lib/pricing';
import { Link, useRoute } from '../lib/router';
import { getScanPhoto, pushHistory, updateCollectionPrice, useCollection, useSettings } from '../lib/store';
import { splitCardId } from '../lib/tcgdex';
import type { CardDetail, CardLang, CardVariant, ValueTier } from '../lib/types';
import { CardSkeleton } from './card/CardSkeleton';
import { CollectButton } from './card/CollectButton';
import { EBAY_PANEL_ID, EbayPanel } from './card/EbayPanel';
import { cardNames, labelContext, printedNumberOf, rarityLabel, speciesIds, variantLabel, type VariantLabelContext } from './card/format';
import { MorePrices } from './card/MorePrices';
import { FOLD_ATTR, PriceHero } from './card/PriceHero';
import { hasShinyUpgrade, isMixedMirror, isRarePattern, startVariant } from './card/printing';
import { useCardDetail } from './card/useCardDetail';
import { VariantHelp } from './card/VariantHelp';
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
  | 'koNote'
  | 'nudge'
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
    koNote: '일본판 카드 가격이에요. 한글판은 다를 수 있어요.',
    nudge: '반짝이는 카드예요? 무늬를 고르면 딱 맞는 가격이 나와요.',
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
    koNote: 'Price of the Japanese card. Korean cards can be different.',
    nudge: 'Shiny card? Tap its pattern to see the right price.',
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

/** Saved copies of this card take the prices just loaded, so My Cards doesn't wait for its daily refresh. */
function useSyncSavedPrices(card: CardDetail): void {
  const items = useCollection();
  useEffect(() => {
    for (const item of items) {
      if (item.lang !== card.lang || item.id !== card.id) continue;
      const summary = card.variants.find((v) => v.key === item.variant)?.summary;
      // A printing without a price right now keeps the price it was saved with.
      if (!summary || summary.market === null) continue;
      const approx = isApproxPrice(summary);
      if (summary.market === item.priceUsd && approx === !!item.priceApprox) continue;
      updateCollectionPrice(item.key, summary.market, approx);
    }
  }, [card, items]);
}

/** How many times a page that doesn't fit may ask CSS for room (data-tight="1", then "2"; see CardScreen.css). */
const MAX_TIGHT = 2;

/**
 * Keeps the price readable on the first view. Measures everything from the page top to the end of the low–high
 * row except the card art (a two-line name, wrapped chips, the printing tiles and a trend pill all take room) and
 * hands it to CSS as --card-fold-h, which sizes the art so that row ends above the tab bar and the raised Scan
 * button (.card-art). The elements to fit carry FOLD_ATTR; the invisible panels of the card's other printings
 * count too, so the art is sized for the tallest panel from the start and the tiles never move under a finger.
 * Re-measured whenever the body resizes, but the number only ever goes up for a card (a shorter panel must not grow
 * the art). When the art is down to its smallest size the page is "tight": data-tight lets CSS drop a line or two,
 * and the page is measured again. A new width (rotation) starts over. The art's height doesn't change the number.
 */
function useFitArt(ref: RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    const body = ref.current;
    if (!body || typeof ResizeObserver === 'undefined') return;
    let width = 0;
    let largest = 0;
    let tight = 0;
    const measure = () => {
      const art = body.querySelector<HTMLElement>('.card-art');
      const ends = [...body.querySelectorAll(`[${FOLD_ATTR}]`)];
      if (!art || !ends.length) return;
      if (body.clientWidth !== width) {
        width = body.clientWidth;
        largest = tight = 0;
        delete body.dataset.tight;
      }
      const smallest = parseFloat(getComputedStyle(art).getPropertyValue('--card-art-min')) || 0;
      for (;;) {
        const bottom = Math.max(...ends.map((el) => el.getBoundingClientRect().bottom)) + window.scrollY;
        // offsetHeight: the layout size, not the pop-in animation's scaled one.
        const value = Math.ceil(bottom - art.offsetHeight);
        if (value > largest) {
          largest = value;
          body.style.setProperty('--card-fold-h', `${value}px`);
        }
        if (tight >= MAX_TIGHT || art.offsetWidth > smallest + 0.5) return;
        body.dataset.tight = String(++tight);
        largest = 0;
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [ref]);
}

const NUDGE_KEY = 'cc:variantNudged';
let nudged = false;

/** True the first time in this session (tab): the "check the shiny pattern" toast shows once, not after every scan. */
function firstNudge(): boolean {
  try {
    if (nudged || sessionStorage.getItem(NUDGE_KEY)) return false;
    sessionStorage.setItem(NUDGE_KEY, '1');
  } catch {
    if (nudged) return false; // storage blocked: once per page load
  }
  nudged = true;
  return true;
}

interface CardResultProps {
  card: CardDetail;
  /** Route language: 'ko' for Korean cards even though their data is Japanese. */
  lang: CardLang;
  photo?: string;
  fromScan: boolean;
  /** Printing asked for by the link (`?v=`, from My Cards and Recent). */
  wanted: string | null;
}

function CardResult({ card: fetched, lang, photo, fromScan, wanted }: CardResultProps) {
  const t = useStrings(STRINGS);
  const uiLang = useUiLang();
  const { ebayWorkerUrl } = useSettings();
  const rates = useRates();
  const saved = useCollection();
  // getCard converts EUR prices with the rates it had at hand (maybe last week's or the built-in ones); redo it
  // when live rates arrive so the price, the saved copy and the history all use the same numbers.
  const card = useMemo(() => applyRates(fetched, rates), [fetched, rates]);
  // Tiers in the money shown: 5,000원 makes a 💎 용돈 카드 for a kid who sees won, $5 for one who sees dollars.
  const tierOf = useValueTier();
  // Opens on the printing the link names, else the one printing of this card the kid saved, else the usual one.
  const [variantKey, setVariantKey] = useState(() => {
    const mine = saved.filter((i) => i.lang === card.lang && i.id === card.id).map((i) => i.variant);
    return startVariant(card, wanted, mine);
  });
  const [zoomed, setZoomed] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useFitArt(bodyRef);
  // Decided once on arrival: switching variants later shouldn't throw confetti again.
  const [celebrate] = useState(() => {
    const market = card.variants.find((v) => v.key === variantKey)?.summary?.market ?? null;
    return fromScan && market !== null && CELEBRATE.has(tierOf(market));
  });

  const variant = card.variants.find((v) => v.key === variantKey) ?? card.variants[0];
  const market = variant.summary?.market ?? null;
  const approx = isApproxPrice(variant.summary);

  // Recent shows the printing the kid last looked at, with its price. Runs when the pick or its price changes, not
  // on every render (`fetched` only changes with the card).
  useEffect(() => {
    pushHistory(fetched, market, approx, variant.key);
  }, [fetched, variant.key, market, approx]);
  useSyncSavedPrices(card);

  // After a scan the screen shows the usual printing. When a shinier one costs a lot more, say so (once a session).
  const [nudge] = useState(() => fromScan && hasShinyUpgrade(card, variantKey));
  useEffect(() => {
    if (nudge && firstNudge()) showToast(t('nudge'), { icon: '✨', durationMs: 5000 });
  }, [nudge, t]);

  const tier = market === null ? null : tierOf(market);
  const { title, subtitle } = cardNames(card, lang, uiLang);
  // Korean cards carry Japanese data, but the eBay query must say "Korean"; the English name needs the species.
  // The printing is part of the words where sellers name it (Master Ball).
  const query = useMemo(
    () => ebayQuery({ ...card, lang: lang === 'ko' ? lang : card.lang, dexIds: speciesIds(card) }, variant.key),
    [card, lang, variant.key],
  );
  const several = card.variants.length > 1;
  const labels = useMemo<VariantLabelContext>(() => labelContext(lang, card.variants), [card, lang]);
  const variantName = several ? variantLabel(variant.key, uiLang, labels) : undefined;
  // A Korean card shows the Japanese card's price: never as an exact number.
  const korean = lang === 'ko';
  const mixedMirror = isMixedMirror(variant, card.variants);

  const panel = (v: CardVariant, still = false) => {
    const price = v.summary?.market ?? null;
    return (
      <PriceHero
        variant={v}
        tier={price === null ? null : tierOf(price)}
        variantName={several ? variantLabel(v.key, uiLang, labels) : undefined}
        ebayTarget={EBAY_PANEL_ID}
        approx={korean}
        mixedMirror={isMixedMirror(v, card.variants)}
        rarePattern={isRarePattern(v, card.variants)}
        still={still}
      />
    );
  };

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

      {several && (
        <VariantPicker variants={card.variants} selected={variant.key} onSelect={setVariantKey} labels={labels} approx={korean} />
      )}

      <div className="card-price-slot">
        {panel(variant)}
        {/* The other printings' panels, invisible and out of the flow: useFitArt sizes the art for the tallest one,
            so the tiles stay put whichever printing is picked. */}
        {card.variants.map(
          (v) =>
            v.key !== variant.key && (
              <div key={v.key} className="card-price-ghost" aria-hidden="true">
                {panel(v, true)}
              </div>
            ),
        )}
      </div>

      {(korean || several) && (
        <div className="card-notes">
          {korean && <p className="caption muted card-ko-note">{t('koNote')}</p>}
          {several && (
            <VariantHelp variants={card.variants} selected={variant.key} onSelect={setVariantKey} labels={labels} approx={korean} />
          )}
        </div>
      )}

      <CollectButton card={card} variantKey={variant.key} photo={photo} />

      <EbayPanel query={query} />

      <p className="caption muted card-disclaimer">{t('disclaimer')}</p>

      <MorePrices
        variant={variant}
        variantName={variantName}
        mixedMirror={mixedMirror}
        ebayQuery={query}
        workerHint={!ebayWorkerUrl}
      />

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
      {card && (
        <CardResult card={card} lang={lang} photo={photo} fromScan={query.get('from') === 'scan'} wanted={query.get('v')} />
      )}
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
