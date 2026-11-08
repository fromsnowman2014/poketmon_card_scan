// App state persisted to localStorage: settings, My Cards, recently viewed, daily value snapshots.
// Each key holds a versioned envelope { v, data }; anything unreadable falls back to defaults.
import { useSyncExternalStore } from 'react';
import { clearCache } from './cache';
import type {
  CardBrief,
  CardDetail,
  CardLang,
  CollectionItem,
  HistoryItem,
  Settings,
  UiLang,
  ValueSnapshot,
} from './types';

const VERSION = 1;
const MAX_HISTORY = 20;
const MAX_SNAPSHOTS = 120;
const MAX_QTY = 999;
const MAX_SCAN_PHOTOS = 10;
const LANGS: readonly CardLang[] = ['en', 'ja', 'ko'];

type Json = Record<string, unknown>;

const isObj = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isPrice = (x: unknown): x is number | null => x === null || isNum(x);
const isLang = (x: unknown): x is CardLang => LANGS.includes(x as CardLang);
const isDexIds = (x: unknown): x is number[] | undefined => x === undefined || (Array.isArray(x) && x.every(isNum));
const optStr = (x: unknown): x is string | undefined => x === undefined || isStr(x);

function oneOf<T extends string>(x: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(x as T) ? (x as T) : fallback;
}

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined; // access itself can throw when storage is blocked
  }
}

function readKey(key: string): unknown {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return undefined;
    const envelope: unknown = JSON.parse(raw);
    return isObj(envelope) && envelope.v === VERSION ? envelope.data : undefined;
  } catch {
    return undefined;
  }
}

/** False when the value could not be saved (quota, private mode). */
function writeKey(key: string, data: unknown): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(key, JSON.stringify({ v: VERSION, data }));
    return true;
  } catch {
    return false;
  }
}

interface Persisted<T> {
  get(): T;
  /** Updates memory + listeners; returns whether localStorage accepted it. */
  set(next: T): boolean;
  subscribe(listener: () => void): () => void;
}

/** A lazily loaded, persisted value. `load` turns whatever was stored (or undefined) into a valid T. */
function persisted<T>(key: string, load: (raw: unknown) => T): Persisted<T> {
  let value: T | undefined;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  if (typeof window !== 'undefined') {
    // Keep several open tabs/windows in sync.
    window.addEventListener('storage', (e) => {
      if (e.key !== key && e.key !== null) return;
      value = undefined;
      notify();
    });
  }

  return {
    get: () => (value ??= load(readKey(key))),
    set(next) {
      value = next;
      const saved = writeKey(key, next);
      notify();
      return saved;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function useStore<T>(store: Persisted<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

// ---------- Settings ----------

function defaultSettings(): Settings {
  const nav = typeof navigator !== 'undefined' ? navigator.language ?? '' : '';
  const uiLang: UiLang = nav.toLowerCase().startsWith('ko') ? 'ko' : 'en';
  return { uiLang, currency: 'USD', searchLang: uiLang === 'ko' ? 'ja' : 'en', ebayWorkerUrl: '', theme: 'system' };
}

/** Valid fields of `raw`, others from `d`. */
function loadSettings(raw: unknown, d: Settings = defaultSettings()): Settings {
  const r = isObj(raw) ? raw : {};
  return {
    uiLang: oneOf(r.uiLang, ['ko', 'en'], d.uiLang),
    currency: oneOf(r.currency, ['USD', 'KRW'], d.currency),
    searchLang: oneOf(r.searchLang, LANGS, d.searchLang),
    ebayWorkerUrl: isStr(r.ebayWorkerUrl) ? r.ebayWorkerUrl.trim() : d.ebayWorkerUrl,
    theme: oneOf(r.theme, ['system', 'dark', 'light'], d.theme),
  };
}

const settings = persisted('cc:settings', loadSettings);

export function useSettings(): Settings {
  return useStore(settings);
}

export function updateSettings(patch: Partial<Settings>): void {
  const current = settings.get();
  settings.set(loadSettings({ ...current, ...patch }, current));
}

// ---------- My Cards ----------

function isCollectionItem(x: unknown): x is CollectionItem {
  return (
    isObj(x) &&
    isStr(x.key) &&
    isStr(x.id) &&
    isLang(x.lang) &&
    isStr(x.name) &&
    optStr(x.image) &&
    isStr(x.setId) &&
    isStr(x.setName) &&
    isStr(x.localId) &&
    isStr(x.variant) &&
    isNum(x.qty) &&
    x.qty >= 1 &&
    isPrice(x.priceUsd) &&
    isPrice(x.firstPriceUsd) &&
    isStr(x.priceUpdatedAt) &&
    isStr(x.addedAt) &&
    isDexIds(x.dexIds) &&
    optStr(x.imageFallback)
  );
}

const collection = persisted('cc:collection', (raw) => (Array.isArray(raw) ? raw.filter(isCollectionItem) : []));

/** Stable key of a saved card: `${lang}:${id}:${variant}`. */
export function collectionKey(card: Pick<CardBrief, 'lang' | 'id'>, variantKey: string): string {
  return `${card.lang}:${card.id}:${variantKey}`;
}

/** Newest first. */
export function useCollection(): CollectionItem[] {
  return useStore(collection);
}

/**
 * Adds one copy of the card's variant (qty+1 when already saved) and returns its collection key.
 * The variant's summary.market becomes priceUsd (and firstPriceUsd for a new entry).
 */
export function addToCollection(card: CardDetail, variantKey: string): string {
  const key = collectionKey(card, variantKey);
  const price = card.variants.find((v) => v.key === variantKey)?.summary?.market ?? null;
  const now = new Date().toISOString();
  const items = collection.get();

  if (items.some((i) => i.key === key)) {
    collection.set(
      items.map((i) =>
        i.key === key
          ? { ...i, qty: Math.min(i.qty + 1, MAX_QTY), ...(price !== null && { priceUsd: price, priceUpdatedAt: now }) }
          : i,
      ),
    );
    return key;
  }

  const item: CollectionItem = {
    key,
    id: card.id,
    lang: card.lang,
    name: card.name,
    image: card.image,
    imageFallback: card.imageFallback,
    setId: card.setId,
    setName: card.setName,
    localId: card.localId,
    variant: variantKey,
    qty: 1,
    priceUsd: price,
    firstPriceUsd: price,
    priceUpdatedAt: now,
    addedAt: now,
    dexIds: card.dexIds,
  };
  collection.set([item, ...items]);
  return key;
}

export function removeFromCollection(key: string): void {
  collection.set(collection.get().filter((i) => i.key !== key));
  dropThumb(key);
}

/** qty ≤ 0 removes the card. */
export function setQuantity(key: string, qty: number): void {
  if (!Number.isFinite(qty) || qty < 1) {
    removeFromCollection(key);
    return;
  }
  const n = Math.min(Math.floor(qty), MAX_QTY);
  collection.set(collection.get().map((i) => (i.key === key ? { ...i, qty: n } : i)));
}

export function updateCollectionPrice(key: string, priceUsd: number | null): void {
  const now = new Date().toISOString();
  collection.set(
    collection
      .get()
      .map((i) =>
        i.key === key ? { ...i, priceUsd, priceUpdatedAt: now, firstPriceUsd: i.firstPriceUsd ?? priceUsd } : i,
      ),
  );
}

/** Σ priceUsd × qty, rounded to cents; unpriced cards count as 0. */
export function collectionTotalUsd(items: CollectionItem[]): number {
  const total = items.reduce((sum, i) => sum + (i.priceUsd ?? 0) * i.qty, 0);
  return Math.round(total * 100) / 100;
}

// ---------- Collection thumbnails (user photos) ----------
// Stored apart from the collection so a full quota can only cost photos, never saved cards.

const THUMBS_KEY = 'cc:thumbs';
const thumbs = persisted<Record<string, string>>(THUMBS_KEY, (raw) => {
  if (!isObj(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => isStr(e[1])));
});

/** Saves a (small, already downscaled) photo data URL as the picture for a collection item. */
export function setCollectionThumb(key: string, dataUrl: string): void {
  const next = { ...thumbs.get() };
  delete next[key]; // re-insert so this key becomes the newest
  next[key] = dataUrl;
  if (thumbs.set(next)) return;
  // Out of space: persist only the newest photos that fit; memory keeps all of them for this session.
  const entries = Object.entries(next);
  while (entries.length > 1) {
    entries.shift();
    if (writeKey(THUMBS_KEY, Object.fromEntries(entries))) return;
  }
}

function dropThumb(key: string): void {
  if (!(key in thumbs.get())) return;
  const next = { ...thumbs.get() };
  delete next[key];
  thumbs.set(next);
}

/** Map of collection key → photo data URL. */
export function useCollectionThumbs(): Readonly<Record<string, string>> {
  return useStore(thumbs);
}

// ---------- Scan photos (memory only) ----------

const scanPhotos = new Map<string, string>();

/** Remembers the photo a card was scanned from, for this session (last 10). */
export function rememberScanPhoto(cardId: string, dataUrl: string): void {
  scanPhotos.delete(cardId);
  scanPhotos.set(cardId, dataUrl);
  while (scanPhotos.size > MAX_SCAN_PHOTOS) scanPhotos.delete(scanPhotos.keys().next().value as string);
}

export function getScanPhoto(cardId: string): string | undefined {
  return scanPhotos.get(cardId);
}

// ---------- Recently viewed ----------

function isHistoryItem(x: unknown): x is HistoryItem {
  return (
    isObj(x) &&
    isStr(x.id) &&
    isLang(x.lang) &&
    isStr(x.localId) &&
    isStr(x.name) &&
    optStr(x.image) &&
    isStr(x.setId) &&
    optStr(x.setName) &&
    isPrice(x.priceUsd) &&
    isStr(x.viewedAt) &&
    isDexIds(x.dexIds) &&
    optStr(x.imageFallback)
  );
}

const recent = persisted('cc:history', (raw) =>
  Array.isArray(raw) ? raw.filter(isHistoryItem).slice(0, MAX_HISTORY) : [],
);

/** Newest first, max 20, one entry per card. */
export function useHistory(): HistoryItem[] {
  return useStore(recent);
}

export function pushHistory(card: CardDetail, priceUsd: number | null): void {
  const item: HistoryItem = {
    id: card.id,
    lang: card.lang,
    localId: card.localId,
    name: card.name,
    image: card.image,
    setId: card.setId,
    setName: card.setName,
    priceUsd,
    viewedAt: new Date().toISOString(),
    dexIds: card.dexIds,
    imageFallback: card.imageFallback,
  };
  const rest = recent.get().filter((h) => !(h.id === card.id && h.lang === card.lang));
  recent.set([item, ...rest].slice(0, MAX_HISTORY));
}

export function clearHistory(): void {
  recent.set([]);
}

// ---------- Daily value snapshots ----------

function isSnapshot(x: unknown): x is ValueSnapshot {
  return isObj(x) && isStr(x.date) && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && isNum(x.totalUsd);
}

const snapshots = persisted('cc:snapshots', (raw) =>
  Array.isArray(raw)
    ? raw
        .filter(isSnapshot)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-MAX_SNAPSHOTS)
    : [],
);

function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Oldest first, one per local day, max 120. */
export function useSnapshots(): ValueSnapshot[] {
  return useStore(snapshots);
}

/** Upserts today's snapshot (no-op when unchanged). */
export function recordSnapshot(totalUsd: number): void {
  if (!isNum(totalUsd)) return;
  const date = localDate();
  const list = snapshots.get();
  const last = list[list.length - 1];
  if (last?.date === date && last.totalUsd === totalUsd) return;
  const rest = last?.date === date ? list.slice(0, -1) : list;
  snapshots.set([...rest, { date, totalUsd }].slice(-MAX_SNAPSHOTS));
}

// ---------- Reset ----------

/** Forgets everything: settings, My Cards (+ photos), history, snapshots and cached API data. */
export function resetAllData(): void {
  settings.set(defaultSettings());
  collection.set([]);
  thumbs.set({});
  recent.set([]);
  snapshots.set([]);
  scanPhotos.clear();
  clearCache();
}
