// Pure display helpers for the Card screen (kept apart from React so they are unit-tested).
import { findSpecies, translateCardName } from '../../lib/names';
import type { CardDetail, CardLang, UiLang } from '../../lib/types';

/** Changes smaller than this (percent) read as "steady". */
const TREND_THRESHOLD = 5;

const VARIANT_LABELS: Record<UiLang, Record<string, string>> = {
  ko: {
    normal: '기본',
    reverse: '리버스 홀로',
    'reverse-pokeball': '몬스터볼 미러',
    'reverse-masterball': '마스터볼 미러',
    holo: '홀로',
    firstEdition: '1st 에디션',
  },
  en: {
    normal: 'Normal',
    reverse: 'Reverse Holo',
    'reverse-pokeball': 'Poké Ball mirror',
    'reverse-masterball': 'Master Ball mirror',
    holo: 'Holo',
    firstEdition: '1st Edition',
  },
};

/** "1999-2000-copyright" → "1999–2000 Copyright". */
function humanize(raw: string): string {
  return raw
    .replace(/(\d)-(?=\d)/g, '$1–')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Kid-friendly name of a variant key. Unknown keys reuse the longest known prefix
 * ("holo-shadowless" → "Holo · Shadowless") and humanize the rest.
 */
export function variantLabel(key: string, lang: UiLang): string {
  const labels = VARIANT_LABELS[lang];
  if (labels[key]) return labels[key];
  const base = Object.keys(labels)
    .filter((k) => key.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return base ? `${labels[base]} · ${humanize(key.slice(base.length + 1))}` : humanize(key);
}

/** Where `market` sits between `low` and `high`, 0..1 (centered when the range is empty). */
export function rangePosition(low: number, high: number, market: number): number {
  if (!(high > low)) return 0.5;
  return Math.min(1, Math.max(0, (market - low) / (high - low)));
}

export type Trend = 'up' | 'down' | 'steady';

export function trendOf(changePct: number | null | undefined): Trend | null {
  if (changePct === null || changePct === undefined || !Number.isFinite(changePct)) return null;
  if (changePct > TREND_THRESHOLD) return 'up';
  if (changePct < -TREND_THRESHOLD) return 'down';
  return 'steady';
}

const TIME_LEFT: Record<UiLang, { ending: string; m: string; h: string; d: string }> = {
  ko: { ending: '곧 끝나요', m: '{n}분 남음', h: '{n}시간 남음', d: '{n}일 남음' },
  en: { ending: 'Ending now', m: '{n}m left', h: '{n}h left', d: '{n}d left' },
};

/** "3시간 남음" / "3h left" for an auction end time; '' when unparsable. */
export function timeLeft(endsAt: string, lang: UiLang, now: number = Date.now()): string {
  const end = Date.parse(endsAt);
  if (Number.isNaN(end)) return '';
  const t = TIME_LEFT[lang];
  const min = Math.floor((end - now) / 60_000);
  const fill = (s: string, n: number) => s.replace('{n}', String(n));
  if (min < 1) return t.ending;
  if (min < 60) return fill(t.m, min);
  if (min < 48 * 60) return fill(t.h, Math.floor(min / 60));
  return fill(t.d, Math.floor(min / 1440));
}

type NameCard = Pick<CardDetail, 'name' | 'dexIds' | 'hp'>;

/**
 * The card's Pokédex ids. Some new JA cards come without them; a card with HP is a Pokémon, so its
 * species is looked up by name (trainers/energy have no HP and stay empty).
 */
export function speciesIds(card: NameCard): number[] {
  if (card.dexIds.length || card.hp === undefined) return card.dexIds;
  const species = findSpecies(card.name, 1)[0];
  return species ? [species.dexId] : [];
}

const nameIn = (card: NameCard, lang: UiLang | CardLang) => translateCardName(card.name, speciesIds(card), lang);

/**
 * Big name in the card's language (Korean cards: the Korean name, since their data is Japanese) and a
 * subtitle with the name in the UI language — plus English for Korean users, who search eBay in English.
 */
export function cardNames(card: NameCard, routeLang: CardLang, uiLang: UiLang): { title: string; subtitle?: string } {
  const title = (routeLang === 'ko' && nameIn(card, 'ko')) || card.name;
  const langs: UiLang[] = uiLang === 'ko' ? ['ko', 'en'] : ['en'];
  const others = langs
    .map((l) => nameIn(card, l))
    .filter((n): n is string => !!n && n !== title)
    .filter((n, i, all) => all.indexOf(n) === i);
  return { title, subtitle: others.length ? others.join(' · ') : undefined };
}
