import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Fx from './fx';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let fx: typeof Fx;
beforeEach(async () => {
  vi.resetModules(); // fresh module state (memory cache, last known rates)
  fx = await import('./fx');
});
afterEach(() => vi.unstubAllGlobals());

describe('getRates', () => {
  it('reads EUR/KRW per USD from open.er-api.com', async () => {
    const fetchMock = vi.fn(async () => json({ result: 'success', rates: { USD: 1, EUR: 0.9, KRW: 1400 } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fx.getRates()).toMatchObject({ EUR: 0.9, KRW: 1400 });
    expect(fx.getRatesSync()).toMatchObject({ EUR: 0.9, KRW: 1400 });
    await fx.getRates();
    expect(fetchMock).toHaveBeenCalledTimes(1); // cached
  });

  it('falls back to frankfurter when the first provider fails', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('er-api') ? json({ result: 'error' }, 404) : json({ base: 'USD', rates: { EUR: 0.88, KRW: 1370 } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await fx.getRates()).toMatchObject({ EUR: 0.88, KRW: 1370 });
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual([
      'https://open.er-api.com/v6/latest/USD',
      'https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,KRW',
    ]);
  });

  it('never throws: uses the hard-coded fallback when offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 400)));
    expect(await fx.getRates()).toBe(fx.FALLBACK_RATES);
    expect(fx.getRatesSync()).toBe(fx.FALLBACK_RATES);
  });

  it('rejects malformed rates', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ rates: { EUR: 0, KRW: 'x' } })));
    expect(await fx.getRates()).toBe(fx.FALLBACK_RATES);
  });
});

describe('eurToUsd', () => {
  it('divides by EUR per USD', () => {
    expect(fx.eurToUsd(1.51, fx.FALLBACK_RATES)).toBeCloseTo(1.6858, 4);
    expect(fx.eurToUsd(0.9, { EUR: 0.9, KRW: 1400, fetchedAt: '' })).toBe(1);
  });
});
