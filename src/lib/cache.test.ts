import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cached, clearCache, fetchJson, HttpError, peekCached } from './cache';

/** Minimal Storage backed by a Map; `full` makes setItem throw like a quota error. */
function fakeStorage() {
  const data = new Map<string, string>();
  const store = {
    full: false,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (store.full) throw new DOMException('quota', 'QuotaExceededError');
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    data,
  };
  return store;
}

afterEach(() => {
  clearCache();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('cached', () => {
  it('returns the cached value within the TTL and refetches after it', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockResolvedValueOnce('a').mockResolvedValueOnce('b');
    expect(await cached('k', 1000, fn, { persist: false })).toBe('a');
    expect(await cached('k', 1000, fn, { persist: false })).toBe('a');
    vi.advanceTimersByTime(1001);
    expect(await cached('k', 1000, fn, { persist: false })).toBe('b');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('de-duplicates concurrent calls', async () => {
    const fn = vi.fn(async () => 42);
    const [a, b] = await Promise.all([cached('d', 1000, fn), cached('d', 1000, fn)]);
    expect([a, b]).toEqual([42, 42]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok');
    await expect(cached('f', 1000, fn)).rejects.toThrow('boom');
    expect(await cached('f', 1000, fn)).toBe('ok');
  });

  it('persists to localStorage and survives a reload', async () => {
    const store = fakeStorage();
    vi.stubGlobal('localStorage', store);
    await cached('p', 60_000, async () => ({ n: 1 }));
    expect([...store.data.keys()]).toEqual(['cc:cache:p']);

    vi.resetModules();
    const fresh = await import('./cache');
    const fn = vi.fn(async () => ({ n: 2 }));
    expect(await fresh.cached('p', 60_000, fn)).toEqual({ n: 1 });
    expect(fn).not.toHaveBeenCalled();
  });

  it('ignores storage errors (quota / private mode)', async () => {
    const store = fakeStorage();
    store.full = true;
    vi.stubGlobal('localStorage', store);
    expect(await cached('q', 1000, async () => 'v')).toBe('v');
    expect(await cached('q', 1000, async () => 'other')).toBe('v'); // memory copy
  });

  it('makes room by pruning expired entries when storage is full', async () => {
    vi.useFakeTimers();
    const store = fakeStorage();
    vi.stubGlobal('localStorage', store);
    await cached('old', 10, async () => 'x');
    vi.advanceTimersByTime(20);
    const setItem = store.setItem;
    let first = true;
    store.setItem = (k, v) => {
      if (first) {
        first = false;
        throw new DOMException('quota', 'QuotaExceededError');
      }
      setItem(k, v);
    };
    await cached('new', 1000, async () => 'y');
    expect([...store.data.keys()]).toEqual(['cc:cache:new']);
  });

  it('peekCached returns stale values; clearCache removes by prefix', async () => {
    vi.useFakeTimers();
    const store = fakeStorage();
    vi.stubGlobal('localStorage', store);
    await cached('fx:a', 10, async () => 1);
    await cached('card:b', 1000, async () => 2);
    vi.advanceTimersByTime(20);
    expect(peekCached('fx:a')).toBe(1);
    clearCache('fx:');
    expect(peekCached('fx:a')).toBeUndefined();
    expect(peekCached('card:b')).toBe(2);
    expect([...store.data.keys()]).toEqual(['cc:cache:card:b']);
  });
});

describe('fetchJson', () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const status = (s: number) => new Response('No available server', { status: s });

  beforeEach(() => vi.useFakeTimers());

  it('retries transient 503s with backoff', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(status(503)).mockResolvedValueOnce(status(503)).mockResolvedValueOnce(ok({ a: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const p = fetchJson('https://x.test/a');
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1200);
    expect(await p).toEqual({ a: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries network errors', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(ok([1]));
    vi.stubGlobal('fetch', fetchMock);
    const p = fetchJson('https://x.test/b');
    await vi.advanceTimersByTimeAsync(400);
    expect(await p).toEqual([1]);
  });

  it('throws HttpError with status for 4xx without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(status(404));
    vi.stubGlobal('fetch', fetchMock);
    const err = await fetchJson('https://x.test/c').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retries and reports the last status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(status(503)));
    const p = fetchJson('https://x.test/d', { retries: 1 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(400);
    expect(((await p) as HttpError).status).toBe(503);
  });

  it('aborts a request that exceeds the timeout', async () => {
    const hanging = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    vi.stubGlobal('fetch', hanging);
    const p = fetchJson('https://x.test/e', { timeoutMs: 100, retries: 0 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    expect(((await p) as Error).name).toBe('AbortError');
  });
});
