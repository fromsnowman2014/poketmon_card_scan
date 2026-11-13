// App state persisted to localStorage: settings, My Cards, recently viewed, daily value snapshots.
// Each key holds a versioned envelope { v, data }; anything unreadable falls back to defaults.
// Every change re-reads what storage holds right before writing (another tab, or a value read at startup that was
// wrong), and My Cards never loses a card by being written: see the My Cards section.
import { useSyncExternalStore } from 'react';
import { clearCache, writeWithRoom } from './cache';
import { flushMirror, readMirror, saveMirror } from './mirror';
import { isApproxPrice } from './pricing';
import { COUNTRIES, countryDefaults, guessCountry } from './region';
import type {
  CardBrief,
  CardDetail,
  CardLang,
  CollectionItem,
  Country,
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
const optBool = (x: unknown): x is boolean | undefined => x === undefined || typeof x === 'boolean';

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

type ReadResult =
  /** `data` is undefined (and `raw` null) when nothing is stored. */
  | { state: 'ok'; raw: string | null; data: unknown }
  /** No storage, or it refused access. */
  | { state: 'blocked' }
  /** Something this version can't read: corrupt, or written by a newer app. */
  | { state: 'foreign'; raw: string };

function readEnvelope(key: string): ReadResult {
  const s = storage();
  if (!s) return { state: 'blocked' };
  let raw: string | null;
  try {
    raw = s.getItem(key);
  } catch {
    return { state: 'blocked' };
  }
  if (!raw) return { state: 'ok', raw: null, data: undefined };
  try {
    const envelope: unknown = JSON.parse(raw);
    if (isObj(envelope) && envelope.v === VERSION) return { state: 'ok', raw, data: envelope.data };
  } catch {
    // corrupt: like a value from a newer app
  }
  return { state: 'foreign', raw };
}

function readKey(key: string): unknown {
  const r = readEnvelope(key);
  return r.state === 'ok' ? r.data : undefined;
}

/** Why a change could not be saved: storage blocked (e.g. Safari's "Block All Cookies"), full, or something else. */
export type SaveProblem = 'blocked' | 'full' | 'unknown';

type WriteResult = { ok: true; raw: string } | { ok: false; problem: SaveProblem };

function errorName(e: unknown): string {
  return typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '';
}

const isQuotaError = (e: unknown) =>
  ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'].includes(errorName(e)) ||
  (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 22);

/**
 * Saves `data` under `key`. When storage is full, cached API data is dropped first (cache.ts can always fetch it
 * again, the kid's cards cannot be fetched again).
 */
function writeEnvelope(key: string, data: unknown): WriteResult {
  const s = storage();
  if (!s) return { ok: false, problem: 'blocked' };
  let raw: string;
  try {
    raw = JSON.stringify({ v: VERSION, data });
  } catch {
    return { ok: false, problem: 'unknown' };
  }
  let error: unknown;
  const ok = writeWithRoom(() => {
    try {
      s.setItem(key, raw);
    } catch (e) {
      error = e;
      throw e;
    }
  });
  if (ok) return { ok: true, raw };
  if (isQuotaError(error)) return { ok: false, problem: 'full' };
  return { ok: false, problem: errorName(error) === 'SecurityError' ? 'blocked' : 'unknown' };
}

/** False when the value could not be saved (blocked storage, or full even after dropping cached API data). */
function writeKey(key: string, data: unknown): boolean {
  return writeEnvelope(key, data).ok;
}

interface Persisted<T> {
  get(): T;
  /** Replaces the value (memory + listeners); returns whether localStorage accepted it. */
  set(next: T): boolean;
  /**
   * Applies `fn` to what storage holds right now (another tab may have changed it since this one read it) and saves
   * the result. Nothing is written when `fn` returns its argument. Returns whether the result is saved.
   */
  update(fn: (current: T) => T): boolean;
  subscribe(listener: () => void): () => void;
}

/** A lazily loaded, persisted value. `load` turns whatever was stored (or undefined) into a valid T. */
function persisted<T>(key: string, load: (raw: unknown) => T): Persisted<T> {
  let value: T | undefined;
  /** The stored string `value` came from or was saved as (null: nothing stored); undefined while unknown. */
  let seen: string | null | undefined;
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

  /**
   * What storage holds now, loaded. Undefined when it can't be read, and when it suddenly holds nothing although a
   * value was stored before: that is a storage hiccup, not a change (clearing goes through set()).
   */
  const fresh = (): { value: T; raw: string | null } | undefined => {
    const r = readEnvelope(key);
    if (r.state === 'blocked' || (r.state === 'ok' && r.raw === null && seen)) return undefined;
    return { value: load(r.state === 'ok' ? r.data : undefined), raw: r.raw };
  };

  const self: Persisted<T> = {
    get() {
      if (value === undefined) {
        const r = readEnvelope(key);
        value = load(r.state === 'ok' ? r.data : undefined);
        seen = r.state === 'blocked' ? undefined : r.raw;
      }
      return value;
    },
    set(next) {
      value = next;
      const w = writeEnvelope(key, next);
      if (w.ok) seen = w.raw;
      notify();
      return w.ok;
    },
    update(fn) {
      const now = fresh();
      const base = now ? now.value : self.get();
      const next = fn(base);
      if (next !== base) return self.set(next);
      if (now && value !== base) {
        value = base;
        seen = now.raw;
        notify();
      }
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return self;
}

function useStore<T>(store: Pick<Persisted<T>, 'get' | 'subscribe'>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

// ---------- Settings ----------

/**
 * The UI language follows the phone's language; the money and the card search language follow where the kid lives
 * (region.guessCountry: time zone, then language region). A Korean phone in Seoul starts with 한국어 + 원, an English
 * phone in the US with English + dollars, a Korean-speaking kid in the US with 한국어 + dollars.
 */
function defaultSettings(): Settings {
  const nav = typeof navigator !== 'undefined' ? navigator.language ?? '' : '';
  const uiLang: UiLang = nav.toLowerCase().startsWith('ko') ? 'ko' : 'en';
  const country = guessCountry().country;
  return { uiLang, country, ...countryDefaults(country), ebayWorkerUrl: '', theme: 'system' };
}

/**
 * What the app saved before `country` existed when nobody picked the money or search language: both followed the
 * phone's language (Korean phone → won + 日本語 search, others → dollars + English), and the whole settings object was
 * saved whenever any setting changed, so a saved value equal to this default says nothing about the kid.
 */
function legacyDefaults(): Pick<Settings, 'currency' | 'searchLang'> {
  const nav = typeof navigator !== 'undefined' ? navigator.language ?? '' : '';
  return nav.toLowerCase().startsWith('ko') ? { currency: 'KRW', searchLang: 'ja' } : { currency: 'USD', searchLang: 'en' };
}

/**
 * Valid fields of `raw`, others from `d`. Settings saved before `country` existed get the detected country; their saved
 * money and search language are kept only when they differ from what the old app saved by default (a real pick).
 */
function loadSettings(raw: unknown, d: Settings = defaultSettings()): Settings {
  const r = isObj(raw) ? { ...raw } : {};
  if (!('country' in r)) {
    const legacy = legacyDefaults();
    if (r.currency === legacy.currency) delete r.currency;
    if (r.searchLang === legacy.searchLang) delete r.searchLang;
  }
  return {
    uiLang: oneOf(r.uiLang, ['ko', 'en'], d.uiLang),
    country: oneOf(r.country, COUNTRIES, d.country),
    currency: oneOf(r.currency, ['USD', 'KRW'], d.currency),
    searchLang: oneOf(r.searchLang, LANGS, d.searchLang),
    ebayWorkerUrl: isStr(r.ebayWorkerUrl) ? r.ebayWorkerUrl.trim() : d.ebayWorkerUrl,
    theme: oneOf(r.theme, ['system', 'dark', 'light'], d.theme),
  };
}

const SETTINGS_KEY = 'cc:settings';
const COUNTRY_ASKED_KEY = 'cc:country-asked';

/**
 * The first guess is saved right away, so the country means where the kid was when the app first opened: a Seoul kid
 * on holiday in Hawaii keeps seeing won. Settings (or the first-launch question) is the way to change it. A confident
 * guess also counts as the country question answered, so it isn't asked abroad either. Best effort and never in the
 * way: no cached data is dropped to make room during a render, and a saved value this version can't read (corrupt,
 * or from a newer app) is left alone.
 */
function saveFirstGuess(raw: unknown, loaded: Settings): void {
  if (isObj(raw) ? COUNTRIES.includes(raw.country as Country) : raw !== undefined) return;
  try {
    const s = storage();
    if (!s || (raw === undefined && s.getItem(SETTINGS_KEY) !== null)) return;
    s.setItem(SETTINGS_KEY, JSON.stringify({ v: VERSION, data: loaded }));
    if (guessCountry().confident) s.setItem(COUNTRY_ASKED_KEY, JSON.stringify({ v: VERSION, data: true }));
  } catch {
    // full or blocked storage: the guess is made again next launch
  }
}

const settings = persisted(SETTINGS_KEY, (raw) => {
  const loaded = loadSettings(raw);
  saveFirstGuess(raw, loaded);
  return loaded;
});

export function useSettings(): Settings {
  return useStore(settings);
}

/**
 * Changing `country` also switches the money and the search language to that country's defaults, unless the same
 * patch sets them. Picking a country (here or in the first-launch question) counts as answering that question.
 */
export function updateSettings(patch: Partial<Settings>): void {
  settings.update((current) => {
    const moved = patch.country !== undefined && patch.country !== current.country && COUNTRIES.includes(patch.country);
    const next = moved ? { ...current, ...countryDefaults(patch.country!), ...patch } : { ...current, ...patch };
    return loadSettings(next, current);
  });
  if (patch.country !== undefined) markCountryAsked();
}

// ---------- First-launch country question ----------

/**
 * True when the app should ask "Where do you live? 🇺🇸 / 🇰🇷" once: the phone gave no US/Korea time zone or
 * language region (region.guessCountry was not confident), nobody picked a country yet, and the saved first guess
 * wasn't a confident one (saveFirstGuess).
 */
export function needsCountryPrompt(): boolean {
  return readKey(COUNTRY_ASKED_KEY) !== true && !guessCountry().confident;
}

/** Remembers that the country question was answered (or dismissed: the guess is kept and can be changed in Settings). */
export function markCountryAsked(): void {
  writeKey(COUNTRY_ASKED_KEY, true);
}

// ---------- My Cards ----------
// The kid's cards can't be fetched again, so:
// - every change starts from what storage holds right now, plus the cards this page has and storage lacks (a change
//   not saved yet, or a card storage lost); a card only goes away through removeFromCollection;
// - stored entries this version can't read are kept and written back untouched, and storage holding something this
//   version doesn't understand (a newer app) is never written over;
// - a save is read back a moment later (Safari can drop a write without telling the page);
// - photos give way to cards when storage is full;
// - a copy lives in IndexedDB (mirror.ts) and puts back cards localStorage lost;
// - when a change could not be saved, useCollectionSaveState says so until it is (the screens show it).
// What no code can fix: iOS keeps a separate storage area for each Home Screen icon, Safari, each Private tab and
// each app's built-in browser (docs/INSTALL.md). Backups move cards between them (importCollection).

export function isCollectionItem(x: unknown): x is CollectionItem {
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
    optBool(x.priceApprox) &&
    isPrice(x.firstPriceUsd) &&
    isStr(x.priceUpdatedAt) &&
    isStr(x.addedAt) &&
    isDexIds(x.dexIds) &&
    optStr(x.imageFallback)
  );
}

const COLLECTION_KEY = 'cc:collection';

/** Whether everything My Cards shows is saved (see useCollectionSaveState). */
export interface CollectionSaveState {
  /** False while a change to My Cards lives only in memory: it is lost when the app closes. */
  saved: boolean;
  /** Why the last save failed (when not saved). */
  problem?: SaveProblem;
  /** When My Cards was last written in this session, ISO. */
  lastSavedAt?: string;
}

let saveState: CollectionSaveState = { saved: true };
const saveStateListeners = new Set<() => void>();
const saveFailedListeners = new Set<() => void>();
const restoredListeners = new Set<(count: number) => void>();

function setSaveState(next: CollectionSaveState): void {
  if (next.saved === saveState.saved && next.problem === saveState.problem && next.lastSavedAt === saveState.lastSavedAt) return;
  saveState = next;
  saveStateListeners.forEach((l) => l());
}

function markSaved(at: string | undefined): void {
  setSaveState(at ? { saved: true, lastSavedAt: at } : { saved: true });
}

function saveFailed(problem: SaveProblem): void {
  setSaveState(saveState.lastSavedAt ? { saved: false, problem, lastSavedAt: saveState.lastSavedAt } : { saved: false, problem });
  saveFailedListeners.forEach((l) => l());
}

interface StoredCollection {
  state: 'ok' | 'blocked' | 'foreign';
  items: CollectionItem[];
  /** Stored entries this version can't read. */
  extras: unknown[];
  /** The stored string (null: nothing stored). */
  raw: string | null;
}

function readCollection(): StoredCollection {
  const r = readEnvelope(COLLECTION_KEY);
  if (r.state === 'blocked') return { state: 'blocked', items: [], extras: [], raw: null };
  if (r.state === 'foreign' || (r.data !== undefined && !Array.isArray(r.data))) {
    return { state: 'foreign', items: [], extras: [], raw: r.raw };
  }
  const items: CollectionItem[] = [];
  const extras: unknown[] = [];
  for (const x of (r.data as unknown[] | undefined) ?? []) (isCollectionItem(x) ? items : extras).push(x);
  return { state: 'ok', items, extras, raw: r.raw };
}

/** Newest first, by when each card was first added (the order addToCollection keeps). */
const newestFirst = (items: CollectionItem[]) =>
  [...items].sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0));

/** `stored` plus the cards `memory` has and `stored` lacks; `stored` itself when there are none. */
function union(stored: CollectionItem[], memory: readonly CollectionItem[] | undefined): CollectionItem[] {
  if (!memory?.length) return stored;
  const have = new Set(stored.map((i) => i.key));
  const missing = memory.filter((i) => !have.has(i.key));
  return missing.length ? newestFirst([...stored, ...missing]) : stored;
}

/** How long after a save it is read back. */
const VERIFY_AFTER_MS = 1500;

const collection = (() => {
  let value: CollectionItem[] | undefined;
  let extras: unknown[] = [];
  /** The stored string as last read or written. */
  let seen: string | null | undefined;
  let verifyTimer: ReturnType<typeof setTimeout> | undefined;
  let restoreStarted = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  /**
   * Reads a save back a moment later. Safari's setItem returns before its storage process has written the value,
   * and when that write fails (a full phone) Safari quietly goes back to the old value. One more try, then the
   * failure shows.
   */
  function verifyLater(raw: string, retried = false): void {
    const s = storage();
    if (!s) return;
    if (verifyTimer !== undefined) clearTimeout(verifyTimer);
    verifyTimer = setTimeout(() => {
      verifyTimer = undefined;
      if (seen !== raw) return; // saved again (or by another tab) since: that value is the one that counts
      let now: string | null = null;
      try {
        now = s.getItem(COLLECTION_KEY);
      } catch {
        // blocked now: counts as not saved
      }
      if (now === raw) return;
      if (!retried) {
        try {
          s.setItem(COLLECTION_KEY, raw);
          verifyLater(raw, true);
          return;
        } catch {
          // full or blocked: report below
        }
      }
      saveFailed('unknown');
    }, VERIFY_AFTER_MS);
  }

  /** Writes `next` (plus the entries this version can't read). `shrunk`: a card went away, so the copy is written now. */
  function write(next: CollectionItem[], shrunk: boolean): boolean {
    const data = [...next, ...extras];
    let w = writeEnvelope(COLLECTION_KEY, data);
    // Photos give way to cards: drop the older ones and try again.
    while (!w.ok && w.problem === 'full' && freeThumbSpace()) w = writeEnvelope(COLLECTION_KEY, data);
    if (!w.ok) {
      saveFailed(w.problem);
      return false;
    }
    seen = w.raw;
    markSaved(new Date().toISOString());
    saveMirror(data);
    // A removed card must not come back from an older copy if the app is closed right away.
    if (shrunk) void flushMirror();
    verifyLater(w.raw);
    return true;
  }

  function get(): CollectionItem[] {
    if (value === undefined) {
      const r = readCollection();
      value = r.items;
      if (r.state === 'ok') {
        extras = r.extras;
        seen = r.raw;
      }
      if (!restoreStarted && typeof window !== 'undefined') {
        restoreStarted = true;
        // After the first render, off the startup path.
        setTimeout(() => void restoreFromMirror(), 0);
      }
    }
    return value;
  }

  /**
   * Applies `op` to what storage holds now plus the cards only this page has, and saves the result. Storage that
   * can't be read, or holds something this version doesn't understand, is never written over. `force` writes even
   * when nothing changed (trying a failed save again).
   */
  function mutate(op: (items: CollectionItem[]) => CollectionItem[], force = false): boolean {
    const r = readCollection();
    // Storage that suddenly holds nothing although cards were stored before is a hiccup: keep what memory knows.
    const lost = r.state === 'ok' && r.raw === null && !!seen;
    if (r.state === 'ok' && !lost) extras = r.extras;
    // Storage still holds what this page last read or wrote: memory is the same list (plus any card not saved yet).
    const same = r.state === 'ok' && r.raw === seen && value !== undefined;
    const base = r.state !== 'ok' ? (value ?? []) : same ? value! : union(r.items, value);
    const next = op(base);
    const before = value?.length ?? r.items.length;
    if (r.state !== 'ok') {
      value = next;
      if (next !== base || force) saveFailed(r.state === 'blocked' ? 'blocked' : 'unknown');
      if (next !== base) notify();
      return false;
    }
    if (!force && !lost && next === base && (same ? saveState.saved : next === r.items)) {
      // Nothing to write: storage already holds exactly this.
      if (!same) {
        value = next;
        seen = r.raw;
        notify();
      }
      if (!saveState.saved) markSaved(saveState.lastSavedAt);
      return true;
    }
    value = next;
    const saved = write(next, next.length < before);
    notify();
    return saved;
  }

  /** Replaces everything (Reset all data). */
  function set(next: CollectionItem[]): boolean {
    extras = [];
    value = next;
    const saved = write(next, true);
    notify();
    return saved;
  }

  /** Back in the foreground: show what another tab saved meanwhile. Only adds and updates; never drops a card. */
  function refresh(): void {
    if (value === undefined) return;
    const r = readCollection();
    if (r.state !== 'ok' || r.raw === seen || (r.raw === null && seen)) return;
    extras = r.extras;
    seen = r.raw;
    value = union(r.items, value);
    notify();
  }

  /** Brings the IndexedDB copy up to date when everything shown is saved. */
  function copyToMirror(): void {
    if (value !== undefined && saveState.saved && seen !== undefined) saveMirror([...value, ...extras]);
  }

  if (typeof window !== 'undefined') {
    // Another tab saved My Cards: take its list (and keep what this one hasn't saved yet).
    window.addEventListener('storage', (e) => {
      if ((e.key !== COLLECTION_KEY && e.key !== null) || value === undefined) return;
      const r = readCollection();
      if (r.state !== 'ok') return;
      extras = r.extras;
      seen = r.raw;
      value = saveState.saved ? r.items : union(r.items, value);
      notify();
    });
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) refresh();
    });
    window.addEventListener('pagehide', () => void flushMirror());
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
      else void flushMirror();
    });
  }

  return {
    get,
    mutate,
    set,
    copyToMirror,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})();

/**
 * Puts back the cards the IndexedDB copy has and localStorage lost (mirror.ts), then brings the copy up to date.
 * Runs once, shortly after My Cards is first read. Returns how many cards came back (onCollectionRestored is told).
 */
export async function restoreFromMirror(): Promise<number> {
  const copy = await readMirror();
  const backup = (copy ?? []).filter(isCollectionItem);
  let restored = 0;
  collection.mutate((items) => {
    const have = new Set(items.map((i) => i.key));
    const missing = backup.filter((i) => !have.has(i.key));
    restored = missing.length;
    return missing.length ? newestFirst([...items, ...missing]) : items;
  });
  if (restored) restoredListeners.forEach((l) => l(restored));
  else collection.copyToMirror();
  return restored;
}

/**
 * Called whenever a change to My Cards could not be saved (it still shows until the app is closed). Show a "couldn't
 * save" toast from the UI. Returns an unsubscribe function.
 */
export function onCollectionSaveFailed(listener: () => void): () => void {
  saveFailedListeners.add(listener);
  return () => saveFailedListeners.delete(listener);
}

/** Called with the number of cards put back from the IndexedDB copy (restoreFromMirror). */
export function onCollectionRestored(listener: (count: number) => void): () => void {
  restoredListeners.add(listener);
  return () => restoredListeners.delete(listener);
}

export function getCollectionSaveState(): CollectionSaveState {
  return saveState;
}

/** Whether every card My Cards shows is saved; `saved: false` until a later save works (or retryCollectionSave). */
export function useCollectionSaveState(): CollectionSaveState {
  return useSyncExternalStore(
    (listener) => {
      saveStateListeners.add(listener);
      return () => saveStateListeners.delete(listener);
    },
    getCollectionSaveState,
    getCollectionSaveState,
  );
}

/** Tries to save My Cards again (after a failed save). Returns whether it is saved now. */
export function retryCollectionSave(): boolean {
  return collection.mutate((items) => items, true);
}

/** Stable key of a saved card: `${lang}:${id}:${variant}`. */
export function collectionKey(card: Pick<CardBrief, 'lang' | 'id'>, variantKey: string): string {
  return `${card.lang}:${card.id}:${variantKey}`;
}

/** Newest first. */
export function useCollection(): CollectionItem[] {
  return useStore(collection);
}

/** My Cards as shown now (including cards not saved yet), for backups. */
export function exportCollection(): CollectionItem[] {
  return collection.get();
}

/**
 * Asks the browser once to keep this site's storage (My Cards) when space runs low. Best effort, never throws.
 * Safari grants it to Home Screen apps; call it at startup there.
 */
let persistAsked = false;
export function askPersistentStorage(): void {
  if (persistAsked) return;
  persistAsked = true;
  try {
    void globalThis.navigator?.storage?.persist?.().catch(() => undefined);
  } catch {
    // not supported
  }
}

/** A saved exact price is kept this long before an approximate one may replace it. */
const KEEP_EXACT_MS = 7 * 86_400_000;

/**
 * `item` with a newly checked price (approx: converted from euros, or an asking price), or `item` itself when
 * nothing may change:
 * - no price → the saved one stays, and so does its time;
 * - an exact price (TCGplayer) is not replaced by an approximate one for 7 days: that is the Cardmarket stand-in
 *   after a price file failed to load, not news about the card;
 * - exact ↔ approximate is another market, not a move of the price: `rebased`, the first price starts again from
 *   the new number (the caller also drops the card from the "since last week" baselines).
 */
function withPrice(item: CollectionItem, priceUsd: number | null, approx: boolean, now: Date): { item: CollectionItem; rebased: boolean } {
  if (priceUsd === null) return { item, rebased: false };
  const switched = item.priceUsd !== null && !!item.priceApprox !== approx;
  const age = now.getTime() - Date.parse(item.priceUpdatedAt);
  if (switched && approx && age < KEEP_EXACT_MS) return { item, rebased: false };
  const firstPriceUsd = switched ? priceUsd : (item.firstPriceUsd ?? priceUsd);
  return { item: { ...item, priceUsd, priceApprox: approx, priceUpdatedAt: now.toISOString(), firstPriceUsd }, rebased: switched };
}

/**
 * Adds one copy of the card's variant (qty+1 when already saved) and returns its collection key.
 * The variant's summary.market becomes priceUsd (and firstPriceUsd for a new entry); priceApprox says whether it is
 * approximate (pricing.isApproxPrice). An already saved copy takes the new price by updateCollectionPrice's rules.
 * Whether it could be saved: getCollectionSaveState().
 */
export function addToCollection(card: CardDetail, variantKey: string): string {
  const key = collectionKey(card, variantKey);
  const summary = card.variants.find((v) => v.key === variantKey)?.summary;
  const price = summary?.market ?? null;
  const approx = price !== null && isApproxPrice(summary);
  const now = new Date().toISOString();
  askPersistentStorage();
  let rebased = false;
  collection.mutate((items) => {
    if (items.some((i) => i.key === key)) {
      return items.map((i) => {
        if (i.key !== key) return i;
        const priced = withPrice(i, price, approx, new Date(now));
        rebased = priced.rebased;
        return { ...priced.item, qty: Math.min(i.qty + 1, MAX_QTY) };
      });
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
      priceApprox: approx,
      firstPriceUsd: price,
      priceUpdatedAt: now,
      addedAt: now,
      dexIds: card.dexIds,
    };
    return [item, ...items];
  });
  if (rebased) dropFromBaselines(key);
  return key;
}

export function removeFromCollection(key: string): void {
  collection.mutate((items) => (items.some((i) => i.key === key) ? items.filter((i) => i.key !== key) : items));
  dropThumb(key);
}

/** qty ≤ 0 removes the card. */
export function setQuantity(key: string, qty: number): void {
  if (!Number.isFinite(qty) || qty < 1) {
    removeFromCollection(key);
    return;
  }
  const n = Math.min(Math.floor(qty), MAX_QTY);
  collection.mutate((items) => (items.some((i) => i.key === key && i.qty !== n) ? items.map((i) => (i.key === key ? { ...i, qty: n } : i)) : items));
}

/**
 * Stores a re-checked price (approx: converted from euros or an asking price, pricing.isApproxPrice).
 * firstPriceUsd is filled if it was null. Does nothing for a null price (the saved price and its time stay), nor
 * when an approximate price would replace an exact one saved less than 7 days ago. When the price changes between
 * exact and approximate (TCGplayer ↔ Cardmarket: two markets), the card starts over: firstPriceUsd becomes the
 * new price and the card leaves the snapshot baselines, so neither gain/loss nor "since last week" shows the
 * switch as a price move.
 */
export function updateCollectionPrice(key: string, priceUsd: number | null, approx = false): void {
  let rebased = false;
  collection.mutate((items) => {
    const saved = items.find((i) => i.key === key);
    if (!saved) return items;
    const r = withPrice(saved, priceUsd, approx, new Date());
    if (r.item === saved) return items;
    rebased = r.rebased;
    return items.map((i) => (i === saved ? r.item : i));
  });
  if (rebased) dropFromBaselines(key);
}

/** How a backup was merged into My Cards (importCollection). */
export interface ImportResult {
  /** Cards that were not in My Cards. */
  added: number;
  /** Cards already there that changed (more copies, an older "added" date, a newer price). */
  updated: number;
  /** Entries that are not valid cards. */
  skipped: number;
  /** Whether the result is saved. */
  saved: boolean;
}

/** One card saved in two places: the larger count, the earlier "added" (with its first price), the newer price. */
function mergeItem(mine: CollectionItem, other: CollectionItem): CollectionItem {
  const first = other.addedAt < mine.addedAt ? other : mine;
  const newer = other.priceUsd !== null && Date.parse(other.priceUpdatedAt) > Date.parse(mine.priceUpdatedAt) ? other : mine;
  const merged: CollectionItem = {
    ...mine,
    qty: Math.min(Math.max(mine.qty, other.qty), MAX_QTY),
    addedAt: first.addedAt,
    firstPriceUsd: first.firstPriceUsd ?? newer.firstPriceUsd,
    priceUsd: newer.priceUsd,
    priceApprox: newer.priceApprox,
    priceUpdatedAt: newer.priceUpdatedAt,
    image: mine.image ?? other.image,
    imageFallback: mine.imageFallback ?? other.imageFallback,
  };
  const same = (Object.keys(merged) as (keyof CollectionItem)[]).every((k) => merged[k] === mine[k]);
  return same ? mine : merged;
}

/**
 * Merges cards from a backup (another storage area, another phone) into My Cards by key; nothing is removed.
 * Entries that aren't valid cards are skipped; a key that doesn't match its card is rebuilt.
 */
export function importCollection(incoming: readonly unknown[]): ImportResult {
  const valid = incoming
    .filter(isCollectionItem)
    .map((i) => ({ ...i, key: collectionKey(i, i.variant), qty: Math.min(Math.floor(i.qty), MAX_QTY) }));
  let added = 0;
  let updated = 0;
  const saved = collection.mutate((items) => {
    added = updated = 0;
    const byKey = new Map(items.map((i) => [i.key, i] as const));
    for (const other of valid) {
      const mine = byKey.get(other.key);
      if (!mine) {
        byKey.set(other.key, other);
        added++;
        continue;
      }
      const merged = mergeItem(mine, other);
      if (merged !== mine) {
        byKey.set(other.key, merged);
        updated++;
      }
    }
    return added || updated ? newestFirst([...byKey.values()]) : items;
  });
  return { added, updated, skipped: incoming.length - valid.length, saved };
}

/**
 * Σ priceUsd × qty; unpriced cards count as 0. Not rounded to cents (formatMoney rounds once, for display), only to
 * 1/100 of a cent so float noise (0.1 × 3) doesn't make every snapshot look changed.
 */
export function collectionTotalUsd(items: readonly CollectionItem[]): number {
  const total = items.reduce((sum, i) => sum + (i.priceUsd ?? 0) * i.qty, 0);
  return Math.round(total * 10_000) / 10_000;
}

// ---------- Collection thumbnails (user photos) ----------
// Stored apart from the collection so a full quota can only cost photos, never saved cards.

const THUMBS_KEY = 'cc:thumbs';
/** Photos may use this many characters in total (about 60 of them), so they never crowd out My Cards. */
const THUMBS_MAX_CHARS = 1_200_000;
const thumbs = persisted<Record<string, string>>(THUMBS_KEY, (raw) => {
  if (!isObj(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => isStr(e[1])));
});

/** The newest photos within THUMBS_MAX_CHARS (oldest first in insertion order); `all` itself when they all fit. */
function capThumbs(all: Record<string, string>): Record<string, string> {
  const entries = Object.entries(all);
  let total = entries.reduce((n, [k, v]) => n + k.length + v.length, 0);
  let drop = 0;
  while (entries.length - drop > 1 && total > THUMBS_MAX_CHARS) {
    const [k, v] = entries[drop++];
    total -= k.length + v.length;
  }
  return drop ? Object.fromEntries(entries.slice(drop)) : all;
}

/** Saves a (small, already downscaled) photo data URL as the picture for a collection item. */
export function setCollectionThumb(key: string, dataUrl: string): void {
  // From memory, not storage: memory may hold photos that didn't fit (below), and they still show this session.
  const next = { ...thumbs.get() };
  delete next[key]; // re-insert so this key becomes the newest
  next[key] = dataUrl;
  if (thumbs.set(capThumbs(next))) return;
  // Out of space: persist only the newest photos that fit; memory keeps all of them for this session.
  const entries = Object.entries(thumbs.get());
  while (entries.length > 1) {
    entries.shift();
    if (writeKey(THUMBS_KEY, Object.fromEntries(entries))) return;
  }
}

/** Drops the older half of the photos (they give way to cards when storage is full); false when there are none. */
function freeThumbSpace(): boolean {
  const entries = Object.entries(thumbs.get());
  if (!entries.length) return false;
  thumbs.set(Object.fromEntries(entries.slice(Math.ceil(entries.length / 2))));
  return true;
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
    optBool(x.priceApprox) &&
    isStr(x.viewedAt) &&
    isDexIds(x.dexIds) &&
    optStr(x.imageFallback) &&
    optStr(x.variant)
  );
}

const recent = persisted('cc:history', (raw) =>
  Array.isArray(raw) ? raw.filter(isHistoryItem).slice(0, MAX_HISTORY) : [],
);

/** Newest first, max 20, one entry per card. */
export function useHistory(): HistoryItem[] {
  return useStore(recent);
}

/**
 * Remembers a viewed card (newest first, one per card); approx: priceUsd is approximate (pricing.isApproxPrice).
 * `variantKey`: the printing whose price this is, so Recent can open the card on it again.
 */
export function pushHistory(card: CardDetail, priceUsd: number | null, approx = false, variantKey?: string): void {
  const item: HistoryItem = {
    id: card.id,
    lang: card.lang,
    localId: card.localId,
    name: card.name,
    image: card.image,
    setId: card.setId,
    setName: card.setName,
    priceUsd,
    priceApprox: priceUsd !== null && approx,
    viewedAt: new Date().toISOString(),
    dexIds: card.dexIds,
    imageFallback: card.imageFallback,
    ...(variantKey ? { variant: variantKey } : {}),
  };
  recent.update((list) => [item, ...list.filter((h) => !(h.id === card.id && h.lang === card.lang))].slice(0, MAX_HISTORY));
}

export function clearHistory(): void {
  recent.set([]);
}

// ---------- Daily value snapshots ----------

type SnapshotCards = NonNullable<ValueSnapshot['cards']>;

const isSnapshotCard = (x: unknown): x is [number, number] =>
  Array.isArray(x) && x.length === 2 && isNum(x[0]) && isNum(x[1]) && x[1] >= 1;

/** A valid snapshot; a malformed `cards` map is dropped (the snapshot then only has its total). */
function toSnapshot(x: unknown): ValueSnapshot | undefined {
  if (!isObj(x) || !isStr(x.date) || !/^\d{4}-\d{2}-\d{2}$/.test(x.date) || !isNum(x.totalUsd)) return undefined;
  const cards = isObj(x.cards) && Object.values(x.cards).every(isSnapshotCard) ? (x.cards as SnapshotCards) : undefined;
  return cards ? { date: x.date, totalUsd: x.totalUsd, cards } : { date: x.date, totalUsd: x.totalUsd };
}

const snapshots = persisted('cc:snapshots', (raw) =>
  Array.isArray(raw)
    ? raw
        .map(toSnapshot)
        .filter((s): s is ValueSnapshot => !!s)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-MAX_SNAPSHOTS)
    : [],
);

function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/**
 * Per-card data is only needed where weekChange can still pick a baseline: snapshots of the last 7 days and the
 * newest one at least 7 days old (anything older is always further from "a week ago"). Older ones keep their total.
 */
function trimCards(list: ValueSnapshot[], today: string): ValueSnapshot[] {
  const now = dayNumber(today);
  let anchor = -1;
  list.forEach((s, i) => {
    if (now - dayNumber(s.date) >= 7) anchor = i;
  });
  return list.map((s, i) => (i < anchor && s.cards ? { date: s.date, totalUsd: s.totalUsd } : s));
}

function sameCards(a: SnapshotCards | undefined, b: SnapshotCards): boolean {
  if (!a) return false;
  const keys = Object.keys(b);
  return keys.length === Object.keys(a).length && keys.every((k) => a[k]?.[0] === b[k][0] && a[k]?.[1] === b[k][1]);
}

/** Takes a card out of every snapshot's per-card data: its saved prices are from another market than its new one. */
function dropFromBaselines(key: string): void {
  snapshots.update((list) =>
    list.some((s) => s.cards && key in s.cards)
      ? list.map((s) => {
          if (!s.cards || !(key in s.cards)) return s;
          const cards = { ...s.cards };
          delete cards[key];
          return { ...s, cards };
        })
      : list,
  );
}

/** Oldest first, one per local day, max 120. */
export function useSnapshots(): ValueSnapshot[] {
  return useStore(snapshots);
}

/**
 * Upserts today's snapshot of My Cards: the total plus each priced card's price and quantity, so
 * "since last week" can tell price changes from cards added or removed (no-op when unchanged).
 */
export function recordSnapshot(items: readonly CollectionItem[]): void {
  const totalUsd = collectionTotalUsd(items);
  const cards: SnapshotCards = {};
  for (const i of items) if (i.priceUsd !== null) cards[i.key] = [i.priceUsd, i.qty];
  const date = localDate();
  snapshots.update((list) => {
    const last = list[list.length - 1];
    if (last?.date === date && last.totalUsd === totalUsd && sameCards(last.cards, cards)) return list;
    const rest = last?.date === date ? list.slice(0, -1) : list;
    return trimCards([...rest, { date, totalUsd, cards }], date).slice(-MAX_SNAPSHOTS);
  });
}

// ---------- Reset ----------

/** Forgets everything: settings, My Cards (+ photos), history, snapshots and cached API data. */
export function resetAllData(): void {
  settings.set(defaultSettings());
  try {
    storage()?.removeItem(COUNTRY_ASKED_KEY);
  } catch {
    // blocked storage: keep clearing the rest
  }
  collection.set([]);
  thumbs.set({});
  recent.set([]);
  snapshots.set([]);
  scanPhotos.clear();
  clearCache();
}
