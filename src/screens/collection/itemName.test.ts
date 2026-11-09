import { describe, expect, it } from 'vitest';
import { cardNames } from '../card/format';
import { itemNames } from './itemName';

describe('itemNames', () => {
  const hawlucha = { name: 'ルチャブル', dexIds: [701], lang: 'ja' as const };

  it('leads with the UI-language name for Japanese cards, like the Card screen title', () => {
    expect(itemNames(hawlucha, 'ko')).toEqual({ title: '루차불', subtitle: 'ルチャブル' });
    expect(itemNames(hawlucha, 'en')).toEqual({ title: 'Hawlucha', subtitle: 'ルチャブル' });
    expect(itemNames(hawlucha, 'ko')).toEqual(cardNames({ ...hawlucha, hp: 90 }, 'ja', 'ko'));
  });

  it('keeps affixes and finds the species from the name when dexIds are missing', () => {
    expect(itemNames({ name: 'メガルチャブルex', lang: 'ja' }, 'en')).toEqual({
      title: 'Mega Hawlucha ex',
      subtitle: 'メガルチャブルex',
    });
    expect(itemNames({ name: 'ブラッキーex', dexIds: [], lang: 'ja' }, 'ko')).toEqual({
      title: '블래키 ex',
      subtitle: 'ブラッキーex',
    });
  });

  it('keeps English names first, with the Korean name under them in the Korean UI', () => {
    expect(itemNames({ name: 'Lopunny', dexIds: [428], lang: 'en' }, 'en')).toEqual({ title: 'Lopunny' });
    expect(itemNames({ name: 'Lopunny', dexIds: [428], lang: 'en' }, 'ko')).toEqual({
      title: 'Lopunny',
      subtitle: '이어롭',
    });
  });

  it('keeps trainer names as printed', () => {
    expect(itemNames({ name: 'ナンジャモ', dexIds: [], lang: 'ja' }, 'ko')).toEqual({ title: 'ナンジャモ' });
  });
});
