import { describe, expect, it } from 'vitest';
import { nameInUiLang } from './localName';

describe('nameInUiLang', () => {
  it('translates Japanese Pokémon card names', () => {
    expect(nameInUiLang('ルチャブル', 'ko')).toBe('루차불');
    expect(nameInUiLang('ルチャブル', 'en')).toBe('Hawlucha');
    expect(nameInUiLang('メガルチャブルex', 'en')).toBe('Mega Hawlucha ex');
    expect(nameInUiLang('ミュウツーex', 'ko')).toBe('뮤츠 ex');
  });

  it('leaves trainers and one-letter names alone', () => {
    expect(nameInUiLang('ナンジャモ', 'ko')).toBeUndefined();
    expect(nameInUiLang('N', 'ko')).toBeUndefined();
  });

  it('returns undefined when the name is already in that language', () => {
    expect(nameInUiLang('Pikachu ex', 'en')).toBeUndefined();
  });
});
