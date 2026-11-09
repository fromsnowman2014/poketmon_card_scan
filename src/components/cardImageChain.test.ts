import { afterEach, describe, expect, it } from 'vitest';
import { isTcgdexJa, JA_PLAIN_KEY, jaLoadsPlain, nextAfterError, noteLoaded, resetJaPlain, startState } from './cardImageChain';

const JA = 'https://assets.tcgdex.net/ja/SV/SV8a/084/high.webp';
const JA2 = 'https://assets.tcgdex.net/ja/SV/SV8a/001/low.webp';
const EN = 'https://assets.tcgdex.net/en/sv/sv03.5/199/high.webp';
const TCGPLAYER = 'https://tcgplayer-cdn.tcgplayer.com/product/1_in_1000x1000.jpg';

function memoryStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

const throwing = {
  getItem: (): string | null => {
    throw new Error('SecurityError');
  },
  setItem: (): void => {
    throw new Error('QuotaExceededError');
  },
};

afterEach(() => resetJaPlain());

describe('CardImage fallback chain', () => {
  it('starts at the first source as a CORS request', () => {
    expect(startState('a\nb', undefined, undefined)).toEqual({ chain: 'a\nb', index: 0, cors: true, loaded: false });
    expect(startState(`${JA}\nf`, JA, memoryStorage())).toMatchObject({ cors: true });
  });

  it('retries a failed TCGdex image once without CORS before moving on', () => {
    const first = nextAfterError({ ...startState('t\nf', undefined, undefined), loaded: true }, true);
    expect(first).toMatchObject({ index: 0, cors: false, loaded: false });
    const second = nextAfterError(first, true);
    expect(second).toMatchObject({ index: 1, cors: true, loaded: false });
  });

  it('moves straight to the next source for non-TCGdex images', () => {
    const s = startState('f\np', undefined, undefined);
    expect(nextAfterError({ ...s, index: 0 }, false)).toMatchObject({ index: 1, cors: true });
    expect(nextAfterError({ ...startState('t\nf\np', undefined, undefined), index: 1 }, false)).toMatchObject({ index: 2 });
  });

  it('ends past the last source (card back)', () => {
    let s = startState('t', undefined, undefined);
    s = nextAfterError(s, true);
    s = nextAfterError(s, true);
    expect(s.index).toBe(1);
  });
});

describe('Japanese TCGdex images (broken CORS header)', () => {
  it('recognizes Japanese TCGdex asset URLs only', () => {
    expect(isTcgdexJa(JA)).toBe(true);
    expect(isTcgdexJa(EN)).toBe(false);
    expect(isTcgdexJa(TCGPLAYER)).toBe(false);
    expect(isTcgdexJa('https://assets.tcgdex.net/jap/x')).toBe(false);
    expect(isTcgdexJa(undefined)).toBe(false);
  });

  it('after one needed the plain retry, later Japanese images start plain; others keep CORS', () => {
    const storage = memoryStorage();
    let s = startState(`${JA}\n${TCGPLAYER}`, JA, storage);
    s = nextAfterError(s, true); // CORS load failed → plain retry
    noteLoaded(s, JA, storage); // …which showed
    expect(storage.data.get(JA_PLAIN_KEY)).toBe('1');
    expect(startState(JA2, JA2, storage)).toMatchObject({ cors: false, index: 0 });
    expect(startState(EN, EN, storage)).toMatchObject({ cors: true });
    // A plain Japanese image that fails goes straight on to the fallback (no second plain try).
    expect(nextAfterError(startState(`${JA2}\n${TCGPLAYER}`, JA2, storage), true)).toMatchObject({ index: 1 });
  });

  it('remembers it for the session (a reload reads sessionStorage)', () => {
    const storage = memoryStorage();
    noteLoaded({ ...startState(JA, JA, storage), cors: false }, JA, storage);
    resetJaPlain();
    expect(jaLoadsPlain(storage)).toBe(true);
  });

  it('does not learn from a CORS load that worked, a missing image, or other URLs', () => {
    const storage = memoryStorage();
    noteLoaded(startState(JA, JA, storage), JA, storage); // CORS load worked
    // Missing file: CORS and plain both fail, so nothing ever loads at index 0.
    const missing = nextAfterError(nextAfterError(startState(`${JA}\n${TCGPLAYER}`, JA, storage), true), true);
    noteLoaded(missing, TCGPLAYER, storage); // the fallback showed
    noteLoaded({ ...startState(EN, EN, storage), cors: false }, EN, storage); // an English plain retry
    expect(jaLoadsPlain(storage)).toBe(false);
    expect(startState(JA2, JA2, storage)).toMatchObject({ cors: true });
  });

  it('never throws with blocked storage and remembers until reload', () => {
    expect(jaLoadsPlain(throwing)).toBe(false);
    expect(() => noteLoaded({ ...startState(JA, JA, throwing), cors: false }, JA, throwing)).not.toThrow();
    expect(startState(JA2, JA2, throwing)).toMatchObject({ cors: false });
    resetJaPlain();
    expect(jaLoadsPlain(throwing)).toBe(false);
  });
});
