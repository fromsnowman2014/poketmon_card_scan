// Options for Settings' "where you live" and money pickers.
import { COUNTRY_CURRENCY, COUNTRY_FLAG } from '../../lib/region';
import type { Country, DisplayCurrency, UiLang } from '../../lib/types';
import type { SegmentOption } from './Segmented';

const COUNTRY_NAME: Record<UiLang, Record<Country, string>> = {
  ko: { KR: '한국', US: '미국' },
  en: { US: 'USA', KR: 'Korea' },
};

const MONEY_NAME: Record<UiLang, Record<DisplayCurrency, string>> = {
  ko: { KRW: '원 (₩)', USD: '달러 ($)' },
  en: { USD: '$ Dollars', KRW: '₩ Won' },
};

/**
 * "🇰🇷 한국" / "🇺🇸 USA" (the flag is decoration, so screen readers hear just the name). A stable order that doesn't
 * jump when picked: 한국 first in Korean, USA first in English.
 */
export function countryOptions(lang: UiLang): SegmentOption<Country>[] {
  const order: Country[] = lang === 'ko' ? ['KR', 'US'] : ['US', 'KR'];
  return order.map((c) => ({ value: c, emoji: COUNTRY_FLAG[c], label: COUNTRY_NAME[lang][c] }));
}

/** "원 (₩)" / "$ Dollars", the money of the kid's country first. */
export function currencyOptions(lang: UiLang, country: Country): SegmentOption<DisplayCurrency>[] {
  const order: DisplayCurrency[] = COUNTRY_CURRENCY[country] === 'KRW' ? ['KRW', 'USD'] : ['USD', 'KRW'];
  return order.map((c) => ({ value: c, label: MONEY_NAME[lang][c] }));
}

/** True when a grown-up switched the money away from the country's own (a dollar view in Korea, won in the US). */
export function moneyOverridden(country: Country, currency: DisplayCurrency): boolean {
  return COUNTRY_CURRENCY[country] !== currency;
}
