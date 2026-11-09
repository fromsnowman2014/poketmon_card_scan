import { useRef } from 'react';
import { CardImage } from '../components/CardImage';
import { Icon } from '../components/Icon';
import { SearchBar } from '../components/SearchBar';
import { useStrings, type Strings } from '../lib/i18n';
import { Link, navigate } from '../lib/router';
import { useCollection, useHistory, useSettings } from '../lib/store';
import type { Country } from '../lib/types';
import { CountryPrompt } from './home/CountryPrompt';
import { HowItWorks } from './home/HowItWorks';
import { MyCardsPanel } from './home/MyCardsPanel';
import { RecentCards } from './home/RecentCards';
import { NUMBER_EXAMPLES } from './search/examples';
import './HomeScreen.css';

const STRINGS: Strings<'settings' | 'tagline' | 'scan' | 'tip' | 'searchHint'> = {
  ko: {
    settings: '설정',
    tagline: '카드를 찍으면\n가격을 알려줘요',
    scan: '카드 찍기',
    tip: '카드 아래 작은 번호(예: {code})를 읽어요',
    searchHint: '한국어 · 日本語 · English 이름, 또는 {code}',
  },
  en: {
    settings: 'Settings',
    tagline: 'Snap a card,\nsee its price',
    scan: 'Scan a card',
    tip: 'We read the small number at the bottom, like {code}',
    searchHint: 'A name in English, 한국어 or 日本語, or {code}',
  },
};

/**
 * Example codes from cards the kid has (search/examples, shared with the Search screen): Korean (and Japanese) cards
 * print "sv8a 084/187"; English Scarlet & Violet cards print "MEW EN 199/165" at the bottom left, where the number is
 * what a kid spots first, so the scan tip shows "199/165" and the search hint the full "MEW 199/165".
 */
const TIP_CODE: Record<Country, string> = { KR: NUMBER_EXAMPLES.KR.full, US: NUMBER_EXAMPLES.US.total };
const SEARCH_CODE: Record<Country, string> = { KR: NUMBER_EXAMPLES.KR.full, US: NUMBER_EXAMPLES.US.full };

export default function HomeScreen() {
  const t = useStrings(STRINGS);
  const { searchLang, country } = useSettings();
  const collection = useCollection();
  const history = useHistory();
  const firstTime = collection.length === 0 && history.length === 0;
  const [tipBefore, tipAfter = ''] = t('tip').split('{code}');
  const [hintBefore, hintAfter = ''] = t('searchHint').split('{code}');
  // Korean particles stick to the word before them: keep "(예: sv8a 084/187)를" together so "를 읽어요" never starts a line.
  const [tipGlue = '', ...tipRest] = tipAfter.split(' ');
  const tagline = useRef<HTMLHeadingElement>(null);

  return (
    <main className="screen home">
      <header className="home-header safe-top screen-pad">
        <h1 className="home-brand">
          <span className="home-logo" aria-hidden="true">
            <Icon name="cards" size={22} strokeWidth={2.2} />
          </span>
          <span className="home-wordmark">
            Card<span className="home-wordmark-accent">Check</span>
          </span>
          <span className="home-wordmark-ko" lang="ko">
            카드체크
          </span>
        </h1>
        <Link to="/settings" className="btn btn-icon btn-ghost home-gear" aria-label={t('settings')}>
          <Icon name="settings" />
        </Link>
      </header>

      <div className="screen-pad stack-24">
        <section className="surface surface-glow home-hero fade-in" aria-labelledby="home-tagline">
          <div className="home-hero-top">
            <h2 id="home-tagline" className="home-tagline" ref={tagline} tabIndex={-1}>
              {t('tagline')}
            </h2>
            <div className="home-hero-art" aria-hidden="true">
              <CardImage alt="" className="home-hero-card" />
              <CardImage alt="" className="home-hero-card" />
              <CardImage alt="" className="home-hero-card" />
            </div>
          </div>
          <Link to="/scan" className="btn btn-primary btn-lg btn-block home-scan">
            <Icon name="camera" size={28} strokeWidth={2.2} />
            {t('scan')}
          </Link>
          <p className="home-tip">
            <Icon name="info" size={18} className="home-tip-icon" />
            <span>
              {tipBefore}
              <span className="home-tip-keep">
                <span className="home-tip-code">{TIP_CODE[country]}</span>
                {tipGlue}
              </span>
              {tipRest.length > 0 && ` ${tipRest.join(' ')}`}
            </span>
          </p>
        </section>

        <div className="stack-8">
          <SearchBar onSubmit={(q) => navigate(`/search?q=${encodeURIComponent(q)}&lang=${searchLang}`)} />
          <p className="caption muted home-search-hint">
            {hintBefore}
            <span className="home-search-code">{SEARCH_CODE[country]}</span>
            {hintAfter}
          </p>
        </div>

        {firstTime ? (
          <HowItWorks />
        ) : (
          <>
            <MyCardsPanel items={collection} />
            {history.length > 0 && <RecentCards items={history} />}
          </>
        )}
      </div>

      <CountryPrompt onClosed={() => tagline.current?.focus()} />
    </main>
  );
}
