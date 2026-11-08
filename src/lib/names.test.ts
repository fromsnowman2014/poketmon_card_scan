import { describe, expect, it } from 'vitest';
import { findSpecies, localizedName, speciesByDex, translateCardName } from './names';

const firstDex = (q: string) => findSpecies(q)[0]?.dexId;

describe('findSpecies', () => {
  it.each([
    ['피카츄', 25],
    ['ピカチュウ', 25],
    ['ぴかちゅう', 25], // hiragana → katakana
    ['pika', 25], // prefix
    ['PIKACHU', 25],
    ['루차불', 701],
    ['ルチャブル', 701],
    ['hawlucha', 701],
    ['메가팬텀', 94], // prefix stripped
    ['メガゲンガーex', 94],
    ['Charizard VMAX', 6],
    ['리자몽 ex', 6],
    ['Calyrex', 898], // species ending in "ex" is not stripped
    ['mr. mime', 122],
    ['ポリゴンZ', 474], // full-width Ｚ in the data
  ])('%s → #%i', (q, dex) => expect(firstDex(q)).toBe(dex));

  it('ranks exact > prefix > contains and respects the limit', () => {
    expect(findSpecies('mew').map((s) => s.en)).toEqual(['Mew', 'Mewtwo']);
    expect(findSpecies('rai', 2).map((s) => s.en)).toEqual(['Raichu', 'Raikou']);
    expect(findSpecies('chu', 3).map((s) => s.en)).toEqual(['Pichu', 'Raichu', 'Pikachu']);
  });

  it('returns nothing for empty or punctuation-only queries', () => {
    expect(findSpecies('')).toEqual([]);
    expect(findSpecies(' !? ')).toEqual([]);
  });
});

describe('speciesByDex / localizedName', () => {
  it('looks up names by dex id', () => {
    expect(speciesByDex(701)).toEqual({ dexId: 701, en: 'Hawlucha', ko: '루차불', ja: 'ルチャブル' });
    expect(localizedName([701], 'ko')).toBe('루차불');
    expect(localizedName([701, 25], 'en')).toBe('Hawlucha');
    expect(localizedName([], 'en')).toBeUndefined();
    expect(localizedName(undefined, 'ja')).toBeUndefined();
  });
});

describe('translateCardName', () => {
  it.each([
    ['ブラッキーex', [197], 'en', 'Umbreon ex'],
    ['ブラッキーex', [197], 'ko', '블래키 ex'],
    ['メガゲンガーex', [94], 'en', 'Mega Gengar ex'],
    ['メガゲンガーex', [94], 'ko', '메가 팬텀 ex'],
    ['ルチャブル', [701], 'en', 'Hawlucha'],
    ['Charizard ex', [6], 'ja', 'リザードンex'],
    ['Charizard VMAX', [6], 'ko', '리자몽 VMAX'],
    ['メガリザードンXex', [6], 'en', 'Mega Charizard X ex'],
    ['Pikachu & Zekrom GX', [25, 644], 'ja', 'ピカチュウ&ゼクロムGX'],
    ['Alolan Vulpix', [37], 'ja', 'アローラロコン'],
    ["Team Rocket's Mewtwo ex", [150], 'ja', 'ロケット団のミュウツーex'],
    ['Pikachu with Grey Felt Hat', [25], 'ja', 'ピカチュウ'],
    ['ポリゴンZ', [474], 'en', 'Porygon-Z'],
  ] as const)('%s %j → %s %s', (name, dex, lang, want) => expect(translateCardName(name, [...dex], lang)).toBe(want));

  it('returns undefined for trainers or when the species is not in the name', () => {
    expect(translateCardName('ナンジャモ', undefined, 'en')).toBeUndefined();
    expect(translateCardName("Professor's Research", [], 'ja')).toBeUndefined();
    expect(translateCardName('ルチャブル', [25], 'en')).toBeUndefined();
  });
});
