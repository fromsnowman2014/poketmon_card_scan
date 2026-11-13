// A second copy of My Cards in IndexedDB. localStorage (store.ts) stays the main copy; this one only puts back cards
// that localStorage lost (WebKit has had bugs that leave localStorage empty for a while, e.g. bugs.webkit.org 222053,
// and it can quietly drop a write). Each copy carries the save counter (`gen`) of the localStorage list it copies, so
// store.ts only takes cards from a copy that is newer than what localStorage holds.
// It cannot help when the app is opened in another storage area (Safari tab vs Home Screen app, a Private tab, an
// in-app browser): IndexedDB lives in the same area as localStorage. Everything here is best effort and never throws.

const DB_NAME = 'cardcheck';
const STORE_NAME = 'kv';
const RECORD_KEY = 'collection';
/** Writes come in bursts (a price refresh updates card after card): only the last one of a burst is written. */
const WRITE_DELAY_MS = 500;
/** IndexedDB can hang (Safari after its storage process restarts): give up rather than wait. */
const TIMEOUT_MS = 3000;

/** Where the copy lives: IndexedDB in the browser, an in-memory stand-in in tests. */
export interface MirrorBackend {
  read(): Promise<unknown>;
  write(value: unknown): Promise<void>;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function indexedDbBackend(): MirrorBackend | null {
  let factory: IDBFactory | undefined;
  try {
    factory = typeof indexedDB === 'undefined' ? undefined : indexedDB;
  } catch {
    factory = undefined; // access itself can throw when storage is blocked
  }
  if (!factory) return null;
  const idb = factory;
  let db: Promise<IDBDatabase> | undefined;
  const open = () => {
    db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => {
        const opened = req.result;
        // Another tab upgrading, or Safari closing the connection: open again next time.
        opened.onversionchange = () => {
          opened.close();
          db = undefined;
        };
        opened.onclose = () => {
          db = undefined;
        };
        resolve(opened);
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    }).catch((e: unknown) => {
      db = undefined;
      throw e;
    });
    return db;
  };
  return {
    async read() {
      const conn = await open();
      return request(conn.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(RECORD_KEY));
    },
    async write(value) {
      const conn = await open();
      const tx = conn.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, RECORD_KEY);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
      });
    },
  };
}

let backend: MirrorBackend | null | undefined;
const getBackend = () => (backend === undefined ? (backend = indexedDbBackend()) : backend);

/** Tests: an in-memory stand-in (or null: no IndexedDB). Resets any write still waiting, and the read. */
export function setMirrorBackend(next: MirrorBackend | null | undefined): void {
  backend = next;
  pending = undefined;
  readOk = false;
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

interface MirrorRecord {
  v: 1;
  /** When it was written, ISO. */
  at: string;
  /** The stored My Cards array, exactly as localStorage has it. */
  data: unknown[];
  /** The save counter of that localStorage list (store.ts). Missing in copies written before it existed. */
  gen?: number;
}

/** A copy of My Cards: the stored array and the save counter of the localStorage list it copies. */
export interface MirrorCopy {
  data: unknown[];
  /** 0 for a copy written before the counter existed. */
  gen: number;
}

const isRecord = (x: unknown): x is MirrorRecord =>
  typeof x === 'object' && x !== null && (x as MirrorRecord).v === 1 && Array.isArray((x as MirrorRecord).data);

/** True once a read has worked this session, or the copy was emptied (see flushMirror). */
let readOk = false;

/**
 * The last copy. Null when there is none yet; undefined when it could not be read (no IndexedDB, an error, or no
 * answer within 3 s). A copy that could not be read may hold the very cards localStorage lost, so until a read has
 * worked, nothing is written over it (flushMirror waits; store.ts reads again after the next save).
 */
export async function readMirror(): Promise<MirrorCopy | null | undefined> {
  const b = getBackend();
  if (!b) return undefined;
  try {
    const value = await withTimeout(b.read(), TIMEOUT_MS);
    readOk = true;
    if (!isRecord(value)) return null;
    const gen = typeof value.gen === 'number' && Number.isFinite(value.gen) ? value.gen : 0;
    return { data: value.data, gen };
  } catch {
    return undefined;
  }
}

let pending: MirrorCopy | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

async function writeRecord(b: MirrorBackend, copy: MirrorCopy): Promise<boolean> {
  try {
    const record: MirrorRecord = { v: 1, at: new Date().toISOString(), data: copy.data, gen: copy.gen };
    await withTimeout(b.write(record), TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}

/** Writes what is waiting now (the app is being hidden or closed). Not before a read has worked (readMirror). */
export async function flushMirror(): Promise<void> {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  const b = getBackend();
  const copy = pending;
  if (!copy || !b || !readOk) return;
  pending = undefined;
  // Failed (Safari can lose its IndexedDB connection): keep it for the next try, unless a newer copy is waiting.
  if (!(await writeRecord(b, copy))) pending ??= copy;
}

/**
 * Copies the stored My Cards array with its save counter (call after every successful localStorage write). Debounced;
 * never throws.
 */
export function saveMirror(data: readonly unknown[], gen: number): void {
  if (!getBackend()) return;
  pending = { data: [...data], gen };
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => void flushMirror(), WRITE_DELAY_MS);
}

/**
 * Reset all data: empties the copy right away, without reading it first (nothing in it is wanted any more, so later
 * copies are written whether or not a read ever worked). `gen`: the save counter of the emptied localStorage list.
 */
export async function clearMirror(gen: number): Promise<void> {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  pending = undefined;
  readOk = true;
  const b = getBackend();
  if (!b) return;
  // Failed: the next flush tries again, unless a newer copy is waiting by then. Until then the old copy's lower
  // counter keeps its cards out (store.ts).
  if (!(await writeRecord(b, { data: [], gen }))) pending ??= { data: [], gen };
}
