import { describe, expect, it } from 'vitest';
import { nextAfterError, startState } from './cardImageChain';

describe('CardImage fallback chain', () => {
  it('starts at the first source as a CORS request', () => {
    expect(startState('a\nb')).toEqual({ chain: 'a\nb', index: 0, cors: true, loaded: false });
  });

  it('retries a failed TCGdex image once without CORS before moving on', () => {
    const first = nextAfterError({ ...startState('t\nf'), loaded: true }, true);
    expect(first).toMatchObject({ index: 0, cors: false, loaded: false });
    const second = nextAfterError(first, true);
    expect(second).toMatchObject({ index: 1, cors: true, loaded: false });
  });

  it('moves straight to the next source for non-TCGdex images', () => {
    expect(nextAfterError({ ...startState('f\np'), index: 0 }, false)).toMatchObject({ index: 1, cors: true });
    expect(nextAfterError({ ...startState('t\nf\np'), index: 1 }, false)).toMatchObject({ index: 2 });
  });

  it('ends past the last source (card back)', () => {
    let s = startState('t');
    s = nextAfterError(s, true);
    s = nextAfterError(s, true);
    expect(s.index).toBe(1);
  });
});
