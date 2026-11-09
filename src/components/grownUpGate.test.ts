import { afterEach, describe, expect, it } from 'vitest';
import { confirmGrownUp, GROWN_UP_KEY, grownUpConfirmed, resetGrownUpGate } from './grownUpGate';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const throwing = {
  getItem: (): string | null => {
    throw new Error('SecurityError');
  },
  setItem: (): void => {
    throw new Error('QuotaExceededError');
  },
};

afterEach(() => resetGrownUpGate());

describe('grown-up gate', () => {
  it('asks until a grown-up says OK, then remembers it in session storage', () => {
    const storage = memoryStorage();
    expect(grownUpConfirmed(storage)).toBe(false);
    confirmGrownUp(storage);
    expect(storage.data.get(GROWN_UP_KEY)).toBe('1');
    resetGrownUpGate(); // a reload: memory is gone, the session remembers
    expect(grownUpConfirmed(storage)).toBe(true);
  });

  it('reads an OK saved earlier in the session', () => {
    const storage = memoryStorage();
    storage.setItem(GROWN_UP_KEY, '1');
    expect(grownUpConfirmed(storage)).toBe(true);
  });

  it('never throws when storage is blocked and remembers the OK until reload', () => {
    expect(grownUpConfirmed(throwing)).toBe(false);
    expect(() => confirmGrownUp(throwing)).not.toThrow();
    expect(grownUpConfirmed(throwing)).toBe(true);
    resetGrownUpGate();
    expect(grownUpConfirmed(throwing)).toBe(false);
  });

  it('works without any storage (node)', () => {
    expect(grownUpConfirmed(undefined)).toBe(false);
    confirmGrownUp(undefined);
    expect(grownUpConfirmed(undefined)).toBe(true);
  });
});
