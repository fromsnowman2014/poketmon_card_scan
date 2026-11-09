// Pure display helpers for the Card screen (kept apart from React so they are unit-tested).
import { nameInUiLang } from '../../lib/localName';
import { findSpecies, translateCardName } from '../../lib/names';
import type { CardDetail, CardLang, UiLang } from '../../lib/types';

/** Changes smaller than this (percent) get no up/down pill. */
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

/** Stamp names as TCGdex spells them (pricing.ts keys "…-stamp-<name>"); others are humanized. */
const STAMP_NAMES: Record<string, Record<UiLang, string>> = {
  gamestop: { ko: 'GameStop', en: 'GameStop' },
  'eb-games': { ko: 'EB Games', en: 'EB Games' },
  'set-logo': { ko: '세트 로고', en: 'Set logo' },
  'pre-release': { ko: '프리릴리즈', en: 'Prerelease' },
  'player-rewards-program': { ko: '플레이어 리워드', en: 'Player Rewards' },
  staff: { ko: '스태프', en: 'Staff' },
  'poketour-99': { ko: '포켓투어 99', en: 'PokéTour 99' },
};

const DETAIL_WORDS: Record<UiLang, { stamp: string; jumbo: string }> = {
  ko: { stamp: '{name} 스탬프', jumbo: '점보 카드' },
  en: { stamp: '{name} stamp', jumbo: 'Jumbo' },
};

/** "gamestop" → "GameStop 스탬프"; a duplicate counter stays apart ("gamestop-2" → "GameStop 스탬프 · 2"). */
function stampLabel(raw: string, lang: UiLang): string {
  const counted = /^(.+)-(\d+)$/.exec(raw);
  const [name, n] = !STAMP_NAMES[raw] && counted && STAMP_NAMES[counted[1]] ? [counted[1], counted[2]] : [raw, ''];
  const label = DETAIL_WORDS[lang].stamp.replace('{name}', STAMP_NAMES[name]?.[lang] ?? humanize(name));
  return n ? `${label} · ${n}` : label;
}

/** The part of a key after the known printing: sub-type, size and stamps ("shadowless", "jumbo", "stamp-gamestop"). */
function detailLabel(rest: string, lang: UiLang): string {
  const stamped = /^(?:(.*)-)?stamp-(.+)$/.exec(rest);
  const tokens = (stamped ? (stamped[1] ?? '') : rest).split('-').filter(Boolean);
  const parts: string[] = [];
  const sub = tokens.filter((tk) => tk !== 'jumbo').join('-');
  if (sub) parts.push(humanize(sub));
  if (tokens.includes('jumbo')) parts.push(DETAIL_WORDS[lang].jumbo);
  if (stamped) parts.push(stampLabel(stamped[2], lang));
  return parts.join(' · ');
}

/**
 * Kid-friendly name of a variant key. Unknown keys reuse the longest known prefix and describe the rest:
 * "holo-shadowless" → "Holo · Shadowless", "reverse-stamp-gamestop" → "리버스 홀로 · GameStop 스탬프",
 * "normal-jumbo" → "기본 · 점보 카드".
 */
export function variantLabel(key: string, lang: UiLang): string {
  const labels = VARIANT_LABELS[lang];
  if (labels[key]) return labels[key];
  const base = Object.keys(labels)
    .filter((k) => key.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return base ? `${labels[base]} · ${detailLabel(key.slice(base.length + 1), lang)}` : detailLabel(key, lang);
}

/** Where `market` sits between `low` and `high`, 0..1 (centered when the range is empty). */
export function rangePosition(low: number, high: number, market: number): number {
  if (!(high > low)) return 0.5;
  return Math.min(1, Math.max(0, (market - low) / (high - low)));
}

/** A 시세 marker this close to an end of the bar (share of the bar) sits "at" that end. */
const RANGE_END = 0.02;

/**
 * Where to draw the 시세 marker on the low–high bar (0..1), or null when a bar would say nothing: no spread
 * (low = high), or 시세 at one end (it equals the low or the high). Then only the two numbers are shown.
 */
export function rangeMarker(low: number, high: number, market: number): number | null {
  if (![low, high, market].every(Number.isFinite) || !(high > low)) return null;
  const pos = rangePosition(low, high, market);
  return pos <= RANGE_END || pos >= 1 - RANGE_END ? null : pos;
}

export type Trend = 'up' | 'down';

/**
 * Direction of a recent price move for the small "요즘 올랐어요" pill. The data layer only reports moves worth
 * a badge (see PriceSummary.changePct); tiny leftovers still read as no move at all, never as "steady".
 */
export function trendOf(changePct: number | null | undefined): Trend | null {
  if (changePct === null || changePct === undefined || !Number.isFinite(changePct)) return null;
  if (changePct > TREND_THRESHOLD) return 'up';
  if (changePct < -TREND_THRESHOLD) return 'down';
  return null;
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

const EBAY_COUNTS: Record<UiLang, Record<'auctions1' | 'auctions' | 'auctionsAbout' | 'bids0' | 'bids1' | 'bids', string>> = {
  ko: {
    auctions1: '경매 중 1개',
    auctions: '경매 중 {n}개',
    auctionsAbout: '경매 중 약 {n}개',
    bids0: '아직 입찰 없음',
    bids1: '입찰 1번',
    bids: '입찰 {n}번',
  },
  en: {
    auctions1: '1 auction',
    auctions: '{n} auctions',
    auctionsAbout: 'About {n} auctions',
    bids0: 'No bids yet',
    bids1: '1 bid',
    bids: '{n} bids',
  },
};

/**
 * Heading over the live auction list. `count` is eBay's total, which includes listings the worker drops
 * (lots, graded slabs); `kept` is how many came back. More on eBay than kept → "about".
 */
export function auctionHeading(count: number, kept: number, lang: UiLang): string {
  const s = EBAY_COUNTS[lang];
  const n = Math.max(count, kept);
  if (n === 1) return s.auctions1;
  return (n > kept ? s.auctionsAbout : s.auctions).replace('{n}', String(n));
}

/** "입찰 3번" / "3 bids", "1 bid", "No bids yet". */
export function bidsText(bidCount: number, lang: UiLang): string {
  const s = EBAY_COUNTS[lang];
  if (bidCount <= 0) return s.bids0;
  return bidCount === 1 ? s.bids1 : s.bids.replace('{n}', String(bidCount));
}

const SHIPPING: Record<UiLang, { incl: string; free: string; extra: string }> = {
  ko: { incl: '배송비 {amount} 포함', free: '무료 배송', extra: '배송비 별도' },
  en: { incl: 'incl. {amount} shipping', free: 'Free shipping', extra: '+ shipping' },
};

/**
 * Note under the lowest Buy It Now total (EbaySummary.buyNow.lowestShipping): its shipping part, free
 * shipping, or "+ shipping" when unknown (null, or an older worker that leaves it out).
 */
export function shippingNote(shipping: number | null | undefined, lang: UiLang, money: (usd: number) => string): string {
  const s = SHIPPING[lang];
  if (shipping === 0) return s.free;
  if (typeof shipping === 'number' && Number.isFinite(shipping) && shipping > 0) return s.incl.replace('{amount}', money(shipping));
  return s.extra;
}

/**
 * What an auction costs so far, like the Buy It Now totals next to it: the bid plus shipping when eBay says
 * what shipping costs (pair it with shippingNote, which then reads "배송비 … 포함" / "무료 배송"); the bid alone,
 * with "배송비 별도", when it doesn't.
 */
export function withShipping(price: number, shipping: number | null | undefined): number {
  return typeof shipping === 'number' && Number.isFinite(shipping) && shipping > 0 ? price + shipping : price;
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

/** The card's name in `lang`: species translation (affixes kept), else a name-based guess; undefined for trainers. */
const nameIn = (card: NameCard, lang: UiLang) =>
  translateCardName(card.name, speciesIds(card), lang) ?? nameInUiLang(card.name, lang);

/**
 * Title and subtitle for the Card screen. EN cards keep their printed English name as the title, with the
 * UI-language name under it. JA/KO cards lead with the name in the UI language ("루차불" for a Korean kid,
 * "Hawlucha" in English) and show the name as printed on the card underneath ("ルチャブル"; Korean cards: "루차불").
 * Trainers without a known translation keep their printed name as the title.
 */
export function cardNames(card: NameCard, routeLang: CardLang, uiLang: UiLang): { title: string; subtitle?: string } {
  if (routeLang === 'en') {
    const local = uiLang === 'en' ? undefined : nameIn(card, uiLang);
    return { title: card.name, subtitle: local && local !== card.name ? local : undefined };
  }
  // Korean cards carry Japanese data: the printed name is the Korean one, when we know it.
  const printed = (routeLang === 'ko' && nameIn(card, 'ko')) || card.name;
  const title = (uiLang === 'ko' && routeLang === 'ko' ? printed : nameIn(card, uiLang)) || printed;
  return { title, subtitle: printed !== title ? printed : undefined };
}

/** Number as printed on the card ("084/187", "TG05/TG30", "SWSH284"); older cached cards rebuild it. */
export function printedNumberOf(card: Pick<CardDetail, 'printedNumber' | 'localId' | 'setOfficialCount'>): string {
  return card.printedNumber ?? (card.setOfficialCount ? `${card.localId}/${card.setOfficialCount}` : card.localId);
}

/** TCGdex rarity names (EN, JA and KO data all use English) → the names Korean cards print. */
const RARITY_KO: Record<string, string> = {
  common: '커먼',
  uncommon: '언커먼',
  rare: '레어',
  'rare holo': '레어 홀로',
  'holo rare': '레어 홀로',
  'holo rare v': '레어 홀로 V',
  'holo rare vmax': '레어 홀로 VMAX',
  'holo rare vstar': '레어 홀로 VSTAR',
  'rare holo lv.x': '레어 홀로 LV.X',
  'rare prime': '레어 프라임',
  'double rare': '더블 레어 (RR)',
  'triple rare': '트리플 레어 (RRR)',
  'ultra rare': '울트라 레어',
  'illustration rare': '일러스트 레어 (AR)',
  'special illustration rare': '스페셜 일러스트 레어 (SAR)',
  'hyper rare': '하이퍼 레어',
  'mega hyper rare': '메가 하이퍼 레어',
  'secret rare': '시크릿 레어',
  'ace spec rare': 'ACE SPEC',
  'shiny rare': '샤이니 레어 (S)',
  'shiny rare v': '샤이니 레어 V',
  'shiny rare vmax': '샤이니 레어 VMAX',
  'shiny ultra rare': '샤이니 울트라 레어 (SSR)',
  'radiant rare': '빛나는 레어 (K)',
  'amazing rare': '어메이징 레어',
  'black white rare': '블랙 화이트 레어',
  'character rare': '캐릭터 레어 (CHR)',
  'character super rare': '캐릭터 슈퍼 레어 (CSR)',
  'classic collection': '클래식 컬렉션',
  'full art trainer': '풀아트 트레이너',
  crown: '크라운',
  legend: '레전드',
  promo: '프로모',
};

/** Rarity chip text: Korean names in the Korean UI ("Double rare" → "더블 레어 (RR)"); unknown ones stay English. */
export function rarityLabel(rarity: string, lang: UiLang): string {
  if (lang !== 'ko') return rarity;
  return RARITY_KO[rarity.trim().toLowerCase()] ?? rarity;
}
