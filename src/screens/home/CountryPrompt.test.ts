import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let zone = 'UTC';
let data: Map<string, string>;
let blocked = false;
let store: typeof import('../../lib/store');
let prompt: typeof import('./CountryPrompt');

/** A fresh app load on a phone with this language and time zone (localStorage kept unless `wipe`). */
async function launch(language: string, timeZone: string, wipe = true) {
  zone = timeZone;
  if (wipe) data = new Map();
  vi.stubGlobal('navigator', { language, languages: [language] });
  vi.stubGlobal('localStorage', {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (blocked) throw new DOMException('blocked', 'SecurityError');
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  });
  vi.resetModules();
  store = await import('../../lib/store');
  prompt = await import('./CountryPrompt');
}

const shown = () => renderToStaticMarkup(createElement(prompt.CountryPrompt)).includes('어디에 살아요?');
const settings = () => {
  let value: import('../../lib/types').Settings | undefined;
  renderToStaticMarkup(
    createElement(() => {
      value = store.useSettings();
      return null;
    }),
  );
  return value!;
};

beforeEach(() => {
  blocked = false;
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...real.call(this), timeZone: zone };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('first-launch country question', () => {
  it('is not asked when the phone says US or Korea', async () => {
    await launch('en-US', 'America/New_York');
    expect(shown()).toBe(false);
    await launch('ko-KR', 'Asia/Seoul');
    expect(shown()).toBe(false);
    await launch('ko-KR', 'America/Los_Angeles');
    expect(shown()).toBe(false);
  });

  it('is asked, in both languages with both choices, when the phone gives no hint', async () => {
    await launch('de-DE', 'Europe/Berlin');
    const html = renderToStaticMarkup(createElement(prompt.CountryPrompt));
    for (const text of ['어디에 살아요?', 'Where do you live?', '미국', 'USA', '한국', 'Korea', '달러', 'Dollars', '원', 'Won']) {
      expect(html).toContain(text);
    }
  });

  it('picking Korea switches to won and is never asked again', async () => {
    await launch('de-DE', 'Europe/Berlin');
    expect(settings()).toMatchObject({ country: 'US', currency: 'USD' });
    prompt.answerCountry('KR');
    expect(settings()).toMatchObject({ country: 'KR', currency: 'KRW', searchLang: 'ja' });
    expect(shown()).toBe(false);
    await launch('de-DE', 'Europe/Berlin', false);
    expect(shown()).toBe(false);
  });

  it('the picked button sets its money, even over older saved settings for that country', async () => {
    // A Korean-language tablet in Berlin that saved dollars before `country` existed (a real pick, so it was kept).
    data = new Map([['cc:settings', JSON.stringify({ v: 1, data: { uiLang: 'ko', currency: 'USD', searchLang: 'en' } })]]);
    await launch('ko', 'Europe/Berlin', false);
    expect(settings()).toMatchObject({ country: 'KR', currency: 'USD' });
    expect(shown()).toBe(true);
    prompt.answerCountry('KR'); // "🇰🇷 한국 · Korea ₩ 원 · Won"
    // The money follows the button; the search language it doesn't name stays the kid's pick (same country).
    expect(settings()).toMatchObject({ country: 'KR', currency: 'KRW', searchLang: 'en' });
  });

  it('reads each choice to screen readers as separate words, without the flag', async () => {
    await launch('de-DE', 'Europe/Berlin');
    const html = renderToStaticMarkup(createElement(prompt.CountryPrompt));
    expect(html).toContain('<span lang="ko">미국</span> <span aria-hidden="true">·</span> <span lang="en">USA</span>');
  });

  it('closing it keeps the guess and is never asked again', async () => {
    await launch('de-DE', 'Europe/Berlin');
    prompt.answerCountry();
    expect(settings()).toMatchObject({ country: 'US', currency: 'USD' });
    await launch('de-DE', 'Europe/Berlin', false);
    expect(shown()).toBe(false);
  });

  it('is asked once per load even when storage cannot remember the answer', async () => {
    await launch('de-DE', 'Europe/Berlin');
    blocked = true;
    prompt.answerCountry();
    expect(prompt.shouldAskCountry()).toBe(false);
    expect(shown()).toBe(false);
  });
});
