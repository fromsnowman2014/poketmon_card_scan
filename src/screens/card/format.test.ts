import { describe, expect, it } from 'vitest';
import type { PriceSummary, TcgplayerPrice } from '../../lib/types';
import {
  auctionHeading,
  bidsText,
  cardNames,
  cardPath,
  foilOf,
  labelContext,
  plainMirrorIsPokeBall,
  printedNumberOf,
  rangeMarker,
  rangePosition,
  rangeView,
  rarityLabel,
  shippingNote,
  speciesIds,
  timeLeft,
  trendOf,
  variantLabel,
  variantShortLabel,
  withShipping,
} from './format';

describe('variantLabel', () => {
  it('uses kid labels for known keys', () => {
    expect(variantLabel('normal', 'ko')).toBe('기본');
    expect(variantLabel('reverse-masterball', 'ko')).toBe('마스터볼 미러');
    expect(variantLabel('reverse-pokeball', 'en')).toBe('Poké Ball mirror');
    expect(variantLabel('firstEdition', 'en')).toBe('1st Edition');
  });

  it('keeps the longest known prefix and humanizes the rest', () => {
    expect(variantLabel('holo-shadowless', 'ko')).toBe('홀로 · Shadowless');
    expect(variantLabel('holo-1999-2000-copyright', 'en')).toBe('Holo · 1999–2000 Copyright');
    expect(variantLabel('reverse-masterball-2', 'en')).toBe('Master Ball mirror · 2');
    expect(variantLabel('reverse-cosmos', 'en')).toBe('Reverse Holo · Cosmos');
  });

  it('names the mirror patterns of Japanese sets', () => {
    expect(variantLabel('reverse-energy', 'en')).toBe('Energy mirror');
    expect(variantLabel('reverse-energy', 'ko')).toBe('에너지 미러');
    expect(variantLabel('reverse-loveball', 'ko')).toBe('러브러브볼 미러');
    expect(variantLabel('reverse-quickball', 'en')).toBe('Quick Ball mirror');
    expect(variantLabel('reverse-duskball', 'ko')).toBe('다크볼 미러');
    expect(variantLabel('reverse-friendball', 'en')).toBe('Friend Ball mirror');
    expect(variantLabel('reverse-team-rocket', 'ko')).toBe('로켓단 미러');
    expect(variantLabel('reverse-team-rocket', 'en')).toBe('Team Rocket mirror');
    // A ball we have no name for is still spelled out.
    expect(variantLabel('reverse-heavyball', 'en')).toBe('Heavy Ball mirror');
    expect(variantLabel('reverse-energy-stamp-staff', 'en')).toBe('Energy mirror · Staff stamp');
  });

  it('calls a plain reverse "Reverse Holo" on English cards and when the card language is unknown', () => {
    expect(variantLabel('reverse', 'en')).toBe('Reverse Holo');
    expect(variantLabel('reverse', 'ko')).toBe('리버스 홀로');
    expect(variantLabel('reverse', 'en', { cardLang: 'en', siblings: ['normal', 'reverse', 'reverse-masterball'] })).toBe('Reverse Holo');
    expect(variantLabel('reverse', 'ko', { cardLang: 'en' })).toBe('리버스 홀로');
  });

  it('calls it a mirror on Japanese and Korean cards', () => {
    expect(variantLabel('reverse', 'en', { cardLang: 'ja' })).toBe('Mirror'); // an old saved item: no siblings known
    expect(variantLabel('reverse', 'ko', { cardLang: 'ja' })).toBe('미러');
    expect(variantLabel('reverse', 'ko', { cardLang: 'ko', siblings: ['normal', 'reverse'] })).toBe('미러');
    expect(variantLabel('reverse-stamp-gamestop', 'en', { cardLang: 'ja' })).toBe('Mirror · GameStop stamp');
  });

  it('calls the plain mirror the Poké Ball one when the card also has a special pattern and no Poké Ball printing', () => {
    const sv8a = { cardLang: 'ja', siblings: ['normal', 'reverse', 'reverse-masterball'] } as const;
    expect(variantLabel('reverse', 'en', sv8a)).toBe('Poké Ball mirror');
    expect(variantLabel('reverse', 'ko', sv8a)).toBe('몬스터볼 미러');
    expect(variantLabel('reverse', 'ko', { cardLang: 'ko', siblings: sv8a.siblings })).toBe('몬스터볼 미러');
    // M2a: an energy pattern next to the plain mirror.
    expect(variantLabel('reverse', 'en', { cardLang: 'ja', siblings: ['normal', 'reverse-energy', 'reverse'] })).toBe('Poké Ball mirror');
    // SV2a names its Poké Ball printing: nothing is left to rename.
    const sv2a = { cardLang: 'ja', siblings: ['holo', 'reverse-pokeball', 'reverse-masterball', 'reverse'] } as const;
    expect(variantLabel('reverse', 'en', sv2a)).toBe('Mirror');
    expect(variantLabel('reverse-pokeball', 'en', sv2a)).toBe('Poké Ball mirror');
    expect(variantLabel('normal', 'en', sv8a)).toBe('Normal');
    expect(variantLabel('reverse-masterball', 'ko', sv8a)).toBe('마스터볼 미러');
  });
});

describe('variantShortLabel', () => {
  const sv8a = { cardLang: 'ja', siblings: ['normal', 'reverse', 'reverse-masterball'] } as const;

  it('drops the word "mirror" from pattern printings: the name on a picker tile', () => {
    expect(variantShortLabel('reverse-masterball', 'en')).toBe('Master Ball');
    expect(variantShortLabel('reverse-masterball', 'ko')).toBe('마스터볼');
    expect(variantShortLabel('reverse-pokeball', 'ko')).toBe('몬스터볼');
    expect(variantShortLabel('reverse', 'en', sv8a)).toBe('Poké Ball');
    expect(variantShortLabel('reverse', 'ko', sv8a)).toBe('몬스터볼');
    expect(variantShortLabel('reverse-energy', 'ko')).toBe('에너지');
    expect(variantShortLabel('reverse-team-rocket', 'en')).toBe('Team Rocket');
  });

  it('names a plain mirror by the pattern its TCGplayer product has (M2a: TCGdex only says "reverse")', () => {
    const m2a = labelContext('ja', [{ key: 'normal' }, { key: 'reverse-energy' }, { key: 'reverse', pattern: 'team-rocket' }]);
    expect(m2a.patterns).toEqual({ reverse: 'team-rocket' });
    expect(variantShortLabel('reverse', 'en', m2a)).toBe('Team Rocket');
    expect(variantLabel('reverse', 'ko', m2a)).toBe('로켓단 미러');
    const friend = labelContext('ko', [{ key: 'normal' }, { key: 'reverse', pattern: 'friendball' }]);
    expect(variantLabel('reverse', 'en', friend)).toBe('Friend Ball mirror');
    // Without one, as before: the plain mirror next to a special pattern is the Poké Ball one.
    expect(variantLabel('reverse', 'en', labelContext('ja', [{ key: 'normal' }, { key: 'reverse-energy' }, { key: 'reverse' }]))).toBe('Poké Ball mirror');
    expect(labelContext('en', [{ key: 'normal' }]).patterns).toBeUndefined();
  });

  it('is the full name for everything else', () => {
    expect(variantShortLabel('normal', 'ko')).toBe('기본');
    expect(variantShortLabel('reverse', 'en')).toBe('Reverse Holo');
    expect(variantShortLabel('reverse', 'ko', { cardLang: 'ja' })).toBe('미러');
    expect(variantShortLabel('holo-shadowless', 'en')).toBe('Holo · Shadowless');
    expect(variantShortLabel('reverse-masterball-2', 'en')).toBe('Master Ball · 2');
    expect(variantShortLabel('firstEdition', 'en')).toBe('1st Edition');
  });
});

describe('foilOf / plainMirrorIsPokeBall', () => {
  it('reads the mirror pattern out of a key', () => {
    expect(foilOf('reverse-masterball')).toBe('masterball');
    expect(foilOf('reverse-team-rocket-2')).toBe('team-rocket');
    expect(foilOf('reverse-heavyball')).toBe('heavyball');
    expect(foilOf('reverse')).toBeUndefined();
    expect(foilOf('reverse-stamp-gamestop')).toBeUndefined();
    expect(foilOf('reverse-cosmos')).toBeUndefined();
    expect(foilOf('holo-masterball')).toBeUndefined();
  });

  it('needs a Japanese or Korean card, a special pattern and no Poké Ball printing', () => {
    expect(plainMirrorIsPokeBall({ cardLang: 'ja', siblings: ['normal', 'reverse', 'reverse-masterball'] })).toBe(true);
    expect(plainMirrorIsPokeBall({ cardLang: 'en', siblings: ['normal', 'reverse', 'reverse-masterball'] })).toBe(false);
    expect(plainMirrorIsPokeBall({ cardLang: 'ja', siblings: ['normal', 'reverse'] })).toBe(false);
    expect(plainMirrorIsPokeBall({ cardLang: 'ja', siblings: ['reverse', 'reverse-pokeball', 'reverse-masterball'] })).toBe(false);
    expect(plainMirrorIsPokeBall({ cardLang: 'ja' })).toBe(false);
    expect(plainMirrorIsPokeBall()).toBe(false);
  });
});

describe('cardPath', () => {
  it('links to a card, on one printing when given', () => {
    expect(cardPath({ lang: 'ja', id: 'SV8a-084' })).toBe('/card/ja/SV8a-084');
    expect(cardPath({ lang: 'ja', id: 'SV8a-084' }, 'reverse-masterball')).toBe('/card/ja/SV8a-084?v=reverse-masterball');
    expect(cardPath({ lang: 'en', id: 'sv03.5-199' }, undefined)).toBe('/card/en/sv03.5-199');
    expect(cardPath({ lang: 'en', id: 'a/b' }, 'holo stamp&x')).toBe('/card/en/a%2Fb?v=holo%20stamp%26x');
  });
});

describe('rangeView', () => {
  const tcg = (low: number | null, mid: number | null, high: number | null, market: number | null): TcgplayerPrice => ({
    low,
    mid,
    high,
    market,
    directLow: null,
  });
  const summary = (market: number | null, low: number | null, high: number | null, source: PriceSummary['source'] = 'tcgplayer'): PriceSummary => ({
    market,
    low,
    high,
    changePct: null,
    source,
    converted: source === 'cardmarket',
  });

  it('labels both ends only when they are TCGplayer’s own cheapest and dearest listing', () => {
    expect(rangeView(summary(2, 1.5, 4), tcg(1.5, 2.1, 4, 2))).toEqual({ kind: 'range', labels: 'ends', low: 1.5, high: 4, marker: 0.2 });
  });

  it('says "usual prices" when the summary replaced an end, or the numbers are Cardmarket averages', () => {
    // SV8a-084 Poké Ball mirror: the $1.84 top listing is over 3× the price, so the high is the middle listing.
    expect(rangeView(summary(0.6, 0.34, 0.63), tcg(0.34, 0.63, 1.84, 0.6))).toMatchObject({ kind: 'range', labels: 'usual' });
    // Normal: a lone 1-cent listing is not the low.
    expect(rangeView(summary(0.18, 0.17, 0.18), tcg(0.01, 0.17, 1, 0.18))).toEqual({ kind: 'range', labels: 'usual', low: 0.17, high: 0.18, marker: null });
    expect(rangeView(summary(1.69, 1.5, 2.04, 'cardmarket'), null)).toMatchObject({ kind: 'range', labels: 'usual' });
    // A Cardmarket summary never borrows TCGplayer's words, whatever block sits next to it.
    expect(rangeView(summary(1.69, 1.5, 2.04, 'cardmarket'), tcg(1.5, null, 2.04, null))).toMatchObject({ labels: 'usual' });
  });

  it('shows one cheapest listing when there is no spread, and nothing when even that is not a real listing', () => {
    expect(rangeView(summary(2, 2, 2), tcg(2, 2, 2, 2))).toEqual({ kind: 'single', low: 2 });
    expect(rangeView(summary(2, 2, 2), tcg(0.01, 2, 900, 2))).toEqual({ kind: 'none' });
    expect(rangeView(summary(2, 2, 2, 'cardmarket'), null)).toEqual({ kind: 'none' });
    expect(rangeView(summary(2, null, 3), tcg(null, 2, 3, 2))).toEqual({ kind: 'none' });
    expect(rangeView(summary(null, null, null), null)).toEqual({ kind: 'none' });
  });
});

describe('variantLabel (other printings)', () => {

  it('humanizes unknown keys', () => {
    expect(variantLabel('cracked-ice', 'en')).toBe('Cracked Ice');
  });

  it('names stamped and jumbo printings (pricing.ts keys)', () => {
    expect(variantLabel('reverse-stamp-gamestop', 'ko')).toBe('리버스 홀로 · GameStop 스탬프');
    expect(variantLabel('reverse-stamp-eb-games', 'en')).toBe('Reverse Holo · EB Games stamp');
    expect(variantLabel('holo-stamp-set-logo', 'ko')).toBe('홀로 · 세트 로고 스탬프');
    expect(variantLabel('normal-stamp-poketour-99', 'en')).toBe('Normal · PokéTour 99 stamp');
    expect(variantLabel('normal-stamp-something-new', 'en')).toBe('Normal · Something New stamp');
    expect(variantLabel('reverse-stamp-gamestop-2', 'en')).toBe('Reverse Holo · GameStop stamp · 2');
    expect(variantLabel('normal-jumbo', 'ko')).toBe('기본 · 점보 카드');
    expect(variantLabel('holo-shadowless-jumbo-stamp-staff', 'en')).toBe('Holo · Shadowless · Jumbo · Staff stamp');
    expect(variantLabel('firstEdition-shadowless', 'en')).toBe('1st Edition · Shadowless');
  });
});

describe('rangePosition', () => {
  it('places market between low and high, clamped', () => {
    expect(rangePosition(1, 3, 2)).toBe(0.5);
    expect(rangePosition(1.69, 5.8, 1.69)).toBe(0);
    expect(rangePosition(1, 2, 5)).toBe(1);
    expect(rangePosition(1, 2, 0.5)).toBe(0);
  });

  it('centers the dot when the range is empty', () => {
    expect(rangePosition(2, 2, 2)).toBe(0.5);
  });
});

describe('rangeMarker', () => {
  it('places the 시세 marker inside the bar', () => {
    expect(rangeMarker(1, 3, 2)).toBe(0.5);
    expect(rangeMarker(2459.5, 3741.1, 3170)).toBeCloseTo(0.555, 2);
  });

  it('draws no bar when 시세 equals an end or there is no spread', () => {
    expect(rangeMarker(1.69, 5.8, 1.69)).toBeNull(); // 시세 = low (the injected card that pinned the dot left)
    expect(rangeMarker(1, 5, 5)).toBeNull(); // 시세 = high
    expect(rangeMarker(1, 101, 1.5)).toBeNull(); // 0.5% from the end reads as "at the end"
    expect(rangeMarker(2, 2, 2)).toBeNull(); // low = 시세 = high
    expect(rangeMarker(3, 2, 2.5)).toBeNull();
    expect(rangeMarker(1, Number.NaN, 2)).toBeNull();
  });

  it('keeps the bar when 시세 is near, but not at, an end', () => {
    expect(rangeMarker(1, 101, 5)).toBeCloseTo(0.04, 5);
    expect(rangeMarker(1, 101, 97)).toBeCloseTo(0.96, 5);
  });
});

describe('trendOf', () => {
  it('needs more than ±5% to move and never says "steady"', () => {
    expect(trendOf(12)).toBe('up');
    expect(trendOf(-44.4)).toBe('down');
    expect(trendOf(5)).toBeNull();
    expect(trendOf(-4.1)).toBeNull();
    expect(trendOf(0)).toBeNull();
    expect(trendOf(null)).toBeNull();
    expect(trendOf(undefined)).toBeNull();
    expect(trendOf(Number.NaN)).toBeNull();
  });
});

describe('timeLeft', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  it('counts down in minutes, hours, then days', () => {
    expect(timeLeft('2026-11-08T12:30:00Z', 'ko', now)).toBe('30분 남음');
    expect(timeLeft('2026-11-08T15:10:00Z', 'ko', now)).toBe('3시간 남음');
    expect(timeLeft('2026-11-09T20:00:00Z', 'en', now)).toBe('32h left');
    expect(timeLeft('2026-11-12T12:00:00Z', 'en', now)).toBe('4d left');
    expect(timeLeft('2026-11-08T11:00:00Z', 'en', now)).toBe('Ending now');
    expect(timeLeft('soon', 'en', now)).toBe('');
  });
});

describe('cardNames', () => {
  const hawlucha = { name: 'ルチャブル', dexIds: [701], hp: 90 };

  it('leads with the UI-language name for Japanese cards, printed name underneath', () => {
    expect(cardNames(hawlucha, 'ja', 'ko')).toEqual({ title: '루차불', subtitle: 'ルチャブル' });
    expect(cardNames(hawlucha, 'ja', 'en')).toEqual({ title: 'Hawlucha', subtitle: 'ルチャブル' });
  });

  it('shows Korean cards under their Korean name (the printed one)', () => {
    expect(cardNames(hawlucha, 'ko', 'ko')).toEqual({ title: '루차불' });
    expect(cardNames(hawlucha, 'ko', 'en')).toEqual({ title: 'Hawlucha', subtitle: '루차불' });
  });

  it('keeps affixes when translating', () => {
    expect(cardNames({ name: 'ブラッキーex', dexIds: [197], hp: 280 }, 'ja', 'ko')).toEqual({
      title: '블래키 ex',
      subtitle: 'ブラッキーex',
    });
  });

  it('keeps the printed English name as the title of English cards', () => {
    const lopunny = { name: 'Lopunny', dexIds: [428], hp: 80 };
    expect(cardNames(lopunny, 'en', 'en')).toEqual({ title: 'Lopunny' });
    expect(cardNames(lopunny, 'en', 'ko')).toEqual({ title: 'Lopunny', subtitle: '이어롭' });
  });

  it('matches Pokémon cards without dexIds by name, and keeps trainer names as printed', () => {
    expect(cardNames({ name: 'ブラッキーex', dexIds: [], hp: 280 }, 'ja', 'en')).toEqual({
      title: 'Umbreon ex',
      subtitle: 'ブラッキーex',
    });
    expect(cardNames({ name: 'ナンジャモ', dexIds: [] }, 'ja', 'ko')).toEqual({ title: 'ナンジャモ' });
    expect(cardNames({ name: 'ナンジャモ', dexIds: [] }, 'ko', 'en')).toEqual({ title: 'ナンジャモ' });
  });
});

describe('printedNumberOf', () => {
  it('uses the number as printed, else rebuilds it for older cached cards', () => {
    expect(printedNumberOf({ printedNumber: 'TG05/TG30', localId: 'TG05', setOfficialCount: 30 })).toBe('TG05/TG30');
    expect(printedNumberOf({ printedNumber: '085', localId: '085' })).toBe('085');
    expect(printedNumberOf({ localId: '084', setOfficialCount: 187 })).toBe('084/187');
    expect(printedNumberOf({ localId: '085' })).toBe('085');
  });
});

describe('rarityLabel', () => {
  it('uses Korean rarity names in the Korean UI, case-insensitively', () => {
    expect(rarityLabel('Common', 'ko')).toBe('커먼');
    expect(rarityLabel('Double rare', 'ko')).toBe('더블 레어 (RR)');
    expect(rarityLabel('Special illustration rare', 'ko')).toBe('스페셜 일러스트 레어 (SAR)');
    expect(rarityLabel('Illustration rare', 'ko')).toBe('일러스트 레어 (AR)');
    expect(rarityLabel('ACE SPEC Rare', 'ko')).toBe('ACE SPEC');
    expect(rarityLabel('ultra rare', 'ko')).toBe('울트라 레어');
    expect(rarityLabel('Promo', 'ko')).toBe('프로모');
  });

  it('keeps unknown rarities and the English UI as they are', () => {
    expect(rarityLabel('Pikachu Rare', 'ko')).toBe('Pikachu Rare');
    expect(rarityLabel('Double rare', 'en')).toBe('Double rare');
  });
});

describe('eBay counts', () => {
  it('words the auction heading with singular English and "about" when eBay counts more than came back', () => {
    expect(auctionHeading(1, 1, 'en')).toBe('1 auction');
    expect(auctionHeading(3, 3, 'en')).toBe('3 auctions');
    expect(auctionHeading(12, 2, 'en')).toBe('About 12 auctions');
    expect(auctionHeading(12, 2, 'ko')).toBe('경매 중 약 12개');
    expect(auctionHeading(1, 1, 'ko')).toBe('경매 중 1개');
    expect(auctionHeading(0, 2, 'ko')).toBe('경매 중 2개');
  });

  it('counts bids with a singular and a no-bids line', () => {
    expect(bidsText(0, 'en')).toBe('No bids yet');
    expect(bidsText(1, 'en')).toBe('1 bid');
    expect(bidsText(7, 'en')).toBe('7 bids');
    expect(bidsText(1, 'ko')).toBe('입찰 1번');
    expect(bidsText(0, 'ko')).toBe('아직 입찰 없음');
  });

  it('notes the shipping inside the lowest Buy It Now total', () => {
    const usd = (n: number) => `$${n.toFixed(2)}`;
    expect(shippingNote(4.5, 'ko', usd)).toBe('배송비 $4.50 포함');
    expect(shippingNote(4.5, 'en', usd)).toBe('incl. $4.50 shipping');
    expect(shippingNote(0, 'ko', usd)).toBe('무료 배송');
    expect(shippingNote(null, 'ko', usd)).toBe('배송비 별도');
    expect(shippingNote(undefined, 'en', usd)).toBe('+ shipping');
  });

  it('uses Korean won from the formatter it is given', () => {
    expect(shippingNote(1.25, 'ko', () => '1,700원')).toBe('배송비 1,700원 포함');
  });

  it('adds known shipping to an auction bid, like the Buy It Now totals', () => {
    expect(withShipping(3.5, 1.25)).toBe(4.75);
    expect(withShipping(3.5, 0)).toBe(3.5); // free shipping
    expect(withShipping(3.5, null)).toBe(3.5); // unknown: the note says "배송비 별도"
    expect(withShipping(3.5, undefined)).toBe(3.5);
    expect(withShipping(3.5, Number.NaN)).toBe(3.5);
    expect(withShipping(3.5, -2)).toBe(3.5);
  });
});

describe('speciesIds', () => {
  it('keeps dexIds from the data', () => {
    expect(speciesIds({ name: 'ルチャブル', dexIds: [701], hp: 90 })).toEqual([701]);
  });

  it('finds the species of a Pokémon card without dexIds, never for trainers', () => {
    expect(speciesIds({ name: 'ブラッキーex', dexIds: [], hp: 280 })).toEqual([197]);
    expect(speciesIds({ name: 'ナンジャモ', dexIds: [] })).toEqual([]);
  });
});
