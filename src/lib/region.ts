// Where the kid lives (US or Korea), guessed from the phone: decides dollars vs won, not the UI language.
// A Korean-speaking kid in Los Angeles gets Korean screens with dollars; an English phone in Seoul gets won.
import type { CardLang, Country, DisplayCurrency } from './types';

export const COUNTRIES: readonly Country[] = ['US', 'KR'];

export const COUNTRY_FLAG: Record<Country, string> = { US: '🇺🇸', KR: '🇰🇷' };

/** The money kids in that country know. */
export const COUNTRY_CURRENCY: Record<Country, DisplayCurrency> = { US: 'USD', KR: 'KRW' };

/** Settings that follow the country until the kid (or a grown-up) changes them. */
export function countryDefaults(country: Country): { currency: DisplayCurrency; searchLang: CardLang } {
  // Korean cards share set codes and numbers with the Japanese ones, so Korean kids search the JA data.
  return country === 'KR' ? { currency: 'KRW', searchLang: 'ja' } : { currency: 'USD', searchLang: 'en' };
}

export interface RegionHints {
  /** IANA time zone, e.g. "Asia/Seoul", "America/Chicago". */
  timeZone?: string;
  /** BCP 47 tags, most preferred first, e.g. ["ko-KR", "en-US"]. */
  languages?: readonly string[];
}

export interface CountryGuess {
  country: Country;
  /** False when nothing pointed at the US or Korea (only a bare language, or nothing): the app asks once. */
  confident: boolean;
  reason: 'timezone' | 'language-region' | 'language' | 'fallback';
}

const KR_ZONES = new Set(['Asia/Seoul', 'ROK']);

// Time zones used in the 50 states and the territories that use the dollar. Canada, Mexico and South America also
// live under "America/", so a prefix match would be wrong.
const US_ZONES = new Set([
  'America/New_York',
  'America/Detroit',
  'America/Chicago',
  'America/Menominee',
  'America/Denver',
  'America/Boise',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Juneau',
  'America/Sitka',
  'America/Metlakatla',
  'America/Yakutat',
  'America/Nome',
  'America/Adak',
  'America/Puerto_Rico',
  'America/St_Thomas',
  'America/Fort_Wayne',
  'America/Indianapolis',
  'America/Knox_IN',
  'America/Louisville',
  'Pacific/Honolulu',
  'Pacific/Guam',
  'Pacific/Saipan',
  'Pacific/Pago_Pago',
  'Pacific/Midway',
  'Pacific/Wake',
  'Navajo',
  // POSIX-style zones some engines still report as they are (Chromium maps them to region zones, e.g. EST5EDT →
  // America/New_York, which is listed anyway; it maps EST to America/Panama, not a US zone).
  'EST5EDT',
  'CST6CDT',
  'MST7MDT',
  'PST8PDT',
  'EST',
  'MST',
  'HST',
]);
const US_ZONE_PREFIXES = ['America/Indiana/', 'America/Kentucky/', 'America/North_Dakota/', 'US/'];

function zoneCountry(zone: string | undefined): Country | undefined {
  if (!zone) return undefined;
  if (KR_ZONES.has(zone)) return 'KR';
  if (US_ZONES.has(zone) || US_ZONE_PREFIXES.some((p) => zone.startsWith(p))) return 'US';
  return undefined;
}

/**
 * "ko-KR" → { lang: "ko", region: "KR" }; "zh-Hant-TW" → region "TW"; "en" → no region. Only subtags before the first
 * single-letter one count: in "en-u-kr-latn" or "x-us" the two letters are extension codes, not a region.
 */
function parseTag(tag: string): { lang: string; region?: string } {
  const parts = tag.replace(/_/g, '-').split('-');
  const lang = (parts[0] ?? '').toLowerCase();
  if (lang.length === 1) return { lang };
  const rest = parts.slice(1);
  const end = rest.findIndex((p) => p.length === 1);
  const region = rest
    .slice(0, end < 0 ? undefined : end)
    .find((p) => /^[A-Za-z]{2}$/.test(p))
    ?.toUpperCase();
  return { lang, region };
}

/** The phone's time zone and preferred languages; empty when the browser hides them. */
export function readRegionHints(): RegionHints {
  let timeZone: string | undefined;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    timeZone = undefined;
  }
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const list = nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : [];
  return { timeZone, languages: list.filter((l): l is string => typeof l === 'string' && l.length > 0) };
}

/**
 * US or Korea, best evidence first:
 * 1. the time zone (where the phone is: Asia/Seoul → KR, a US zone → US);
 * 2. the first language tag with a KR or US region ("ko-KR", "en-US");
 * 3. a Korean language without a region → KR (not confident);
 * 4. otherwise US (not confident).
 */
export function guessCountry(hints: RegionHints = readRegionHints()): CountryGuess {
  const byZone = zoneCountry(hints.timeZone);
  if (byZone) return { country: byZone, confident: true, reason: 'timezone' };
  const tags = (hints.languages ?? []).map(parseTag);
  const regional = tags.find((t) => t.region === 'KR' || t.region === 'US');
  if (regional) return { country: regional.region as Country, confident: true, reason: 'language-region' };
  if (tags.some((t) => t.lang === 'ko')) return { country: 'KR', confident: false, reason: 'language' };
  return { country: 'US', confident: false, reason: 'fallback' };
}

export function detectCountry(hints?: RegionHints): Country {
  return guessCountry(hints).country;
}
