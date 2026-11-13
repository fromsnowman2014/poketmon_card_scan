import { useEffect, useState } from 'react';
import { version } from '../../package.json';
import { ExternalLink } from '../components/ExternalLink';
import { Icon } from '../components/Icon';
import { TopBar } from '../components/TopBar';
import { useStrings, type Strings } from '../lib/i18n';
import { useRoute } from '../lib/router';
import { updateSettings, useSettings } from '../lib/store';
import type { Settings } from '../lib/types';
import { EbayWorker } from './settings/EbayWorker';
import { BackupSection } from './settings/BackupSection';
import { InstallGuide } from './settings/InstallGuide';
import { countryOptions, currencyOptions, moneyOverridden } from './settings/regionOptions';
import { ResetData } from './settings/ResetData';
import { Segmented, type SegmentOption } from './settings/Segmented';
import { StorageInfo } from './settings/StorageInfo';
import './SettingsScreen.css';

type Key =
  | 'title'
  | 'country'
  | 'livesKR'
  | 'livesUS'
  | 'language'
  | 'currency'
  | 'seeingUSD'
  | 'seeingKRW'
  | 'theme'
  | 'system'
  | 'dark'
  | 'light'
  | 'searchLang'
  | 'searchLangNote'
  | 'credits'
  | 'tcgdex'
  | 'tcgcsv'
  | 'pokeapi'
  | 'tesseract'
  | 'rates'
  | 'disclaimer'
  | 'grownUp'
  | 'version';

const STRINGS: Strings<Key> = {
  ko: {
    title: '설정',
    country: '사는 곳',
    livesKR: '가격은 원(₩)으로 보여 줘요.',
    livesUS: '가격은 달러($)로 보여 줘요.',
    language: '언어 · Language',
    currency: '돈 단위',
    seeingUSD: '원 대신 달러로 보고 있어요.',
    seeingKRW: '달러 대신 원으로 보고 있어요.',
    theme: '테마',
    system: '자동',
    dark: '다크',
    light: '라이트',
    searchLang: '기본 검색 언어',
    searchLangNote: '한국어 카드는 日本語로 찾아요. 세트 번호가 같아요.',
    credits: '데이터 출처',
    tcgdex: '카드 정보 · 사진 · 가격 (TCGplayer, Cardmarket)',
    tcgcsv: '일본 카드 가격 (TCGplayer, 하루 한 번)',
    pokeapi: '포켓몬 이름 (한국어 · 日本語 · English)',
    tesseract: '카드 번호 읽기 (내 폰 안에서만)',
    rates: '환율',
    disclaimer:
      'CardCheck는 Nintendo, The Pokémon Company, Creatures, GAME FREAK, eBay와 관계없는 무료 앱이에요. 포켓몬과 카드 이름은 각 회사의 상표예요.',
    grownUp: '가격은 예상이에요. 사고팔 땐 꼭 어른과 함께해요!',
    version: 'CardCheck {v} · 무료 · 광고 없음',
  },
  en: {
    title: 'Settings',
    country: 'Where you live',
    livesKR: 'Prices show in won (₩).',
    livesUS: 'Prices show in dollars ($).',
    language: 'Language · 언어',
    currency: 'Money',
    seeingUSD: 'You’re seeing dollars, not won.',
    seeingKRW: 'You’re seeing won, not dollars.',
    theme: 'Theme',
    system: 'Auto',
    dark: 'Dark',
    light: 'Light',
    searchLang: 'Default search language',
    searchLangNote: 'Korean cards are under 日本語. They share set codes.',
    credits: 'Data credits',
    tcgdex: 'Card info, pictures and prices (TCGplayer, Cardmarket)',
    tcgcsv: 'Japanese card prices (TCGplayer, once a day)',
    pokeapi: 'Pokémon names (English, 한국어, 日本語)',
    tesseract: 'Reads the card number (on your phone only)',
    rates: 'Exchange rates',
    disclaimer:
      'CardCheck is a free app not affiliated with Nintendo, The Pokémon Company, Creatures, GAME FREAK or eBay. Pokémon and card names are trademarks of their owners.',
    grownUp: 'Prices are estimates. Ask a grown-up before buying or selling!',
    version: 'CardCheck {v} · Free · No ads',
  },
};

const CREDITS: { name: string; url: string; key: 'tcgdex' | 'tcgcsv' | 'pokeapi' | 'tesseract' | 'rates' }[] = [
  { name: 'TCGdex', url: 'https://tcgdex.dev', key: 'tcgdex' },
  // The daily TCGplayer price files for Japanese cards are built from it (scripts/build-ja-prices.mjs).
  { name: 'TCGCSV', url: 'https://tcgcsv.com', key: 'tcgcsv' },
  { name: 'PokeAPI', url: 'https://pokeapi.co', key: 'pokeapi' },
  { name: 'Tesseract.js', url: 'https://github.com/naptha/tesseract.js', key: 'tesseract' },
  // open.er-api.com's free tier asks for this attribution.
  { name: 'ExchangeRate-API', url: 'https://www.exchangerate-api.com', key: 'rates' },
];

function Field<T extends string>({ id, label, note, value, options, onChange }: {
  id: string;
  label: string;
  note?: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="settings-field">
      <h2 id={id} className="settings-label">
        {label}
      </h2>
      <Segmented labelledBy={id} value={value} options={options} onChange={onChange} />
      {note && <p className="caption muted settings-note">{note}</p>}
    </div>
  );
}

/** `/settings?section=<name>` opens the screen at that section (links from the "where cards are saved" notice). */
const SECTION_IDS: Partial<Record<string, string>> = {
  backup: 'settings-backup',
  install: 'settings-install',
  storage: 'settings-storage',
};

function useScrollToSection(section: string | null): void {
  useEffect(() => {
    const id = section ? SECTION_IDS[section] : undefined;
    const el = id ? document.getElementById(id) : null;
    if (!el) return;
    // After the router has put the page at the top for the new screen.
    const frame = requestAnimationFrame(() => {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
      // Screen readers start reading at the section too.
      const heading = el.querySelector<HTMLElement>('h2');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [section]);
}

export default function SettingsScreen() {
  const t = useStrings(STRINGS);
  useScrollToSection(useRoute().query.get('section'));
  const settings = useSettings();
  // Bumped after "Reset all data" so sections holding local drafts start over from the reset settings.
  const [resets, setResets] = useState(0);
  const set = <K extends keyof Settings>(key: K) => (value: Settings[K]) => updateSettings({ [key]: value });
  // A grown-up picked the other money: the money note says so, and the country note (which would contradict it) hides.
  const overridden = moneyOverridden(settings.country, settings.currency);

  return (
    <main className="screen settings">
      <TopBar title={t('title')} back />
      <div className="screen-pad stack-24">
        <div className="surface settings-group">
          <Field
            id="settings-country"
            label={t('country')}
            note={overridden ? undefined : t(settings.country === 'KR' ? 'livesKR' : 'livesUS')}
            value={settings.country}
            options={countryOptions(settings.uiLang)}
            // The store also switches the money and the search language to the new country's.
            onChange={set('country')}
          />
          <Field
            id="settings-lang"
            label={t('language')}
            value={settings.uiLang}
            options={[
              { value: 'ko', label: '한국어', lang: 'ko' },
              { value: 'en', label: 'English', lang: 'en' },
            ]}
            onChange={set('uiLang')}
          />
          <Field
            id="settings-currency"
            label={t('currency')}
            note={overridden ? t(settings.currency === 'USD' ? 'seeingUSD' : 'seeingKRW') : undefined}
            value={settings.currency}
            options={currencyOptions(settings.uiLang, settings.country)}
            onChange={set('currency')}
          />
          <Field
            id="settings-theme"
            label={t('theme')}
            value={settings.theme}
            options={[
              { value: 'system', label: t('system') },
              { value: 'dark', label: t('dark'), icon: 'moon' },
              { value: 'light', label: t('light'), icon: 'sun' },
            ]}
            onChange={set('theme')}
          />
          <Field
            id="settings-search"
            label={t('searchLang')}
            // Only for kids who may hold Korean cards (like the Search screen's note): Korea, or the Korean UI.
            note={settings.country === 'KR' || settings.uiLang === 'ko' ? t('searchLangNote') : undefined}
            // Korean cards are looked up in the JA data, so a stored 'ko' shows as 日本語.
            value={settings.searchLang === 'en' ? 'en' : 'ja'}
            options={[
              { value: 'en', label: 'English', lang: 'en' },
              { value: 'ja', label: '日本語', lang: 'ja' },
            ]}
            onChange={set('searchLang')}
          />
        </div>

        <EbayWorker key={resets} />
        <InstallGuide />
        <StorageInfo />
        <BackupSection />

        <section className="settings-section" aria-labelledby="settings-credits">
          <h2 id="settings-credits" className="settings-heading">
            <Icon name="info" size={20} />
            {t('credits')}
          </h2>
          <div className="surface stack-16">
            <ul className="settings-credits">
              {CREDITS.map((c) => (
                <li key={c.name}>
                  <ExternalLink kind="site" site={c.name} className="link settings-ext" href={c.url}>
                    {c.name}
                    <Icon name="external-link" size={14} />
                  </ExternalLink>
                  <span className="small muted">{t(c.key)}</span>
                </li>
              ))}
            </ul>
            <div className="divider" />
            <p className="caption muted settings-text">{t('disclaimer')}</p>
            <p className="small settings-grownup">{t('grownUp')}</p>
          </div>
        </section>

        <ResetData onReset={() => setResets((n) => n + 1)} />
        <p className="caption muted settings-version">{t('version', { v: `v${version}` })}</p>
      </div>
    </main>
  );
}
