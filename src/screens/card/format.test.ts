import { describe, expect, it } from 'vitest';
import { cardNames, rangePosition, speciesIds, timeLeft, trendOf, variantLabel } from './format';

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

describe('trendOf', () => {
  it('needs more than ±5% to move', () => {
    expect(trendOf(12)).toBe('up');
    expect(trendOf(-44.4)).toBe('down');
    expect(trendOf(5)).toBe('steady');
    expect(trendOf(-4.1)).toBe('steady');
    expect(trendOf(null)).toBeNull();
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

  it('adds the UI-language name (and English for Korean users) under a Japanese name', () => {
    expect(cardNames(hawlucha, 'ja', 'ko')).toEqual({ title: 'ルチャブル', subtitle: '루차불 · Hawlucha' });
    expect(cardNames(hawlucha, 'ja', 'en')).toEqual({ title: 'ルチャブル', subtitle: 'Hawlucha' });
  });

  it('shows Korean cards under their Korean name', () => {
    expect(cardNames(hawlucha, 'ko', 'ko')).toEqual({ title: '루차불', subtitle: 'Hawlucha' });
  });

  it('skips names equal to the title', () => {
    const lopunny = { name: 'Lopunny', dexIds: [428], hp: 80 };
    expect(cardNames(lopunny, 'en', 'en')).toEqual({ title: 'Lopunny' });
    expect(cardNames(lopunny, 'en', 'ko')).toEqual({ title: 'Lopunny', subtitle: '이어롭' });
  });

  it('matches Pokémon cards without dexIds by name, but not trainers', () => {
    expect(cardNames({ name: 'ブラッキーex', dexIds: [], hp: 280 }, 'ja', 'en').subtitle).toBe('Umbreon ex');
    expect(cardNames({ name: 'ナンジャモ', dexIds: [] }, 'ja', 'en').subtitle).toBeUndefined();
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
