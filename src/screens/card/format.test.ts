import { describe, expect, it } from 'vitest';
import {
  auctionHeading,
  bidsText,
  cardNames,
  printedNumberOf,
  rangeMarker,
  rangePosition,
  rarityLabel,
  shippingNote,
  speciesIds,
  timeLeft,
  trendOf,
  variantLabel,
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
    expect(variantLabel('reverse-energy', 'en')).toBe('Reverse Holo · Energy');
  });

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
