import { useEffect, useMemo, useState } from 'react';
import { CardImage } from '../components/CardImage';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { SearchBar } from '../components/SearchBar';
import { Skeleton } from '../components/Skeleton';
import { TopBar } from '../components/TopBar';
import { useStrings, useUiLang, type Strings } from '../lib/i18n';
import { nameInUiLang } from '../lib/localName';
import { Link, navigate, useRoute } from '../lib/router';
import { useSettings } from '../lib/store';
import { searchCards } from '../lib/tcgdex';
import type { CardBrief, CardLang } from '../lib/types';
import { useOnline } from '../lib/useOnline';
import './SearchScreen.css';

type Key =
  | 'title'
  | 'langs'
  | 'koNote'
  | 'searching'
  | 'found'
  | 'foundOne'
  | 'foundMany'
  | 'startTitle'
  | 'startText'
  | 'notFoundTitle'
  | 'notFoundText'
  | 'numberTitle'
  | 'numberText'
  | 'tryLang'
  | 'errorTitle'
  | 'errorText'
  | 'offlineTitle'
  | 'offlineText'
  | 'retry';

const STRINGS: Strings<Key> = {
  ko: {
    title: '카드 찾기',
    langs: '카드 언어',
    koNote: '한국어 카드는 日本語에서 찾아요. 세트 번호가 같아요.',
    searching: '찾는 중…',
    found: '{n}장 찾았어요',
    foundOne: '1장 찾았어요',
    foundMany: '{n}장 넘게 찾았어요. 더 자세히 써 볼까요?',
    startTitle: '어떤 카드를 찾을까요?',
    startText: '이름이나 카드 아래 번호를 써 보세요.',
    notFoundTitle: '음… 못 찾았어요',
    notFoundText: '영어 이름으로 써 보거나, 카드 아래 번호(예: 084/187)를 넣어 보세요.',
    numberTitle: '번호를 조금 더 알려 주세요',
    numberText: '084/187처럼 / 뒤 숫자까지, 또는 sv8a 084처럼 세트 기호와 함께 써요.',
    tryLang: '{lang}에서 찾아보기',
    errorTitle: '앗, 잠깐 문제가 생겼어요',
    errorText: '잠시 뒤 다시 해 볼까요?',
    offlineTitle: '인터넷이 없어요',
    offlineText: '연결되면 다시 찾아볼게요. 내 카드는 안전해요.',
    retry: '다시 해 보기',
  },
  en: {
    title: 'Find a card',
    langs: 'Card language',
    koNote: 'Korean cards are under 日本語. They share set codes.',
    searching: 'Searching…',
    found: '{n} cards found',
    foundOne: '1 card found',
    foundMany: 'Over {n} cards. Try adding more words?',
    startTitle: 'Which card are you looking for?',
    startText: 'Type a name or the number at the bottom of the card.',
    notFoundTitle: 'Hmm, can’t find it',
    notFoundText: 'Try the English name, or the number at the bottom like 084/187.',
    numberTitle: 'Tell me a bit more',
    numberText: 'Add the number after the slash (084/187) or the set code (sv8a 084).',
    tryLang: 'Try {lang}',
    errorTitle: 'Oops, something went wrong',
    errorText: 'Let’s try again in a moment.',
    offlineTitle: 'No internet',
    offlineText: 'We’ll search once you’re back online. Your cards are safe here.',
    retry: 'Try again',
  },
};

type SearchLang = Extract<CardLang, 'en' | 'ja'>;

const LANG_LABELS: Record<SearchLang, string> = { en: 'English', ja: '日本語' };
const EXAMPLES: Record<'ko' | 'en', string[]> = {
  ko: ['피카츄', '리자몽 ex', 'sv8a 084/187'],
  en: ['Pikachu', 'Charizard ex', 'sv8a 084/187'],
};
const DEBOUNCE_MS = 350;
const LIMIT = 60;
const SKELETONS = 9;

type Result = { key: string; cards: CardBrief[] } | { key: string; error: true };

const CARD_LANGS: readonly string[] = ['en', 'ja', 'ko'] satisfies CardLang[];
const isCardLang = (x: string | null): x is CardLang => x !== null && CARD_LANGS.includes(x);

function searchHref(q: string, lang: CardLang): string {
  return q ? `/search?q=${encodeURIComponent(q)}&lang=${lang}` : `/search?lang=${lang}`;
}

function ResultCard({ card, routeLang }: { card: CardBrief; routeLang: CardLang }) {
  const uiLang = useUiLang();
  const subtitle = useMemo(() => (card.lang === 'en' ? undefined : nameInUiLang(card.name, uiLang)), [card, uiLang]);
  // Korean searches read the JA data but keep "ko" in the route so the card screen speaks Korean (eBay query etc.).
  const lang = routeLang === 'ko' && card.lang === 'ja' ? 'ko' : card.lang;
  return (
    <li>
      <Link to={`/card/${lang}/${encodeURIComponent(card.id)}`} className="search-card">
        <span className="search-card-art">
          {/* Newer JA sets have no pictures yet (and a few images fail): the card back shows the code instead. */}
          <CardImage image={card.image} alt={card.name} size="thumb" code={{ set: card.setId, number: card.localId }} />
        </span>
        <span className="search-card-text">
          <span className="search-card-name truncate">{card.name}</span>
          {subtitle && <span className="search-card-sub truncate">{subtitle}</span>}
          <span className="search-card-set">
            {card.setName && <span className="truncate">{card.setName} ·</span>}
            <span className="search-card-num">#{card.localId}</span>
          </span>
        </span>
      </Link>
    </li>
  );
}

function LoadingGrid() {
  return (
    <ul className="search-grid" aria-hidden="true">
      {Array.from({ length: SKELETONS }, (_, i) => (
        <li key={i} className="search-card">
          <Skeleton shape="card" />
          <span className="search-card-text">
            <Skeleton width="80%" height={14} />
            <Skeleton width="55%" height={12} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function SearchScreen() {
  const t = useStrings(STRINGS);
  const uiLang = useUiLang();
  const settings = useSettings();
  const online = useOnline();
  const { query } = useRoute();
  const q = (query.get('q') ?? '').trim();
  const queryLang = query.get('lang');
  const lang: CardLang = isCardLang(queryLang) ? queryLang : settings.searchLang;
  const dataLang: SearchLang = lang === 'en' ? 'en' : 'ja';
  const [text, setText] = useState(q);
  const [result, setResult] = useState<Result>();
  const [attempt, setAttempt] = useState(0);
  // A retry tap or the connection coming back starts a fresh search (and shows the skeleton again).
  const key = `${lang}|${q}|${attempt}|${online}`;

  // Typing updates the route (replace, so Back leaves the search) once the user pauses.
  useEffect(() => {
    if (text.trim() === q) return;
    const timer = window.setTimeout(() => navigate(searchHref(text.trim(), lang), { replace: true }), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text, q, lang]);

  useEffect(() => {
    if (!q) return;
    let live = true;
    searchCards(q, lang, LIMIT).then(
      (cards) => live && setResult({ key, cards }),
      () => live && setResult({ key, error: true }),
    );
    return () => {
      live = false;
    };
  }, [q, lang, key]);

  const go = (nextQ: string, nextLang: CardLang = lang) => {
    setText(nextQ);
    navigate(searchHref(nextQ.trim(), nextLang), { replace: true });
  };

  const current = q && result?.key === key ? result : undefined;
  const otherLang: SearchLang = dataLang === 'en' ? 'ja' : 'en';
  const bareNumber = /^\d{1,3}$/.test(q);

  let body;
  if (!q) {
    body = (
      <EmptyState
        emoji="🔎"
        title={t('startTitle')}
        text={t('startText')}
        action={
          <div className="chip-row search-examples">
            {EXAMPLES[uiLang].map((example) => (
              <button key={example} type="button" className="chip" onClick={() => go(example)}>
                {example}
              </button>
            ))}
          </div>
        }
      />
    );
  } else if (!current) {
    body = (
      <div className="stack-12" aria-busy="true">
        <p className="search-status caption muted" role="status">
          <span className="spinner search-spinner" aria-hidden="true" />
          {t('searching')}
        </p>
        <LoadingGrid />
      </div>
    );
  } else if ('error' in current) {
    body = online ? (
      <EmptyState
        emoji="😵"
        title={t('errorTitle')}
        text={t('errorText')}
        action={
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => setAttempt((n) => n + 1)}>
            <Icon name="refresh" />
            {t('retry')}
          </button>
        }
      />
    ) : (
      <EmptyState emoji="📡" title={t('offlineTitle')} text={t('offlineText')} />
    );
  } else if (!current.cards.length) {
    body = bareNumber ? (
      <EmptyState emoji="🔢" title={t('numberTitle')} text={t('numberText')} />
    ) : (
      <EmptyState
        emoji="🤔"
        title={t('notFoundTitle')}
        text={t('notFoundText')}
        action={
          <button type="button" className="btn btn-secondary btn-lg btn-block" onClick={() => go(q, otherLang)}>
            <Icon name="globe" />
            {t('tryLang', { lang: LANG_LABELS[otherLang] })}
          </button>
        }
      />
    );
  } else {
    const n = current.cards.length;
    body = (
      <div className="stack-12">
        <p className="search-status caption muted" role="status">
          {n >= LIMIT ? t('foundMany', { n }) : n === 1 ? t('foundOne') : t('found', { n })}
        </p>
        <ul className="search-grid fade-in">
          {current.cards.map((card) => (
            <ResultCard key={`${card.lang}:${card.id}`} card={card} routeLang={lang} />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <main className="screen search">
      <TopBar title={t('title')} back />
      <div className="screen-pad stack-16">
        <SearchBar value={text} onChange={setText} onSubmit={(next) => go(next)} autoFocus={!q} />
        <div className="stack-8">
          <div className="chip-row" role="group" aria-label={t('langs')}>
            {(['en', 'ja'] as const).map((l) => (
              <button
                key={l}
                type="button"
                className="chip search-lang"
                aria-pressed={dataLang === l}
                lang={l}
                onClick={() => go(text, l)}
              >
                {LANG_LABELS[l]}
              </button>
            ))}
          </div>
          <p className="caption muted search-note">{t('koNote')}</p>
        </div>
        {body}
      </div>
    </main>
  );
}
