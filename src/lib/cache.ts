// Memory + localStorage TTL cache with in-flight de-duplication, and a fetch helper with timeout/retry.

const PREFIX = 'cc:cache:';

interface Entry {
  v: unknown;
  /** Expiry, epoch ms. */
  exp: number;
}

const memory = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/** localStorage, or undefined where it is missing (SSR/tests) or throws on access (some private modes). */
function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function isEntry(x: unknown): x is Entry {
  return typeof x === 'object' && x !== null && 'v' in x && typeof (x as Entry).exp === 'number';
}

function readStored(key: string): Entry | undefined {
  try {
    const raw = storage()?.getItem(PREFIX + key);
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    return isEntry(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Drops our expired entries so a full localStorage has room again. */
function pruneExpired(store: Storage): void {
  const now = Date.now();
  for (let i = store.length - 1; i >= 0; i--) {
    const k = store.key(i);
    if (!k?.startsWith(PREFIX)) continue;
    const e = readStored(k.slice(PREFIX.length));
    if (!e || e.exp <= now) store.removeItem(k);
  }
}

function writeStored(key: string, entry: Entry): void {
  const store = storage();
  if (!store) return;
  const raw = JSON.stringify(entry);
  try {
    store.setItem(PREFIX + key, raw);
  } catch {
    try {
      pruneExpired(store);
      store.setItem(PREFIX + key, raw);
    } catch {
      // Still full or blocked: the memory copy is enough.
    }
  }
}

/**
 * Returns the cached value for `key` if younger than `ttlMs`, otherwise runs `fn` and caches its result.
 * Concurrent calls for the same key share one `fn` call. Rejections are not cached.
 */
export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>, opts: { persist?: boolean } = {}): Promise<T> {
  const persist = opts.persist ?? true;
  const now = Date.now();
  const hit = memory.get(key) ?? (persist ? readStored(key) : undefined);
  if (hit && hit.exp > now) {
    memory.set(key, hit);
    return Promise.resolve(hit.v as T);
  }
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = fn()
    .then((v) => {
      const entry = { v, exp: Date.now() + ttlMs };
      memory.set(key, entry);
      if (persist) writeStored(key, entry);
      return v;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Last value stored under `key`, even if expired (for "last known" fallbacks). */
export function peekCached<T>(key: string): T | undefined {
  return (memory.get(key) ?? readStored(key))?.v as T | undefined;
}

/** Removes cached entries whose key starts with `prefix` (all entries when omitted). */
export function clearCache(prefix = ''): void {
  for (const k of [...memory.keys()]) if (k.startsWith(prefix)) memory.delete(k);
  const store = storage();
  if (!store) return;
  try {
    for (let i = store.length - 1; i >= 0; i--) {
      const k = store.key(i);
      if (k?.startsWith(PREFIX + prefix)) store.removeItem(k);
    }
  } catch {
    // Storage blocked: nothing persisted to clear.
  }
}

/** HTTP error with the response status, so callers can branch on 404 etc. */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
    this.status = status;
  }
}

const BACKOFF_MS = [400, 1200];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface FetchJsonOptions {
  timeoutMs?: number;
  /** Extra attempts after the first, on network errors, timeouts and HTTP 5xx. */
  retries?: number;
  /** Passed through to fetch (method, headers, body). */
  init?: RequestInit;
}

/**
 * GET (or `init.method`) a JSON resource. Retries network errors and 5xx (TCGdex sends transient
 * 503 "No available server") with 400ms/1200ms backoff; 4xx throws HttpError immediately.
 */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const { timeoutMs = 12000, retries = 2, init } = opts;
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      if (attempt >= retries) throw e;
      await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
      continue;
    }
    try {
      if (res.ok) return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
    const err = new HttpError(res.status, url);
    if (res.status < 500 || attempt >= retries) throw err;
    await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
  }
}
