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
  it('defaults from the browser language', async () => {
    expect(peek(store.useSettings)).toEqual({
      uiLang: 'ko',
      currency: 'USD',
      searchLang: 'ja',
      ebayWorkerUrl: '',
      theme: 'system',
    });
    await freshStore(new MemoryStorage(), 'en-US');
    expect(peek(store.useSettings)).toMatchObject({ uiLang: 'en', searchLang: 'en' });
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

  it('collectionTotalUsd multiplies by quantity and ignores unpriced cards', () => {
    const key = store.addToCollection(card('SV8a-001', [variant('normal', 0.1)]), 'normal');
    store.addToCollection(card('SV8a-002', [variant('normal', null)]), 'normal');
    store.setQuantity(key, 3);
    expect(store.collectionTotalUsd(saved())).toBe(0.3);
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

  it('clearHistory empties it', () => {
    store.pushHistory(card(), 1);
    store.clearHistory();
    expect(JSON.parse(ls.getItem('cc:history')!).data).toEqual([]);
  });
});

describe('snapshots', () => {
  const saved = () => JSON.parse(ls.getItem('cc:snapshots')!).data as { date: string; totalUsd: number }[];

  it('upserts one snapshot per local day, oldest first, max 120', () => {
    vi.useFakeTimers();
    const start = new Date(2026, 0, 1, 12);
    for (let d = 0; d < 125; d++) {
      vi.setSystemTime(new Date(start.getTime() + d * 86_400_000));
      store.recordSnapshot(d);
      store.recordSnapshot(d + 0.5);
    }
    const list = saved();
    expect(peek(store.useSnapshots)).toEqual(list);
    expect(list).toHaveLength(120);
    expect(list[0]).toEqual({ date: '2026-01-06', totalUsd: 5.5 });
    expect(list[119]).toEqual({ date: '2026-05-05', totalUsd: 124.5 });
  });

  it('ignores non-finite totals', () => {
    store.recordSnapshot(Number.NaN);
    expect(ls.getItem('cc:snapshots')).toBeNull();
  });
});

describe('resetAllData', () => {
  it('clears every store and cached API data', () => {
    store.updateSettings({ currency: 'KRW' });
    const key = store.addToCollection(card(), 'normal');
    store.setCollectionThumb(key, 'data:x');
    store.rememberScanPhoto('SV8a-084', 'data:y');
    store.pushHistory(card(), 1);
    store.recordSnapshot(5);
    ls.setItem('cc:cache:fx:usd', '{"v":1}');

    store.resetAllData();

    const data = (k: string) => JSON.parse(ls.getItem(k)!).data;
    expect(data('cc:settings').currency).toBe('USD');
    expect(data('cc:collection')).toEqual([]);
    expect(data('cc:thumbs')).toEqual({});
    expect(data('cc:history')).toEqual([]);
    expect(data('cc:snapshots')).toEqual([]);
    expect(store.getScanPhoto('SV8a-084')).toBeUndefined();
    expect(ls.getItem('cc:cache:fx:usd')).toBeNull();
  });
});
