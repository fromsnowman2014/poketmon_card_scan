import { useEffect, useMemo, useState } from 'react';
import { CardImage } from '../components/CardImage';
import { Confetti } from '../components/Confetti';
import { cx } from '../components/cx';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { TopBar } from '../components/TopBar';
import { useStrings, useUiLang, type Strings } from '../lib/i18n';
import { valueTier } from '../lib/pricing';
import { Link, useRoute } from '../lib/router';
import { getScanPhoto, pushHistory } from '../lib/store';
import { splitCardId } from '../lib/tcgdex';
import type { CardDetail, CardLang, ValueTier } from '../lib/types';
import { CardSkeleton } from './card/CardSkeleton';
import { CollectButton } from './card/CollectButton';
import { EbayPanel } from './card/EbayPanel';
import { cardNames, speciesIds, variantLabel } from './card/format';
import { MorePrices } from './card/MorePrices';
import { PriceHero } from './card/PriceHero';
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
  | 'disclaimer';

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
    disclaimer: '가격은 예상이에요. 사고팔 땐 꼭 어른과 함께!',
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
    disclaimer: 'Prices are estimates. Ask a grown\u2011up before buying or selling.',
  },
};

const LANG_CHIPS: Record<CardLang, string> = { ja: '🇯🇵 日本語', en: '🇺🇸 EN', ko: '🇰🇷 한국어' };
const CELEBRATE: ReadonlySet<ValueTier> = new Set(['rare', 'super', 'treasure']);

export interface CardScreenProps {
  lang: CardLang;
  id: string;
}

function priceOf(card: CardDetail, variantKey: string): number | null {
  return card.variants.find((v) => v.key === variantKey)?.summary?.market ?? null;
}

interface CardResultProps {
  card: CardDetail;
  /** Route language: 'ko' for Korean cards even though their data is Japanese. */
  lang: CardLang;
  photo?: string;
  fromScan: boolean;
}

function CardResult({ card, lang, photo, fromScan }: CardResultProps) {
  const t = useStrings(STRINGS);
  const uiLang = useUiLang();
  const [variantKey, setVariantKey] = useState(card.defaultVariant);
  const [zoomed, setZoomed] = useState(false);
  // Decided once on arrival: switching variants later shouldn't throw confetti again.
  const [celebrate] = useState(() => {
    const market = priceOf(card, card.defaultVariant);
    return fromScan && market !== null && CELEBRATE.has(valueTier(market));
  });

  useEffect(() => {
    pushHistory(card, priceOf(card, card.defaultVariant));
  }, [card]);

  const variant = card.variants.find((v) => v.key === variantKey) ?? card.variants[0];
  const market = variant.summary?.market ?? null;
  const tier = market === null ? null : valueTier(market);
  const { title, subtitle } = cardNames(card, lang, uiLang);
  // Korean cards carry Japanese data, but the eBay query must say "Korean"; the English name needs the species.
  const ebayCard = useMemo(
    () => ({ ...card, lang: lang === 'ko' ? lang : card.lang, dexIds: speciesIds(card) }),
    [card, lang],
  );
  const number = card.setOfficialCount ? `${card.localId}/${card.setOfficialCount}` : card.localId;
  const several = card.variants.length > 1;

  const picture = (
    <CardImage image={card.image} fallback={card.imageFallback} photo={photo} alt={title} tier={tier} eager />
  );

  return (
    <div className="screen-pad card-body">
      <div className={cx('card-hero', tier && `tier-${tier}`)}>
        <button type="button" className="card-art pop-in" onClick={() => setZoomed(true)} aria-label={t('zoom')}>
          {picture}
          <span className="card-zoom-hint" aria-hidden="true">
            <Icon name="search" size={18} strokeWidth={2.5} />
          </span>
        </button>
        {celebrate && <Confetti />}
      </div>

      <div className="card-head">
        <h1 className="card-name">{title}</h1>
        {subtitle && <p className="card-subtitle">{subtitle}</p>}
        <div className="chip-row card-chips">
          <span className="chip">
            {card.setName}
            <span className="card-chip-num tabular">#{number}</span>
          </span>
          <span className="chip">{LANG_CHIPS[lang]}</span>
          {card.rarity && <span className="chip">{card.rarity}</span>}
        </div>
      </div>

      {several && <VariantPicker variants={card.variants} selected={variant.key} onSelect={setVariantKey} />}

      <PriceHero summary={variant.summary} tier={tier} />

      <CollectButton card={card} variantKey={variant.key} photo={photo} />

      <EbayPanel card={ebayCard} />

      <MorePrices variant={variant} variantName={several ? variantLabel(variant.key, uiLang) : undefined} />

      <p className="caption muted card-disclaimer">{t('disclaimer')}</p>

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
