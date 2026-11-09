import { useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { COUNTRY_CURRENCY, COUNTRY_FLAG } from '../../lib/region';
import { markCountryAsked, needsCountryPrompt, updateSettings } from '../../lib/store';
import type { Country } from '../../lib/types';
import './CountryPrompt.css';

/** Asked at most once per app load, even if storage can't remember the answer (private mode, blocked storage). */
let askedThisLoad = false;

/** True when Home should ask "Where do you live?": the phone gave no confident hint and nobody answered yet. */
export function shouldAskCountry(): boolean {
  return !askedThisLoad && needsCountryPrompt();
}

/**
 * Answers the question: a picked country is saved with its money (the button names the money, so tapping "₩ 원 · Won"
 * always gives won, even when older saved settings already had that country with dollars; a real country change also
 * switches the search language, as in Settings) and the question is remembered as answered; no country (closed) keeps
 * the guess and only remembers that it was asked.
 */
export function answerCountry(country?: Country): void {
  askedThisLoad = true;
  if (country) updateSettings({ country, currency: COUNTRY_CURRENCY[country] });
  else markCountryAsked();
}

/** Both languages, because the phone may speak neither (this only shows when the phone gave no US/Korea hint). */
const CHOICES: { country: Country; ko: string; en: string; symbol: string; moneyKo: string; moneyEn: string }[] = [
  { country: 'US', ko: '미국', en: 'USA', symbol: '$', moneyKo: '달러', moneyEn: 'Dollars' },
  { country: 'KR', ko: '한국', en: 'Korea', symbol: '₩', moneyKo: '원', moneyEn: 'Won' },
];

/**
 * "<ko> · <en>", each part tagged with its language so it gets the right font and voice. `stacked` puts them on two
 * lines instead (a sentence in both languages never fits one line on a phone).
 */
function Both({ ko, en, stacked = false }: { ko: string; en: string; stacked?: boolean }) {
  if (stacked) {
    return (
      <>
        <span lang="ko" className="home-country-line">
          {ko}
        </span>{' '}
        <span lang="en" className="home-country-line">
          {en}
        </span>
      </>
    );
  }
  return (
    <>
      <span lang="ko">{ko}</span> <span aria-hidden="true">·</span> <span lang="en">{en}</span>
    </>
  );
}

/**
 * First-launch question on Home: "어디에 살아요? · Where do you live?" with a big 🇺🇸 and 🇰🇷 button. Picking one sets
 * the country (and with it the money and search language); closing it (×, backdrop, Escape) keeps the guess, which
 * can be changed in Settings. Never asked again once answered or closed.
 */
export function CountryPrompt({ onClosed }: { onClosed?: () => void }) {
  const [open, setOpen] = useState(shouldAskCountry);

  const close = (country?: Country) => {
    answerCountry(country);
    setOpen(false);
    // Nothing on the page opened the sheet, so the browser would put focus back on <body>: hand it to Home instead
    // (after the dialog has closed and restored focus).
    if (onClosed) requestAnimationFrame(onClosed);
  };

  return (
    <Sheet
      open={open}
      onClose={() => close()}
      className="home-country-sheet"
      title={<Both ko="어디에 살아요?" en="Where do you live?" stacked />}
    >
      <div className="home-country stack-16">
        <p className="home-country-text">
          <Both ko="사는 나라의 돈으로 가격을 보여 줄게요." en="We’ll show prices in your money." stacked />
        </p>
        <div className="home-country-choices">
          {CHOICES.map((c) => (
            <button key={c.country} type="button" className="home-country-choice" onClick={() => close(c.country)}>
              <span className="home-country-flag" aria-hidden="true">
                {COUNTRY_FLAG[c.country]}
              </span>
              <span className="home-country-name">
                <Both ko={c.ko} en={c.en} />
              </span>
              <span className="home-country-money">
                <span aria-hidden="true">{c.symbol} </span>
                <Both ko={c.moneyKo} en={c.moneyEn} />
              </span>
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
