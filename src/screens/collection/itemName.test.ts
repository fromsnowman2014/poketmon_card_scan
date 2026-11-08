import { describe, expect, it } from 'vitest';
import { uiName } from './itemName';

describe('uiName', () => {
  it('translates a Japanese card name for the UI', () => {
    expect(uiName({ name: 'ルチャブル', dexIds: [701] }, 'ko')).toBe('루차불');
    expect(uiName({ name: 'ルチャブル', dexIds: [701] }, 'en')).toBe('Hawlucha');
  });

  it('finds the species from the name when dexIds are missing', () => {
    expect(uiName({ name: 'メガルチャブルex', dexIds: [] }, 'en')).toBe('Mega Hawlucha ex');
  });

  it('is undefined when nothing changes or there is no species', () => {
    expect(uiName({ name: 'Lopunny', dexIds: [428] }, 'en')).toBeUndefined();
    expect(uiName({ name: 'ナンジャモ', dexIds: [] }, 'ko')).toBeUndefined();
  });
});
