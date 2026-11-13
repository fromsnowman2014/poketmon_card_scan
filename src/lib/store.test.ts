import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
/** The phone's time zone as region.guessCountry sees it (pinned, so tests don't depend on the machine's zone). */
let zone = 'UTC';

async function freshStore(storage = new MemoryStorage(), language = 'ko-KR', languages?: string[]) {
  ls = storage;
  vi.stubGlobal('localStorage', ls);
  vi.stubGlobal('navigator', { language, languages: languages ?? [language] });
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
  vi.restoreAllMocks();
  zone = 'UTC';
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...real.call(this), timeZone: zone };
  });
  await freshStore();
});

describe('settings', () => {
  it('defaults from the browser: UI language from the language, money from the country', async () => {
    expect(peek(store.useSettings)).toEqual({
      uiLang: 'ko',
      country: 'KR',
      currency: 'KRW',
      searchLang: 'ja',
      ebayWorkerUrl: '',
      theme: 'system',
    });
    await freshStore(new MemoryStorage(), 'en-US');
    expect(peek(store.useSettings)).toMatchObject({ uiLang: 'en', country: 'US', currency: 'USD', searchLang: 'en' });
    // The first guess is saved right away: the country means where the kid was when the app first opened.
    expect(JSON.parse(ls.getItem('cc:settings')!).data).toMatchObject({ country: 'US', currency: 'USD' });
  });

  it('does not ask on a trip abroad when the first guess was confident', async () => {
    zone = 'Asia/Seoul';
    await freshStore(new MemoryStorage(), 'ko', ['ko']); // a bare "ko" phone: only the time zone says Korea
    expect(peek(store.useSettings)).toMatchObject({ country: 'KR', currency: 'KRW' });
    expect(store.needsCountryPrompt()).toBe(false);
    zone = 'Asia/Tokyo';
    await reload();
    expect(store.needsCountryPrompt()).toBe(false);
    expect(peek(store.useSettings)).toMatchObject({ country: 'KR', currency: 'KRW' });
  });

  it('saves the first guess only when that is safe', async () => {
    // A value this version can't read (newer app) is left alone.
    const newer = JSON.stringify({ v: 2, data: { country: 'KR', currency: 'KRW' } });
    ls.setItem('cc:settings', newer);
    await reload();
    peek(store.useSettings);
    expect(ls.getItem('cc:settings')).toBe(newer);
    // Full storage: no throw, and cached API data is not dropped to make room during a render.
    await freshStore(new MemoryStorage(300));
    ls.setItem('cc:cache:card:ja:1', JSON.stringify({ v: 'x'.repeat(60), exp: Date.now() + 60_000 }));
    expect(() => peek(store.useSettings)).not.toThrow();
    expect(ls.getItem('cc:cache:card:ja:1')).not.toBeNull();
  });

  it('keeps the first country on a trip abroad', async () => {
    zone = 'Asia/Seoul';
    await freshStore(new MemoryStorage(), 'ko-KR');
    expect(peek(store.useSettings)).toMatchObject({ country: 'KR', currency: 'KRW' });
    zone = 'Pacific/Honolulu'; // on holiday: the phone now says US
    await reload();
    expect(peek(store.useSettings)).toMatchObject({ country: 'KR', currency: 'KRW' });
    expect(store.needsCountryPrompt()).toBe(false);
  });

  it('gives a Korean-speaking kid in the US Korean screens with dollars', async () => {
    zone = 'America/Los_Angeles';
    await freshStore(new MemoryStorage(), 'ko-KR');
    expect(peek(store.useSettings)).toMatchObject({ uiLang: 'ko', country: 'US', currency: 'USD', searchLang: 'en' });
    zone = 'Asia/Seoul';
    await freshStore(new MemoryStorage(), 'en-US');
    expect(peek(store.useSettings)).toMatchObject({ uiLang: 'en', country: 'KR', currency: 'KRW', searchLang: 'ja' });
  });

  it('switching country switches the money and search language, unless the same change sets them', () => {
    store.updateSettings({ country: 'US' });
    expect(peek(store.useSettings)).toMatchObject({ uiLang: 'ko', country: 'US', currency: 'USD', searchLang: 'en' });
    store.updateSettings({ currency: 'KRW' }); // a grown-up can still pick won
    expect(peek(store.useSettings)).toMatchObject({ country: 'US', currency: 'KRW' });
    store.updateSettings({ country: 'US' }); // same country: nothing resets
    expect(peek(store.useSettings).currency).toBe('KRW');
    store.updateSettings({ country: 'KR', currency: 'USD' });
    expect(peek(store.useSettings)).toMatchObject({ country: 'KR', currency: 'USD', searchLang: 'ja' });
    store.updateSettings({ country: 'JP' as never });
    expect(peek(store.useSettings).country).toBe('KR');
  });

  it('keeps the saved money of settings saved before country existed, when the kid picked it', async () => {
    // A Korean phone saved won + 日本語 search by default, so dollars + English were a pick.
    ls.setItem('cc:settings', JSON.stringify({ v: 1, data: { uiLang: 'ko', currency: 'USD', searchLang: 'en', ebayWorkerUrl: '', theme: 'dark' } }));
    await reload();
    expect(peek(store.useSettings)).toMatchObject({ country: 'KR', currency: 'USD', searchLang: 'en', theme: 'dark' });
    expect(JSON.parse(ls.getItem('cc:settings')!).data).toMatchObject({ country: 'KR', currency: 'USD' }); // saved once
  });

  it('gives older settings the country\'s money when the old app only saved its default', async () => {
    // An English phone in Seoul: the old app saved dollars + English by default (whenever the theme changed).
    zone = 'Asia/Seoul';
    await freshStore(new MemoryStorage(), 'en-US');
    ls.setItem('cc:settings', JSON.stringify({ v: 1, data: { uiLang: 'en', currency: 'USD', searchLang: 'en', ebayWorkerUrl: '', theme: 'dark' } }));
    await reload();
    expect(peek(store.useSettings)).toMatchObject({ uiLang: 'en', country: 'KR', currency: 'KRW', searchLang: 'ja', theme: 'dark' });
    // Won there was a pick (not the English default): kept.
    ls.setItem('cc:settings', JSON.stringify({ v: 1, data: { uiLang: 'en', currency: 'KRW', searchLang: 'en', theme: 'light' } }));
    await reload();
    expect(peek(store.useSettings)).toMatchObject({ country: 'KR', currency: 'KRW', searchLang: 'ja', theme: 'light' });
    // A Korean phone in Los Angeles that saved the old Korean default (won + 日本語) gets dollars + English.
    zone = 'America/Los_Angeles';
    await freshStore(new MemoryStorage(), 'ko-KR');
    ls.setItem('cc:settings', JSON.stringify({ v: 1, data: { uiLang: 'ko', currency: 'KRW', searchLang: 'ja', ebayWorkerUrl: 'https://w.example.dev' } }));
    await reload();
    expect(peek(store.useSettings)).toMatchObject({ uiLang: 'ko', country: 'US', currency: 'USD', searchLang: 'en', ebayWorkerUrl: 'https://w.example.dev' });
  });

  it('does not stop clearing when storage refuses to remove a key', () => {
    store.addToCollection(card(), 'normal');
    ls.removeItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    expect(() => store.resetAllData()).not.toThrow();
    expect(peek(store.useCollection)).toEqual([]);
  });

  it('asks for the country once, only when the phone gave no hint', async () => {
    expect(store.needsCountryPrompt()).toBe(false); // ko-KR
    await freshStore(new MemoryStorage(), 'de-DE');
    expect(store.needsCountryPrompt()).toBe(true);
    expect(peek(store.useSettings)).toMatchObject({ country: 'US', currency: 'USD' });
    store.updateSettings({ country: 'KR' });
    expect(store.needsCountryPrompt()).toBe(false);
    expect(peek(store.useSettings)).toMatchObject({ country: 'KR', currency: 'KRW' });
    await reload();
    expect(store.needsCountryPrompt()).toBe(false);
    store.resetAllData();
    expect(store.needsCountryPrompt()).toBe(true);
    store.markCountryAsked(); // dismissed: keep the guess
    expect(store.needsCountryPrompt()).toBe(false);
  });

  it('persists a versioned envelope and rejects invalid values', async () => {
    store.updateSettings({ currency: 'KRW', theme: 'light', ebayWorkerUrl: '  https://w.example.dev  ' });
    store.updateSettings({ theme: 'purple' as never, currency: 'EUR' as never });
    const saved = JSON.parse(ls.getItem('cc:settings')!);
    expect(saved.v).toBe(1);
    expect(saved.data).toEqual({
      uiLang: 'ko',
      country: 'KR',
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
    store.updateCollectionPrice(a, 0.5, true); // still a Cardmarket price
    store.updateCollectionPrice(b, 3);
    const [itemB, itemA] = saved();
    expect(itemA).toMatchObject({ priceUsd: 0.5, priceApprox: true, firstPriceUsd: 0.12 });
    expect(itemB).toMatchObject({ priceUsd: 3, priceApprox: false, firstPriceUsd: 3 });
    store.updateCollectionPrice('ja:nope:normal', 9); // not saved: nothing happens
    expect(saved()).toHaveLength(2);
  });

  describe('a re-checked price from another market (Cardmarket ≈ ↔ TCGplayer exact)', () => {
    const snaps = () => JSON.parse(ls.getItem('cc:snapshots')!).data as import('./types').ValueSnapshot[];
    const exact = (key: string, market: number): CardVariant => ({ ...variant(key, market), summary: { ...variant(key, market).summary!, source: 'tcgplayer', converted: false } });

    it('starts the card over: first price = new price, and it leaves the "since last week" baselines', () => {
      vi.useFakeTimers({ now: new Date(2026, 10, 1, 12) });
      const a = store.addToCollection(card('SV8a-084'), 'normal'); // ≈ $0.12 (Cardmarket)
      const b = store.addToCollection(card('SV8a-085'), 'reverse'); // ≈ $1.69
      store.recordSnapshot(peek(store.useCollection));
      vi.setSystemTime(new Date(2026, 10, 9, 12));
      store.recordSnapshot(peek(store.useCollection));
      expect(snaps().map((s) => Object.keys(s.cards ?? {}).sort())).toEqual([[a, b].sort(), [a, b].sort()]);

      store.updateCollectionPrice(a, 0.18, false); // the TCGplayer price arrives
      const item = saved().find((i) => i.key === a)!;
      expect(item).toMatchObject({ priceUsd: 0.18, priceApprox: false, firstPriceUsd: 0.18, priceUpdatedAt: new Date(2026, 10, 9, 12).toISOString() });
      // The other card is untouched, in My Cards and in every snapshot; totals stay what they were that day.
      expect(saved().find((i) => i.key === b)).toMatchObject({ priceUsd: 1.69, firstPriceUsd: 1.69 });
      expect(snaps().map((s) => s.cards)).toEqual([{ [b]: [1.69, 1] }, { [b]: [1.69, 1] }]);
      expect(snaps().map((s) => s.totalUsd)).toEqual([1.81, 1.81]);
      // Today's snapshot takes the card back in with its new price: no move against last week for it.
      store.recordSnapshot(peek(store.useCollection));
      expect(snaps()[1].cards).toEqual({ [a]: [0.18, 1], [b]: [1.69, 1] });
      expect(snaps()[0].cards).toEqual({ [b]: [1.69, 1] });
    });

    it('a new price from the same market only moves the price', () => {
      const a = store.addToCollection(card('SV8a-084', [exact('normal', 0.18)]), 'normal');
      store.recordSnapshot(peek(store.useCollection));
      store.updateCollectionPrice(a, 0.25);
      expect(saved()[0]).toMatchObject({ priceUsd: 0.25, priceApprox: false, firstPriceUsd: 0.18 });
      expect(snaps()[0].cards).toEqual({ [a]: [0.18, 1] });
    });

    it('does not put an approximate price over an exact one for 7 days (a price file that failed to load)', () => {
      vi.useFakeTimers({ now: new Date('2026-11-12T10:00:00Z') });
      const a = store.addToCollection(card('SV8a-084', [exact('normal', 0.18)]), 'normal');
      store.recordSnapshot(peek(store.useCollection));
      const before = saved()[0];

      vi.setSystemTime(new Date('2026-11-19T09:59:00Z')); // 6 days 23 h 59 min later
      store.updateCollectionPrice(a, 0.03, true);
      expect(saved()[0]).toEqual(before); // price, ≈ flag, first price and "checked" time all as they were
      expect(snaps()[0].cards).toEqual({ [a]: [0.18, 1] });
      // An exact price is always welcome.
      store.updateCollectionPrice(a, 0.2, false);
      expect(saved()[0]).toMatchObject({ priceUsd: 0.2, priceApprox: false, firstPriceUsd: 0.18, priceUpdatedAt: '2026-11-19T09:59:00.000Z' });

      vi.setSystemTime(new Date('2026-11-26T09:59:00Z')); // 7 days after that
      store.updateCollectionPrice(a, 0.03, true);
      expect(saved()[0]).toMatchObject({ priceUsd: 0.03, priceApprox: true, firstPriceUsd: 0.03, priceUpdatedAt: '2026-11-26T09:59:00.000Z' });
      expect(snaps()[0].cards).toEqual({});
    });

    it('a missing price never replaces a saved one, nor marks it as checked', () => {
      vi.useFakeTimers({ now: new Date('2026-11-12T10:00:00Z') });
      const a = store.addToCollection(card('SV8a-084'), 'normal');
      const b = store.addToCollection(card('SV8a-185', [variant('reverse-masterball', null)]), 'reverse-masterball');
      const before = saved();
      vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
      const write = vi.spyOn(ls, 'setItem');
      store.updateCollectionPrice(a, null);
      store.updateCollectionPrice(a, null, true);
      store.updateCollectionPrice(b, null);
      expect(saved()).toEqual(before);
      expect(write).not.toHaveBeenCalled();
      // An unpriced card takes its first price from whichever market has one, without a "switch".
      store.updateCollectionPrice(b, 2.27);
      expect(saved().find((i) => i.key === b)).toMatchObject({ priceUsd: 2.27, priceApprox: false, firstPriceUsd: 2.27, priceUpdatedAt: '2026-11-13T10:00:00.000Z' });
    });

    it('adding another copy follows the same rules', () => {
      vi.useFakeTimers({ now: new Date('2026-11-12T10:00:00Z') });
      const key = store.addToCollection(card('SV8a-084'), 'normal'); // ≈ $0.12
      store.recordSnapshot(peek(store.useCollection));
      store.addToCollection(card('SV8a-084', [exact('normal', 0.18)]), 'normal');
      expect(saved()[0]).toMatchObject({ qty: 2, priceUsd: 0.18, priceApprox: false, firstPriceUsd: 0.18 });
      expect(snaps()[0].cards).toEqual({});
      // Back on the Cardmarket stand-in the next day: one more copy, same price.
      vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
      store.addToCollection(card('SV8a-084'), 'normal');
      expect(saved()[0]).toMatchObject({ key, qty: 3, priceUsd: 0.18, priceApprox: false, priceUpdatedAt: '2026-11-12T10:00:00.000Z' });
      store.addToCollection(card('SV8a-084', [variant('normal', null)]), 'normal');
      expect(saved()[0]).toMatchObject({ qty: 4, priceUsd: 0.18 });
    });

    it('saves an asking price as approximate', () => {
      const asking: CardVariant = { ...variant('normal', 4.99), summary: { ...variant('normal', 4.99).summary!, source: 'tcgplayer', converted: false, asking: true } };
      const key = store.addToCollection(card('SV-P-127', [asking]), 'normal');
      expect(saved()[0]).toMatchObject({ key, priceUsd: 4.99, priceApprox: true });
    });
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

describe('collection: a saved card is never lost by the app', () => {
  type Item = import('./types').CollectionItem;
  const saved = () => JSON.parse(ls.getItem('cc:collection')!).data as Item[];
  const keys = (items: { key: string }[]) => items.map((i) => i.key);
  const add = (id: string) => store.addToCollection(card(id, [variant('normal', 1)]), 'normal');

  /** Storage whose first read of My Cards comes back empty (Safari when its storage process isn't connected yet). */
  class FirstReadEmpty extends MemoryStorage {
    private fooled = false;
    getItem(k: string) {
      if (k === 'cc:collection' && !this.fooled) {
        this.fooled = true;
        return null;
      }
      return super.getItem(k);
    }
  }

  /** Storage that accepts a write without error but doesn't keep it (Safari after its storage process failed to write). */
  class SilentStorage extends MemoryStorage {
    silent = false;
    setItem(k: string, v: string) {
      if (this.silent && k === 'cc:collection') return;
      super.setItem(k, v);
    }
  }

  /** Storage that refuses access until `blocked` is turned off (Safari "Block All Cookies"). */
  class BlockedStorage extends MemoryStorage {
    blocked = true;
    getItem(k: string) {
      if (this.blocked) throw new DOMException('denied', 'SecurityError');
      return super.getItem(k);
    }
    setItem(k: string, v: string) {
      if (this.blocked) throw new DOMException('denied', 'SecurityError');
      super.setItem(k, v);
    }
  }

  it('a wrong empty read at startup does not overwrite the saved cards on the next add', async () => {
    add('SV8a-001');
    add('SV8a-002');
    const storage = new FirstReadEmpty();
    for (let i = 0; i < ls.length; i++) storage.setItem(ls.key(i)!, ls.getItem(ls.key(i)!)!);
    await freshStore(storage);
    expect(peek(store.useCollection)).toEqual([]); // the wrong read
    add('SV8a-003');
    expect(keys(saved())).toEqual(['ja:SV8a-003:normal', 'ja:SV8a-002:normal', 'ja:SV8a-001:normal']);
    expect(keys(peek(store.useCollection))).toEqual(keys(saved()));
  });

  it('storage that suddenly reads empty mid-session keeps what memory knows', () => {
    add('SV8a-001');
    add('SV8a-002');
    peek(store.useCollection);
    ls.removeItem('cc:collection'); // a hiccup, not a change made by the app
    add('SV8a-003');
    expect(keys(saved())).toEqual(['ja:SV8a-003:normal', 'ja:SV8a-002:normal', 'ja:SV8a-001:normal']);
  });

  it('a second page with an old list does not wipe what the first one saved', async () => {
    add('SV8a-001');
    const pageA = store;
    peek(pageA.useCollection);
    vi.resetModules();
    const pageB = await import('./store');
    pageB.addToCollection(card('SV8a-002', [variant('normal', 1)]), 'normal');
    pageA.addToCollection(card('SV8a-003', [variant('normal', 1)]), 'normal'); // page A never heard of 002
    expect(keys(saved()).sort()).toEqual(['ja:SV8a-001:normal', 'ja:SV8a-002:normal', 'ja:SV8a-003:normal']);
  });

  it('keeps stored entries it cannot read and writes them back untouched', async () => {
    add('SV8a-001');
    const good = saved()[0];
    const odd = { ...good, key: 'ja:SV8a-009:normal', setName: null };
    ls.setItem('cc:collection', JSON.stringify({ v: 1, data: [good, odd] }));
    await reload();
    expect(keys(peek(store.useCollection))).toEqual([good.key]); // not shown…
    add('SV8a-002');
    expect(saved()).toContainEqual(odd); // …but never erased
    expect(saved()).toHaveLength(3);
  });

  it('never writes over a value from a newer app, and says the card is not saved', async () => {
    const newer = JSON.stringify({ v: 2, data: { cards: ['x'] } });
    ls.setItem('cc:collection', newer);
    await reload();
    const failed = vi.fn();
    store.onCollectionSaveFailed(failed);
    add('SV8a-001');
    expect(ls.getItem('cc:collection')).toBe(newer);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(store.getCollectionSaveState()).toMatchObject({ saved: false, problem: 'unknown' });
    expect(keys(peek(store.useCollection))).toEqual(['ja:SV8a-001:normal']); // shown for this session
  });

  it('storedCount: what storage holds, or what it held when last read or written', async () => {
    const storage = new BlockedStorage();
    storage.blocked = false;
    await freshStore(storage);
    add('SV8a-001');
    expect(store.storedCount('ja:SV8a-001:normal')).toBe(1);
    expect(store.storedCount('ja:SV8a-002:normal')).toBe(0);
    storage.blocked = true;
    add('SV8a-001'); // not saved
    expect(store.storedCount('ja:SV8a-001:normal')).toBe(1);
  });

  it('a backup brought in on blocked storage is shown, and the import itself says why it is not saved', async () => {
    add('SV8a-001');
    const backup = store.exportCollection();
    await freshStore(new BlockedStorage());
    const failed = vi.fn();
    store.onCollectionSaveFailed(failed);
    expect(store.importCollection(backup)).toMatchObject({ added: 1, saved: false, problem: 'blocked' });
    expect(failed).not.toHaveBeenCalled(); // the import's own message is the one the kid sees
    expect(store.getCollectionSaveState()).toMatchObject({ saved: false, problem: 'blocked' });
    expect(keys(peek(store.useCollection))).toEqual(['ja:SV8a-001:normal']);
  });

  it('reports blocked storage until a save works, then saves what only memory had', async () => {
    const storage = new BlockedStorage();
    await freshStore(storage);
    add('SV8a-001');
    expect(store.getCollectionSaveState()).toMatchObject({ saved: false, problem: 'blocked' });
    expect(peek(store.useCollectionSaveState).saved).toBe(false);
    storage.blocked = false;
    expect(store.retryCollectionSave()).toBe(true);
    expect(keys(saved())).toEqual(['ja:SV8a-001:normal']);
    expect(store.getCollectionSaveState()).toMatchObject({ saved: true });
    expect(store.getCollectionSaveState().lastSavedAt).toMatch(/^\d{4}-/);
  });

  it('a card not saved before goes along with the next change that can be saved', async () => {
    const storage = new BlockedStorage();
    await freshStore(storage);
    add('SV8a-001');
    storage.blocked = false;
    add('SV8a-002');
    expect(keys(saved())).toEqual(['ja:SV8a-002:normal', 'ja:SV8a-001:normal']);
    expect(store.getCollectionSaveState().saved).toBe(true);
  });

  it('a change that changes nothing writes nothing and keeps the same list (no re-render)', () => {
    const key = add('SV8a-001');
    const before = store.exportCollection();
    const raw = ls.getItem('cc:collection');
    store.setQuantity(key, 1);
    store.updateCollectionPrice('ja:other:normal', 5);
    expect(store.exportCollection()).toBe(before);
    expect(ls.getItem('cc:collection')).toBe(raw);
  });

  it('a no-op change on blocked storage does not report a failure', async () => {
    const storage = new BlockedStorage();
    await freshStore(storage);
    const failed = vi.fn();
    store.onCollectionSaveFailed(failed);
    store.updateCollectionPrice('ja:nothing:normal', 1);
    expect(failed).not.toHaveBeenCalled();
    expect(store.getCollectionSaveState().saved).toBe(true);
  });

  it('photos give way to cards when storage is full', async () => {
    await freshStore(new MemoryStorage(7500));
    const photo = (n: number) => `data:${String(n).repeat(1000)}`;
    for (let i = 1; i <= 3; i++) store.setCollectionThumb(`k${i}`, photo(i)); // ≈ 6.1 KB of 7.5 KB
    const failed = vi.fn();
    store.onCollectionSaveFailed(failed);
    for (let i = 1; i <= 3; i++) add(`SV8a-00${i}`); // ≈ 0.75 KB each: the second no longer fits next to all photos
    expect(saved()).toHaveLength(3);
    expect(failed).not.toHaveBeenCalled();
    const left = Object.keys(JSON.parse(ls.getItem('cc:thumbs')!).data);
    expect(left.length).toBeLessThan(3);
    expect(left).toContain('k3'); // the newest photo stays longest
  });

  it('caps the photos so they never fill storage by themselves', () => {
    const big = (n: number) => `data:${String(n % 10).repeat(30_000)}`;
    for (let i = 0; i < 60; i++) store.setCollectionThumb(`k${i}`, big(i));
    const kept = JSON.parse(ls.getItem('cc:thumbs')!).data as Record<string, string>;
    const chars = Object.entries(kept).reduce((n, [k, v]) => n + k.length + v.length, 0);
    expect(chars).toBeLessThanOrEqual(1_200_000);
    expect(Object.keys(kept)).toContain('k59');
    expect(Object.keys(kept)).not.toContain('k0');
  });

  it('reads a save back and reports one that storage quietly dropped', async () => {
    vi.useFakeTimers();
    const storage = new SilentStorage();
    await freshStore(storage);
    const failed = vi.fn();
    store.onCollectionSaveFailed(failed);
    storage.silent = true;
    add('SV8a-001');
    expect(store.getCollectionSaveState().saved).toBe(true); // setItem didn't complain
    vi.advanceTimersByTime(1500); // read back: missing, so one more try
    expect(failed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500); // still missing
    expect(failed).toHaveBeenCalledTimes(1);
    expect(store.getCollectionSaveState()).toMatchObject({ saved: false, problem: 'unknown' });
    storage.silent = false;
    expect(store.retryCollectionSave()).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(store.getCollectionSaveState().saved).toBe(true);
    expect(keys(saved())).toEqual(['ja:SV8a-001:normal']);
  });

  it('a read-back finds the save that a quick second try made stick', async () => {
    vi.useFakeTimers();
    await freshStore();
    add('SV8a-001');
    ls.removeItem('cc:collection'); // dropped once
    vi.advanceTimersByTime(1500);
    expect(keys(saved())).toEqual(['ja:SV8a-001:normal']);
    vi.advanceTimersByTime(1500);
    expect(store.getCollectionSaveState().saved).toBe(true);
  });

  describe('Safari quietly dropping a save (a full phone)', () => {
    /**
     * Like Safari: a write shows at once, and when its storage process can't write it (full), storage goes back to what
     * it really holds a moment later. `disk` is that value.
     */
    class FullPhoneStorage extends MemoryStorage {
      full = false;
      disk: string | null = null;
      setItem(k: string, v: string) {
        super.setItem(k, v);
        if (k !== 'cc:collection') return;
        if (!this.full) this.disk = v;
        else setTimeout(() => (this.disk === null ? super.removeItem(k) : super.setItem(k, this.disk)), 30);
      }
    }
    let phone: FullPhoneStorage;
    const onDisk = () => (phone.disk === null ? [] : (JSON.parse(phone.disk).data as Item[]));
    const counts = (items: Item[]) => items.map((i) => `${i.localId}×${i.qty}`);
    const settle = () => vi.advanceTimersByTime(3200); // read back, one more try, read back again

    beforeEach(async () => {
      vi.useFakeTimers();
      phone = new FullPhoneStorage();
      await freshStore(phone);
    });

    it('reports the dropped save, and "try again" saves what the kid sees (not the old list)', () => {
      add('SV8a-001');
      settle();
      phone.full = true;
      add('SV8a-001'); // two copies now
      settle();
      expect(store.getCollectionSaveState()).toMatchObject({ saved: false, problem: 'unknown' });
      expect(counts(store.exportCollection())).toEqual(['001×2']); // still shown
      expect(counts(onDisk())).toEqual(['001×1']);
      phone.full = false;
      expect(store.retryCollectionSave()).toBe(true);
      settle();
      expect(counts(onDisk())).toEqual(['001×2']);
      expect(store.getCollectionSaveState().saved).toBe(true);
    });

    it('a dropped removal stays removed when the next change is saved', () => {
      add('SV8a-001');
      add('SV8a-002');
      settle();
      phone.full = true;
      store.removeFromCollection('ja:SV8a-002:normal');
      settle();
      phone.full = false;
      add('SV8a-003');
      settle();
      expect(counts(onDisk())).toEqual(['003×1', '001×1']);
      expect(store.getCollectionSaveState().saved).toBe(true);
    });

    it('a tap right after a dropped save builds on what the kid sees', () => {
      add('SV8a-001');
      settle();
      phone.full = true;
      add('SV8a-001'); // 2, dropped 30 ms later
      vi.advanceTimersByTime(100);
      phone.full = false;
      add('SV8a-001'); // 3, before the read-back noticed
      settle();
      expect(counts(onDisk())).toEqual(['001×3']);
      expect(store.getCollectionSaveState().saved).toBe(true);
    });

    it('two taps before Safari goes back: both are kept, and the drop is reported', () => {
      add('SV8a-001');
      settle();
      phone.full = true;
      add('SV8a-001'); // 2
      vi.advanceTimersByTime(5);
      add('SV8a-001'); // 3: storage still shows 2, Safari hasn't gone back to 1 yet
      settle();
      expect(counts(store.exportCollection())).toEqual(['001×3']);
      expect(store.getCollectionSaveState()).toMatchObject({ saved: false, problem: 'unknown' });
      phone.full = false;
      expect(store.retryCollectionSave()).toBe(true);
      settle();
      expect(counts(onDisk())).toEqual(['001×3']);
      expect(store.getCollectionSaveState().saved).toBe(true);
    });

    it('a removal and a +1 before Safari goes back: the card stays removed and the +1 stays', () => {
      add('SV8a-001');
      add('SV8a-002');
      settle();
      phone.full = true;
      store.removeFromCollection('ja:SV8a-002:normal');
      vi.advanceTimersByTime(5);
      add('SV8a-001');
      settle();
      expect(counts(store.exportCollection())).toEqual(['001×2']);
      expect(store.getCollectionSaveState().saved).toBe(false);
      phone.full = false;
      add('SV8a-003');
      settle();
      expect(counts(onDisk())).toEqual(['003×1', '001×2']);
    });

    it('a dropped "remove one": storedCount says what the card goes back to', () => {
      add('SV8a-001');
      add('SV8a-001');
      settle();
      phone.full = true;
      store.setQuantity('ja:SV8a-001:normal', 1);
      settle();
      expect(store.getCollectionSaveState().saved).toBe(false);
      expect(store.storedCount('ja:SV8a-001:normal')).toBe(2);
      expect(store.storedCount('ja:SV8a-009:normal')).toBe(0);
    });

    describe('with the app going to the background and back, and other tabs', () => {
      let doc: EventTarget & { visibilityState: string };
      let win: EventTarget;
      beforeEach(async () => {
        doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
        win = new EventTarget();
        vi.stubGlobal('document', doc);
        vi.stubGlobal('window', win);
        await freshStore(phone);
      });
      afterEach(() => {
        vi.unstubAllGlobals();
      });

      const hideAndShow = () => {
        doc.visibilityState = 'hidden';
        doc.dispatchEvent(new Event('visibilitychange'));
        doc.visibilityState = 'visible';
        doc.dispatchEvent(new Event('visibilitychange'));
      };

      for (const after of [10, 500, 1600]) {
        it(`coming back ${after} ms after a dropped save still reports it`, () => {
          add('SV8a-001');
          settle();
          phone.full = true;
          add('SV8a-002');
          vi.advanceTimersByTime(after);
          hideAndShow();
          settle();
          expect(store.getCollectionSaveState().saved).toBe(false);
          expect(keys(store.exportCollection())).toEqual(['ja:SV8a-002:normal', 'ja:SV8a-001:normal']);
          phone.full = false;
          expect(store.retryCollectionSave()).toBe(true);
          settle();
          expect(counts(onDisk())).toEqual(['002×1', '001×1']);
        });
      }

      it('another tab saving during the read-back keeps (and saves) the card this page added', () => {
        add('SV8a-001');
        settle();
        phone.full = true;
        add('SV8a-002'); // dropped
        vi.advanceTimersByTime(100);
        phone.full = false;
        // Another tab, which never saw 002, adds 003.
        const other = JSON.parse(phone.disk!) as { v: number; data: Item[]; gen: number };
        const added = { ...other.data[0], key: 'ja:SV8a-003:normal', id: 'SV8a-003', localId: '003', addedAt: new Date().toISOString() };
        phone.setItem('cc:collection', JSON.stringify({ v: 1, data: [added, ...other.data], gen: other.gen + 1 }));
        win.dispatchEvent(Object.assign(new Event('storage'), { key: 'cc:collection' }));
        expect(keys(store.exportCollection())).toContain('ja:SV8a-002:normal'); // not dropped from the screen
        settle();
        expect(keys(onDisk()).sort()).toEqual(['ja:SV8a-001:normal', 'ja:SV8a-002:normal', 'ja:SV8a-003:normal']);
        expect(store.getCollectionSaveState().saved).toBe(true);
      });
    });
  });

  describe('the IndexedDB copy', () => {
    let copy: unknown;
    /** The next this many reads fail (Safari: "Connection to Indexed Database server lost"). */
    let readFails = 0;
    let writeFails = false;
    let mirror: typeof import('./mirror');
    const backend = {
      read: async () => {
        if (readFails > 0) {
          readFails--;
          throw new Error('Connection to Indexed Database server lost');
        }
        return copy;
      },
      write: async (v: unknown) => {
        if (writeFails) throw new Error('disk full');
        copy = v;
      },
    };
    const copied = () => (copy as { data: Item[] }).data;
    /** A launch: the app reads My Cards, then checks the copy (as it does right after the first render). */
    async function launch(): Promise<number> {
      mirror = await import('./mirror');
      mirror.setMirrorBackend(backend);
      peek(store.useCollection);
      return store.restoreFromMirror();
    }
    async function relaunch(): Promise<number> {
      await reload();
      return launch();
    }
    beforeEach(async () => {
      copy = undefined;
      readFails = 0;
      writeFails = false;
      await launch();
    });

    it('puts back cards localStorage lost, and counts the copies', async () => {
      add('SV8a-001');
      add('SV8a-001');
      add('SV8a-002');
      await mirror.flushMirror();
      ls.removeItem('cc:collection'); // localStorage lost My Cards while the app was closed
      await reload();
      const told = vi.fn();
      store.onCollectionRestored(told);
      expect(await launch()).toBe(3); // 2 + 1, like the My Cards count
      expect(told).toHaveBeenCalledWith(3);
      expect(keys(saved())).toEqual(['ja:SV8a-002:normal', 'ja:SV8a-001:normal']);
      expect(saved().map((i) => i.qty)).toEqual([1, 2]);
      expect(keys(peek(store.useCollection))).toEqual(keys(saved()));
    });

    it('an older copy brings nothing back: newer changes stay', async () => {
      add('SV8a-001');
      await mirror.flushMirror();
      add('SV8a-001'); // two copies now, saved in localStorage only
      add('SV8a-002');
      expect(await relaunch()).toBe(0);
      expect(saved().find((i) => i.key === 'ja:SV8a-001:normal')?.qty).toBe(2);
    });

    it('a removed card does not come back, even when the copy could not be updated', async () => {
      const key = add('SV8a-001');
      add('SV8a-002');
      await mirror.flushMirror();
      writeFails = true;
      store.removeFromCollection(key);
      await mirror.flushMirror();
      writeFails = false;
      expect(copied()).toHaveLength(2); // the copy still has the removed card
      expect(await relaunch()).toBe(0);
      expect(keys(saved())).toEqual(['ja:SV8a-002:normal']);
    });

    it('a reset empties the copy too', async () => {
      add('SV8a-001');
      await mirror.flushMirror();
      store.resetAllData();
      await Promise.resolve();
      expect(copied()).toEqual([]);
      expect(await relaunch()).toBe(0);
      expect(saved()).toEqual([]);
    });

    it('a reset is not undone by a copy that could not be emptied', async () => {
      add('SV8a-001');
      add('SV8a-002');
      await mirror.flushMirror();
      writeFails = true;
      store.resetAllData();
      await Promise.resolve();
      writeFails = false;
      expect(copied()).toHaveLength(2);
      expect(await relaunch()).toBe(0);
      expect(saved()).toEqual([]);
    });

    it('a copy that could not be read is left alone, and brings the cards back at a later launch', async () => {
      add('SV8a-001');
      add('SV8a-002');
      await mirror.flushMirror();
      ls.removeItem('cc:collection'); // lost while the app was closed…
      await reload();
      readFails = 1; // …and the copy can't be read at this launch
      expect(await launch()).toBe(0);
      add('SV8a-003');
      await mirror.flushMirror();
      expect(keys(copied())).toEqual(['ja:SV8a-002:normal', 'ja:SV8a-001:normal']); // not written over
      expect(await relaunch()).toBe(2);
      expect(keys(saved())).toEqual(['ja:SV8a-003:normal', 'ja:SV8a-002:normal', 'ja:SV8a-001:normal']);
    });

    it('brings back a save Safari dropped before the app could read it back', async () => {
      const storage = new SilentStorage();
      await freshStore(storage);
      await launch();
      add('SV8a-001');
      storage.silent = true;
      add('SV8a-002'); // localStorage quietly keeps the old list; the copy gets the new one
      await mirror.flushMirror();
      storage.silent = false;
      expect(keys(saved())).toEqual(['ja:SV8a-001:normal']);
      expect(await relaunch()).toBe(1);
      expect(keys(saved()).sort()).toEqual(['ja:SV8a-001:normal', 'ja:SV8a-002:normal']);
    });

    it('starts the copy for cards saved before it existed', async () => {
      add('SV8a-001');
      copy = undefined; // an app version without the copy saved this card
      expect(await relaunch()).toBe(0);
      await mirror.flushMirror();
      expect(keys(copied())).toEqual(['ja:SV8a-001:normal']);
    });

    it('a copy from before the save counter still fills in a lost list', async () => {
      add('SV8a-001');
      await mirror.flushMirror();
      copy = { v: 1, at: '2026-11-01T00:00:00.000Z', data: copied() }; // no `gen`
      ls.removeItem('cc:collection');
      expect(await relaunch()).toBe(1);
    });

    it('a copy that could not be read brings its cards back even after many saves at that launch', async () => {
      add('SV8a-001');
      add('SV8a-002');
      await mirror.flushMirror(); // the copy's counter: 2
      ls.removeItem('cc:collection'); // lost while the app was closed…
      await reload();
      readFails = 1; // …and the copy can't be read at this launch
      expect(await launch()).toBe(0);
      add('SV8a-003');
      add('SV8a-004');
      add('SV8a-005'); // counted up past the copy's counter
      await mirror.flushMirror();
      expect(keys(copied())).toEqual(['ja:SV8a-002:normal', 'ja:SV8a-001:normal']); // not written over
      expect(await relaunch()).toBe(2);
      expect(keys(saved()).sort()).toEqual(['001', '002', '003', '004', '005'].map((n) => `ja:SV8a-${n}:normal`));
    });

    it('a card removed while the copy could not be read does not come back from it later', async () => {
      const key = add('SV8a-001');
      add('SV8a-002');
      await mirror.flushMirror();
      await reload();
      readFails = 1;
      expect(await launch()).toBe(0);
      store.removeFromCollection(key);
      expect(await relaunch()).toBe(0);
      expect(keys(saved())).toEqual(['ja:SV8a-002:normal']);
    });

    it('a reset is not undone by an old copy that could neither be read nor emptied', async () => {
      add('SV8a-001');
      add('SV8a-002');
      await mirror.flushMirror();
      ls.removeItem('cc:collection');
      await reload();
      readFails = 1;
      expect(await launch()).toBe(0); // this page never learns the copy's counter
      writeFails = true;
      store.resetAllData();
      await Promise.resolve();
      writeFails = false;
      expect(copied()).toHaveLength(2);
      expect(await relaunch()).toBe(0);
      expect(saved()).toEqual([]);
    });

    it('reads the copy again after a save when it could not be read at startup, and keeps it up to date', async () => {
      add('SV8a-001');
      await mirror.flushMirror();
      vi.stubGlobal('window', new EventTarget()); // a page in a browser: it reads the copy by itself after the first render
      await reload();
      readFails = 2; // this launch's read, and the one the page starts by itself
      expect(await launch()).toBe(0);
      await new Promise((r) => setTimeout(r, 0));
      add('SV8a-002'); // reads the copy again (it works now)
      await new Promise((r) => setTimeout(r, 0));
      await mirror.flushMirror();
      expect(keys(copied())).toEqual(['ja:SV8a-002:normal', 'ja:SV8a-001:normal']);
      vi.unstubAllGlobals();
    });

    it("shows the copy's cards (not saved) when the stored list can't be read, and never writes over it", async () => {
      add('SV8a-001');
      add('SV8a-002');
      await mirror.flushMirror();
      const broken = '{"v":1,"data":[{"broken":tr';
      ls.setItem('cc:collection', broken);
      await reload();
      const failed = vi.fn();
      store.onCollectionSaveFailed(failed);
      expect(await launch()).toBe(2);
      expect(keys(peek(store.useCollection)).sort()).toEqual(['ja:SV8a-001:normal', 'ja:SV8a-002:normal']);
      expect(store.getCollectionSaveState()).toMatchObject({ saved: false, problem: 'unknown' });
      expect(failed).toHaveBeenCalled();
      add('SV8a-003');
      expect(ls.getItem('cc:collection')).toBe(broken);
    });
  });

  describe('two tabs', () => {
    /** Another page of the app on the same storage: its own store module and window (it hears storage events). */
    async function openPage() {
      const win = new EventTarget();
      vi.stubGlobal('window', win);
      vi.resetModules();
      const page = await import('./store');
      page.exportCollection(); // first render
      return { page, win };
    }
    /** The storage event another page's save fires in this one. */
    const tell = (win: EventTarget) => win.dispatchEvent(Object.assign(new Event('storage'), { key: 'cc:collection' }));
    const addOn = (page: typeof store, id: string) => page.addToCollection(card(id, [variant('normal', 1)]), 'normal');
    const collectionWrites = () => {
      let n = 0;
      const set = ls.setItem.bind(ls);
      vi.spyOn(ls, 'setItem').mockImplementation((k, v) => {
        if (k === 'cc:collection') n++;
        set(k, v);
      });
      return () => n;
    };
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.unstubAllGlobals());

    it('a card removed in another tab while this page reads its own save back stays removed', async () => {
      const a = await openPage();
      addOn(a.page, 'SV8a-001');
      addOn(a.page, 'SV8a-002');
      vi.advanceTimersByTime(3000);
      const b = await openPage();
      addOn(a.page, 'SV8a-003'); // A reads it back 1.5 s later
      tell(b.win);
      vi.advanceTimersByTime(500);
      b.page.removeFromCollection('ja:SV8a-001:normal');
      tell(a.win);
      vi.advanceTimersByTime(5000);
      expect(keys(saved()).sort()).toEqual(['ja:SV8a-002:normal', 'ja:SV8a-003:normal']);
      expect(keys(a.page.exportCollection()).sort()).toEqual(['ja:SV8a-002:normal', 'ja:SV8a-003:normal']);
    });

    it('Reset all data in another tab sticks, even right after this page saved', async () => {
      const a = await openPage();
      addOn(a.page, 'SV8a-001');
      vi.advanceTimersByTime(3000);
      const b = await openPage();
      addOn(a.page, 'SV8a-002');
      tell(b.win);
      vi.advanceTimersByTime(300);
      b.page.resetAllData();
      tell(a.win);
      vi.advanceTimersByTime(5000);
      expect(saved()).toEqual([]);
      expect(a.page.exportCollection()).toEqual([]);
    });

    it("another tab's save that never saw this page's last change: both changes stay, in one more write", async () => {
      const a = await openPage();
      addOn(a.page, 'SV8a-001');
      addOn(a.page, 'SV8a-002');
      vi.advanceTimersByTime(3000);
      const before = JSON.parse(ls.getItem('cc:collection')!) as { v: number; data: Item[]; gen: number };
      addOn(a.page, 'SV8a-003');
      const writes = collectionWrites();
      // Another tab, which never saw 003, removes 001 (its save counts up from the list it read).
      const theirs = before.data.filter((i) => i.localId !== '001');
      ls.setItem('cc:collection', JSON.stringify({ v: 1, data: theirs, gen: before.gen + 1 }));
      tell(a.win);
      vi.advanceTimersByTime(5000);
      expect(keys(saved()).sort()).toEqual(['ja:SV8a-002:normal', 'ja:SV8a-003:normal']);
      expect(writes()).toBe(2); // theirs, then this page's change on top
    });

    it('two tabs adding a card each: both stay, and the pages settle without writing back and forth', async () => {
      const a = await openPage();
      addOn(a.page, 'SV8a-001');
      vi.advanceTimersByTime(3000);
      const b = await openPage();
      const writes = collectionWrites();
      addOn(a.page, 'SV8a-002');
      addOn(b.page, 'SV8a-003');
      tell(b.win);
      tell(a.win);
      vi.advanceTimersByTime(10_000);
      expect(keys(saved()).sort()).toEqual(['ja:SV8a-001:normal', 'ja:SV8a-002:normal', 'ja:SV8a-003:normal']);
      expect(keys(a.page.exportCollection()).sort()).toEqual(keys(saved()).sort());
      expect(writes()).toBe(2);
    });
  });
});

describe('collection backups', () => {
  type Item = import('./types').CollectionItem;
  const saved = () => JSON.parse(ls.getItem('cc:collection')!).data as Item[];

  it('exports what My Cards shows', () => {
    store.addToCollection(card(), 'normal');
    expect(store.exportCollection().map((i) => i.key)).toEqual(['ja:SV8a-084:normal']);
  });

  it('merges a backup by card: new cards added, the same card merged, nothing removed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
    store.addToCollection(card('SV8a-001', [variant('normal', 1)]), 'normal');
    const theirs = store.exportCollection()[0];
    vi.setSystemTime(new Date('2026-11-05T00:00:00Z'));
    store.resetAllData();
    store.addToCollection(card('SV8a-001', [variant('normal', 2)]), 'normal'); // added later here, with a newer price
    store.addToCollection(card('SV8a-002', [variant('normal', 3)]), 'normal');

    const other: Item = { ...theirs, key: 'ja:SV8a-003:normal', id: 'SV8a-003', localId: '003' };
    const result = store.importCollection([{ ...theirs, qty: 4 }, other, { key: 'broken' }, null]);
    expect(result).toEqual({ added: 1, updated: 1, skipped: 2, saved: true });

    const byKey = Object.fromEntries(saved().map((i) => [i.key, i]));
    expect(Object.keys(byKey).sort()).toEqual(['ja:SV8a-001:normal', 'ja:SV8a-002:normal', 'ja:SV8a-003:normal']);
    // The larger count, the earlier "added" with its first price, the newer price.
    expect(byKey['ja:SV8a-001:normal']).toMatchObject({ qty: 4, addedAt: '2026-11-01T00:00:00.000Z', firstPriceUsd: 1, priceUsd: 2 });
    expect(byKey['ja:SV8a-002:normal'].qty).toBe(1);
  });

  it('importing the same backup twice changes nothing the second time', () => {
    store.addToCollection(card(), 'normal');
    const backup = store.exportCollection();
    store.resetAllData();
    expect(store.importCollection(backup)).toMatchObject({ added: 1, updated: 0 });
    expect(store.importCollection(backup)).toMatchObject({ added: 0, updated: 0, saved: true });
  });

  it('rebuilds a key that does not match its card and caps the count', () => {
    store.addToCollection(card(), 'normal');
    const item = store.exportCollection()[0];
    store.resetAllData();
    store.importCollection([{ ...item, key: 'whatever', qty: 5000.7 }]);
    expect(saved()[0]).toMatchObject({ key: 'ja:SV8a-084:normal', qty: 999 });
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

  it('remembers which printing the price is for', async () => {
    store.pushHistory(card('SV8a-001'), 0.18);
    store.pushHistory(card('SV8a-084'), 0.18, false, 'normal');
    store.pushHistory(card('SV8a-084'), 2.27, false, 'reverse-masterball'); // the kid picked another printing: same entry
    const items = () => JSON.parse(ls.getItem('cc:history')!).data as import('./types').HistoryItem[];
    expect(items().map((h) => [h.id, h.priceUsd, h.variant])).toEqual([
      ['SV8a-084', 2.27, 'reverse-masterball'],
      ['SV8a-001', 0.18, undefined],
    ]);
    expect(items()[1]).not.toHaveProperty('variant');
    // Survives a restart; an entry with a broken variant is dropped like any malformed one.
    ls.setItem('cc:history', JSON.stringify({ v: 1, data: [...items(), { ...items()[0], id: 'SV8a-002', variant: 7 }] }));
    await reload();
    expect(peek(store.useHistory).map((h) => [h.id, h.variant])).toEqual([
      ['SV8a-084', 'reverse-masterball'],
      ['SV8a-001', undefined],
    ]);
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
