import { useState } from 'react';
import { version } from '../../package.json';
import { Icon } from '../components/Icon';
import { TopBar } from '../components/TopBar';
import { useStrings, type Strings } from '../lib/i18n';
import { updateSettings, useSettings } from '../lib/store';
import type { Settings } from '../lib/types';
import { EbayWorker } from './settings/EbayWorker';
import { InstallGuide } from './settings/InstallGuide';
import { ResetData } from './settings/ResetData';
import { Segmented, type SegmentOption } from './settings/Segmented';
import './SettingsScreen.css';

type Key =
  | 'title'
  | 'language'
  | 'currency'
  | 'theme'
  | 'system'
  | 'dark'
  | 'light'
  | 'searchLang'
  | 'searchLangNote'
  | 'credits'
  | 'tcgdex'
  | 'pokeapi'
  | 'tesseract'
  | 'rates'
  | 'disclaimer'
  | 'grownUp'
  | 'version';

const STRINGS: Strings<Key> = {
  ko: {
    title: '설정',
    language: '언어 · Language',
    currency: '통화',
    theme: '테마',
    system: '자동',
    dark: '다크',
    light: '라이트',
    searchLang: '기본 검색 언어',
    searchLangNote: '한국어 카드는 日本語로 찾아요. 세트 번호가 같아요.',
    credits: '데이터 출처',
    tcgdex: '카드 정보 · 사진 · 가격 (TCGplayer, Cardmarket)',
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
    language: 'Language · 언어',
    currency: 'Currency',
    theme: 'Theme',
    system: 'Auto',
    dark: 'Dark',
    light: 'Light',
    searchLang: 'Default search language',
    searchLangNote: 'Korean cards are under 日本語. They share set codes.',
    credits: 'Data credits',
    tcgdex: 'Card info, pictures and prices (TCGplayer, Cardmarket)',
    pokeapi: 'Pokémon names (English, 한국어, 日本語)',
    tesseract: 'Reads the card number (on your phone only)',
    rates: 'Exchange rates',
    disclaimer:
      'CardCheck is a free app not affiliated with Nintendo, The Pokémon Company, Creatures, GAME FREAK or eBay. Pokémon and card names are trademarks of their owners.',
    grownUp: 'Prices are estimates. Ask a grown-up before buying or selling!',
    version: 'CardCheck {v} · Free · No ads',
  },
};

const CREDITS: { name: string; url: string; key: 'tcgdex' | 'pokeapi' | 'tesseract' | 'rates' }[] = [
  { name: 'TCGdex', url: 'https://tcgdex.dev', key: 'tcgdex' },
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

export default function SettingsScreen() {
  const t = useStrings(STRINGS);
  const settings = useSettings();
  // Bumped after "Reset all data" so sections holding local drafts start over from the reset settings.
  const [resets, setResets] = useState(0);
  const set = <K extends keyof Settings>(key: K) => (value: Settings[K]) => updateSettings({ [key]: value });

  return (
    <main className="screen settings">
      <TopBar title={t('title')} back />
      <div className="screen-pad stack-24">
        <div className="surface settings-group">
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
            value={settings.currency}
            options={[
              { value: 'USD', label: '$ USD' },
              { value: 'KRW', label: '₩ KRW' },
            ]}
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
            note={t('searchLangNote')}
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

        <section className="settings-section" aria-labelledby="settings-credits">
          <h2 id="settings-credits" className="settings-heading">
            <Icon name="info" size={20} />
            {t('credits')}
          </h2>
          <div className="surface stack-16">
            <ul className="settings-credits">
              {CREDITS.map((c) => (
                <li key={c.name}>
                  <a className="link settings-ext" href={c.url} target="_blank" rel="noopener noreferrer">
                    {c.name}
                    <Icon name="external-link" size={14} />
                  </a>
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
