import { describe, expect, it } from 'vitest';
import { isTcgdexJa, nextAfterError, startState } from './cardImageChain';

const JA = 'https://assets.tcgdex.net/ja/SV/SV8a/084/high.webp';
const JA2 = 'https://assets.tcgdex.net/ja/SV/SV8a/001/low.webp';
const EN = 'https://assets.tcgdex.net/en/sv/sv03.5/199/high.webp';
const TCGPLAYER = 'https://tcgplayer-cdn.tcgplayer.com/product/1_in_1000x1000.jpg';
const PHOTO = 'data:image/jpeg;base64,AAAA';

describe('CardImage fallback chain', () => {
  it('starts at the first source as a CORS request', () => {
    expect(startState('a\nb')).toEqual({ chain: 'a\nb', index: 0, cors: true, loaded: false });
    expect(startState(`${EN}\n${TCGPLAYER}`, EN)).toEqual({ chain: `${EN}\n${TCGPLAYER}`, index: 0, cors: true, loaded: false });
  });

  it('retries a failed TCGdex image once without CORS before moving on', () => {
    const first = nextAfterError({ ...startState(`${EN}\n${TCGPLAYER}`, EN), loaded: true }, true);
    expect(first).toMatchObject({ index: 0, cors: false, loaded: false });
    const second = nextAfterError(first, true);
    expect(second).toMatchObject({ index: 1, cors: true, loaded: false });
  });

  it('moves straight to the next source for non-TCGdex images', () => {
    const s = startState('f\np');
    expect(nextAfterError({ ...s, index: 0 }, false)).toMatchObject({ index: 1, cors: true });
    expect(nextAfterError({ ...startState('t\nf\np'), index: 1 }, false)).toMatchObject({ index: 2 });
  });

  it('ends past the last source (card back)', () => {
    let s = startState('t');
    s = nextAfterError(s, true);
    s = nextAfterError(s, true);
    expect(s.index).toBe(1);
  });
});

describe('Japanese TCGdex images (CORS header sent twice)', () => {
  it('recognizes Japanese TCGdex asset URLs only', () => {
    expect(isTcgdexJa(JA)).toBe(true);
    expect(isTcgdexJa('HTTPS://ASSETS.TCGDEX.NET/ja/SV/SV8a/084/low.webp')).toBe(true);
    expect(isTcgdexJa(EN)).toBe(false);
    expect(isTcgdexJa(TCGPLAYER)).toBe(false);
    expect(isTcgdexJa('https://assets.tcgdex.net/jap/x')).toBe(false);
    expect(isTcgdexJa(undefined)).toBe(false);
  });

  it('start plain, from the very first one: no doomed CORS try, no console error', () => {
    expect(startState(`${JA}\n${TCGPLAYER}`, JA)).toEqual({ chain: `${JA}\n${TCGPLAYER}`, index: 0, cors: false, loaded: false });
    expect(startState(JA2, JA2)).toMatchObject({ cors: false, index: 0 });
    // English pictures keep CORS (cacheable normally), whatever loaded before.
    expect(startState(EN, EN)).toMatchObject({ cors: true });
  });

  it('a plain Japanese image that fails goes straight on to the fallback (no CORS retry)', () => {
    const failed = nextAfterError(startState(`${JA}\n${TCGPLAYER}\n${PHOTO}`, JA), true);
    expect(failed).toMatchObject({ index: 1, cors: true, loaded: false });
    expect(nextAfterError(failed, false)).toMatchObject({ index: 2 });
    expect(nextAfterError(nextAfterError(failed, false), false).index).toBe(3); // card back
  });

  it('only the first source decides: a chain without a TCGdex picture starts with CORS on', () => {
    // CardImage loads only the TCGdex source with crossOrigin; the flag is ignored for the others.
    expect(startState(`${TCGPLAYER}\n${PHOTO}`, undefined)).toMatchObject({ cors: true });
  });
});
