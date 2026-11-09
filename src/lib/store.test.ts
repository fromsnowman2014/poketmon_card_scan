import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardDetail, CardVariant } from './types';

/** Minimal Storage with an optional byte quota (UTF-16 chars × 2, like browsers count it). */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  constructor(private quotaBytes = Infinity) {}
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    const used = [...this.data].reduce((n, [key, val]) => n + (key === k ? 0 : (key.length + val.length) * 2), 0);
    if (used + (k.length + v.length) * 2 > this.quotaBytes) throw new DOMException('full', 'QuotaExceededError');
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

let ls: MemoryStorage;
let store: typeof import('./store');

async function freshStore(storage = new MemoryStorage(), language = 'ko-KR') {
  ls = storage;
  vi.stubGlobal('localStorage', ls);
  vi.stubGlobal('navigator', { language });
  vi.resetModules();
  store = await import('./store');
}

/** Reads a hook's current value by rendering it once (server renderer: no DOM needed). */
function peek<T>(hook: () => T): T {
  let value: T | undefined;
  const Probe = () => {
    value = hook();
    return null;
  };
  renderToString(createElement(Probe));
  return value as T;
}

/** Simulates an app restart that keeps localStorage. */
async function reload() {
  vi.resetModules();
  store = await import('./store');
}

function variant(key: string, market: number | null): CardVariant {
  return {
    key,
    type: key,
    summary: market === null ? null : { market, low: null, high: null, changePct: null, source: 'cardmarket', converted: true },
  };
}

function card(id = 'SV8a-084', variants: CardVariant[] = [variant('normal', 0.12), variant('reverse', 1.69)]): CardDetail {
  return {
    id,
    lang: 'ja',
    localId: id.split('-').pop() ?? '',
    name: 'ルチャブル',
    image: `https://assets.tcgdex.net/ja/SV/SV8a/${id}`,
    setId: 'SV8a',
    setName: 'テラスタルフェスex',
    setOfficialCount: 187,
    dexIds: [701],
    variants,
    defaultVariant: variants[0].key,
    fetchedAt: '2026-11-08T00:00:00.000Z',
  };
}

beforeEach(async () => {
  vi.useRealTimers();
  await freshStore();
});

describe('settings', () => {
  it('defaults from the browser language (Korean devices show won)', async () => {
    expect(peek(store.useSettings)).toEqual({
      uiLang: 'ko',
      currency: 'KRW',
      searchLang: 'ja',
      ebayWorkerUrl: '',
      theme: 'system',
    });
    await freshStore(new MemoryStorage(), 'en-US');
    expect(peek(store.useSettings)).toMatchObject({ uiLang: 'en', currency: 'USD', searchLang: 'en' });
    expect(ls.length).toBe(0); // defaults are not written until something changes
  });

  it('persists a versioned envelope and rejects invalid values', async () => {
    store.updateSettings({ currency: 'KRW', theme: 'light', ebayWorkerUrl: '  https://w.example.dev  ' });
    store.updateSettings({ theme: 'purple' as never, currency: 'EUR' as never });
    const saved = JSON.parse(ls.getItem('cc:settings')!);
    expect(saved.v).toBe(1);
    expect(saved.data).toEqual({
      uiLang: 'ko',
      currency: 'KRW',
      searchLang: 'ja',
      ebayWorkerUrl: 'https://w.example.dev',
      theme: 'light',
    });
  });

  it('survives corrupt or foreign data', async () => {
    ls.setItem('cc:settings', '{not json');
    ls.setItem('cc:collection', JSON.stringify({ v: 99, data: [{ key: 'x' }] }));
    ls.setItem('cc:history', JSON.stringify({ v: 1, data: 'nope' }));
    await reload();
    expect(peek(store.useSettings).theme).toBe('system');
    expect(peek(store.useCollection)).toEqual([]);
    expect(peek(store.useHistory)).toEqual([]);
    store.pushHistory(card(), 1);
    expect(JSON.parse(ls.getItem('cc:history')!).data).toHaveLength(1);
  });
});

describe('collection', () => {
  const saved = () => JSON.parse(ls.getItem('cc:collection')!).data as import('./types').CollectionItem[];

  it('adds a variant with its market price and increments on repeat', () => {
    const key = store.addToCollection(card(), 'reverse');
    expect(key).toBe('ja:SV8a-084:reverse');
    expect(store.collectionKey(card(), 'reverse')).toBe(key);
    expect(saved()[0]).toMatchObject({ key, qty: 1, priceUsd: 1.69, firstPriceUsd: 1.69, variant: 'reverse', dexIds: [701] });

    store.addToCollection(card('SV8a-084', [variant('normal', 0.12), variant('reverse', 2.5)]), 'reverse');
    expect(saved()).toHaveLength(1);
    expect(saved()[0]).toMatchObject({ qty: 2, priceUsd: 2.5, firstPriceUsd: 1.69 });
  });

  it('remembers whether the saved price was converted from EUR (≈)', async () => {
    const tcg: CardVariant = { ...variant('holo', 4), summary: { ...variant('holo', 4).summary!, source: 'tcgplayer', converted: false } };
    const a = store.addToCollection(card(), 'normal');
    const b = store.addToCollection(card('SV8a-002', [tcg]), 'holo');
    const c = store.addToCollection(card('SV8a-003', [variant('normal', null)]), 'normal');
    const byKey = () => Object.fromEntries(saved().map((i) => [i.key, i.priceApprox]));
    expect(byKey()).toEqual({ [a]: true, [b]: false, [c]: false });
    store.updateCollectionPrice(a, 0.2);
    store.updateCollectionPrice(c, 1, true);
    expect(byKey()).toMatchObject({ [a]: false, [c]: true });
    // Older saves without the flag still load.
    ls.setItem('cc:collection', JSON.stringify({ v: 1, data: saved().map(({ priceApprox: _, ...rest }) => rest) }));
    await reload();
    expect(peek(store.useCollection)).toHaveLength(3);
  });

  it('keeps newest first and stores null for unpriced variants', () => {
    store.addToCollection(card('SV8a-001'), 'normal');
    store.addToCollection(card('SV8a-002', [variant('normal', null)]), 'normal');
    expect(saved().map((i) => i.id)).toEqual(['SV8a-002', 'SV8a-001']);
    expect(saved()[0].priceUsd).toBeNull();
  });

  it('drops malformed stored items but keeps valid ones', async () => {
    store.addToCollection(card(), 'normal');
    const good = saved()[0];
    ls.setItem('cc:collection', JSON.stringify({ v: 1, data: [good, { ...good, qty: 0 }, { key: 'broken' }, null] }));
    await reload();
    expect(peek(store.useCollection)).toEqual([good]);
  });

  it('setQuantity floors, caps and removes at zero', () => {
    const key = store.addToCollection(card(), 'normal');
    store.setQuantity(key, 2.7);
    expect(saved()[0].qty).toBe(2);
    store.setQuantity(key, 5000);
    expect(saved()[0].qty).toBe(999);
    store.setQuantity(key, 0);
    expect(saved()).toEqual([]);
  });

  it('updateCollectionPrice keeps the first price, or sets it when unknown', () => {
    const a = store.addToCollection(card('SV8a-001'), 'normal');
    const b = store.addToCollection(card('SV8a-002', [variant('normal', null)]), 'normal');
    store.updateCollectionPrice(a, 0.5);
    store.updateCollectionPrice(b, 3);
    const [itemB, itemA] = saved();
    expect(itemA).toMatchObject({ priceUsd: 0.5, firstPriceUsd: 0.12 });
    expect(itemB).toMatchObject({ priceUsd: 3, firstPriceUsd: 3 });
  });

  it('makes room by dropping cached API data rather than losing My Cards', async () => {
    // 4 cached cards ≈ 2,800 bytes; the saved card (≈ 1,100 bytes) only fits once one is gone.
    await freshStore(new MemoryStorage(3500));
    const entry = (i: number) => JSON.stringify({ v: 'x'.repeat(300), exp: Date.now() + 60_000 + i });
    for (let i = 0; i < 4; i++) ls.setItem(`cc:cache:card:ja:${i}`, entry(i));
    const failed = vi.fn();
    store.onCollectionSaveFailed(failed);
    store.addToCollection(card(), 'normal');
    expect(JSON.parse(ls.getItem('cc:collection')!).data).toHaveLength(1);
    expect(ls.getItem('cc:cache:card:ja:0')).toBeNull(); // oldest went first
    expect(ls.getItem('cc:cache:card:ja:3')).not.toBeNull();
    expect(failed).not.toHaveBeenCalled();
  });

  it('tells listeners when My Cards could not be saved at all', async () => {
    await freshStore(new MemoryStorage(10));
    const failed = vi.fn();
    const off = store.onCollectionSaveFailed(failed);
    store.addToCollection(card(), 'normal');
    expect(failed).toHaveBeenCalledTimes(1);
    expect(peek(store.useCollection)).toHaveLength(1); // still shown for this session
    off();
    store.addToCollection(card(), 'normal');
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('collectionTotalUsd multiplies by quantity and ignores unpriced cards', () => {
    const key = store.addToCollection(card('SV8a-001', [variant('normal', 0.1)]), 'normal');
    store.addToCollection(card('SV8a-002', [variant('normal', null)]), 'normal');
    store.setQuantity(key, 3);
    expect(store.collectionTotalUsd(saved())).toBe(0.3);
  });

  it('collectionTotalUsd keeps fractions of a cent (rounded only when shown)', () => {
    const key = store.addToCollection(card('SV8a-003', [variant('normal', 0.0447)]), 'normal');
    store.setQuantity(key, 3);
    expect(store.collectionTotalUsd(saved())).toBe(0.1341);
  });
});

describe('photos', () => {
  it('remembers the last 10 scan photos in memory only', () => {
    for (let i = 0; i < 12; i++) store.rememberScanPhoto(`c${i}`, `data:${i}`);
    store.rememberScanPhoto('c2', 'data:2b'); // refresh moves it to the end
    expect(store.getScanPhoto('c0')).toBeUndefined();
    expect(store.getScanPhoto('c1')).toBeUndefined();
    expect(store.getScanPhoto('c2')).toBe('data:2b');
    expect(store.getScanPhoto('c11')).toBe('data:11');
    expect(ls.length).toBe(0);
  });

  it('persists collection thumbs and drops them with the card', async () => {
    const key = store.addToCollection(card(), 'normal');
    store.setCollectionThumb(key, 'data:image/jpeg;base64,AAA');
    await reload();
    expect(peek(store.useCollectionThumbs)).toEqual({ [key]: 'data:image/jpeg;base64,AAA' });
    store.removeFromCollection(key);
    expect(peek(store.useCollectionThumbs)).toEqual({});
    expect(JSON.parse(ls.getItem('cc:thumbs')!).data).toEqual({});
  });

  it('keeps only the newest thumbs that fit when storage is full', async () => {
    await freshStore(new MemoryStorage(1500));
    const photo = (n: number) => `data:${String(n).repeat(300)}`;
    for (let i = 1; i <= 4; i++) store.setCollectionThumb(`k${i}`, photo(i));
    expect(Object.keys(JSON.parse(ls.getItem('cc:thumbs')!).data)).toEqual(['k3', 'k4']);
    expect(Object.keys(peek(store.useCollectionThumbs))).toEqual(['k1', 'k2', 'k3', 'k4']);
  });
});

describe('history', () => {
  it('is newest first, de-duplicated per card and capped at 20', () => {
    for (let i = 0; i < 25; i++) store.pushHistory(card(`SV8a-${String(i).padStart(3, '0')}`), i);
    store.pushHistory(card('SV8a-010'), 99);
    const items = JSON.parse(ls.getItem('cc:history')!).data as import('./types').HistoryItem[];
    expect(items).toHaveLength(20);
    expect(items[0]).toMatchObject({ id: 'SV8a-010', priceUsd: 99, dexIds: [701], setName: 'テラスタルフェスex' });
    expect(items.filter((h) => h.id === 'SV8a-010')).toHaveLength(1);
    expect(items[1].id).toBe('SV8a-024');
    expect(items[0]).not.toHaveProperty('variants');
  });

  it('keeps the ≈ flag only for a known price', () => {
    store.pushHistory(card('SV8a-001'), 1, true);
    store.pushHistory(card('SV8a-002'), null, true);
    const items = JSON.parse(ls.getItem('cc:history')!).data as import('./types').HistoryItem[];
    expect(items.map((h) => h.priceApprox)).toEqual([false, true]);
  });

  it('clearHistory empties it', () => {
    store.pushHistory(card(), 1);
    store.clearHistory();
    expect(JSON.parse(ls.getItem('cc:history')!).data).toEqual([]);
  });
});

describe('snapshots', () => {
  type Saved = import('./types').ValueSnapshot;
  const saved = () => JSON.parse(ls.getItem('cc:snapshots')!).data as Saved[];
  const item = (key: string, priceUsd: number | null, qty = 1) =>
    ({ key, priceUsd, qty }) as import('./types').CollectionItem;

  it('upserts one snapshot per local day with each card\'s price and quantity, oldest first, max 120', () => {
    vi.useFakeTimers();
    const start = new Date(2026, 0, 1, 12);
    for (let d = 0; d < 125; d++) {
      vi.setSystemTime(new Date(start.getTime() + d * 86_400_000));
      store.recordSnapshot([item('a', d)]);
      store.recordSnapshot([item('a', d + 0.5), item('b', null)]);
    }
    const list = saved();
    expect(peek(store.useSnapshots)).toEqual(list);
    expect(list).toHaveLength(120);
    expect(list[0]).toEqual({ date: '2026-01-06', totalUsd: 5.5 });
    // Per-card data only where it can still be the "a week ago" baseline: the last 7 days + the newest older one.
    expect(list.filter((s) => s.cards).map((s) => s.date)).toEqual(
      ['2026-04-28', '2026-04-29', '2026-04-30', '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05'],
    );
    expect(list[119]).toEqual({ date: '2026-05-05', totalUsd: 124.5, cards: { a: [124.5, 1] } }); // unpriced b left out
  });

  it('records quantity changes even when the total stays the same', () => {
    store.recordSnapshot([item('a', 2, 1), item('b', 1, 2)]);
    store.recordSnapshot([item('a', 2, 2)]); // still $4 in total
    expect(saved()).toHaveLength(1);
    expect(saved()[0]).toEqual({ date: expect.any(String), totalUsd: 4, cards: { a: [2, 2] } });
  });

  it('reads old snapshots without per-card data and drops a malformed cards map', async () => {
    ls.setItem(
      'cc:snapshots',
      JSON.stringify({ v: 1, data: [{ date: '2026-11-01', totalUsd: 3 }, { date: '2026-11-02', totalUsd: 4, cards: { a: ['x', 1] } }, { date: 'bad', totalUsd: 1 }] }),
    );
    await reload();
    expect(peek(store.useSnapshots)).toEqual([
      { date: '2026-11-01', totalUsd: 3 },
      { date: '2026-11-02', totalUsd: 4 },
    ]);
  });
});

describe('resetAllData', () => {
  it('clears every store and cached API data', () => {
    store.updateSettings({ currency: 'KRW' });
    const key = store.addToCollection(card(), 'normal');
    store.setCollectionThumb(key, 'data:x');
    store.rememberScanPhoto('SV8a-084', 'data:y');
    store.pushHistory(card(), 1);
    store.recordSnapshot(peek(store.useCollection));
    ls.setItem('cc:cache:fx:usd', '{"v":1}');

    store.resetAllData();

    const data = (k: string) => JSON.parse(ls.getItem(k)!).data;
    expect(data('cc:settings').currency).toBe('KRW'); // the Korean default
    expect(data('cc:collection')).toEqual([]);
    expect(data('cc:thumbs')).toEqual({});
    expect(data('cc:history')).toEqual([]);
    expect(data('cc:snapshots')).toEqual([]);
    expect(store.getScanPhoto('SV8a-084')).toBeUndefined();
    expect(ls.getItem('cc:cache:fx:usd')).toBeNull();
  });
});
