// USD-based exchange rates (EUR for Cardmarket prices, KRW for display).
import { useEffect, useSyncExternalStore } from 'react';
import { cached, fetchJson, peekCached } from './cache';

/** Units of each currency per 1 USD. */
export interface Rates {
  EUR: number;
  KRW: number;
  fetchedAt: string;
}

/** Used until (or whenever) live rates can't be fetched. Snapshot of 2026-11-08. */
export const FALLBACK_RATES: Rates = { EUR: 0.8957, KRW: 1359, fetchedAt: '2026-11-08T00:00:00.000Z' };

const KEY = 'fx:usd';
const TTL_MS = 12 * 60 * 60 * 1000;
/** After both providers fail, don't retry for a while (avoids slowing every card load when offline). */
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

/** Short: nothing waits on rates any more (cards use the last known ones), so a hanging host just moves on. */
const TIMEOUT_MS = 3500;

type Json = Record<string, unknown> | null | undefined;

/** Free, keyless, CORS-enabled providers (checked 2026-11-08), each mapped to {EUR, KRW} per USD. */
const SOURCES: { url: string; pick: (x: Json) => Json }[] = [
  { url: 'https://open.er-api.com/v6/latest/USD', pick: (x) => x?.rates as Json },
  { url: 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,KRW', pick: (x) => x?.rates as Json },
  {
    url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    pick: (x) => {
      const usd = x?.usd as Json;
      return usd && { EUR: usd.eur, KRW: usd.krw };
    },
  },
];

function isRate(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function toRates(r: Json): Rates | undefined {
  return r && isRate(r.EUR) && isRate(r.KRW) ? { EUR: r.EUR, KRW: r.KRW, fetchedAt: new Date().toISOString() } : undefined;
}

function isRates(x: unknown): x is Rates {
  const r = x as Partial<Rates> | null;
  return !!r && isRate(r.EUR) && isRate(r.KRW) && typeof r.fetchedAt === 'string';
}

async function fetchRates(): Promise<Rates> {
  for (const { url, pick } of SOURCES) {
    try {
      const body = await fetchJson<Json>(url, { timeoutMs: TIMEOUT_MS, retries: 0 });
      const rates = toRates(pick(typeof body === 'object' ? body : undefined));
      if (rates) return rates;
    } catch {
      // try the next provider
    }
  }
  throw new Error('No exchange-rate provider answered');
}

let latest: Rates | undefined;
let failedAt = 0;
const listeners = new Set<() => void>();

function publish(rates: Rates): void {
  if (latest && latest.EUR === rates.EUR && latest.KRW === rates.KRW) return;
  latest = rates;
  listeners.forEach((l) => l());
}

/** Last fetched rates (memory or localStorage, even if stale) or FALLBACK_RATES. Stable reference. */
export function getRatesSync(): Rates {
  if (!latest) {
    const stored = peekCached<unknown>(KEY);
    latest = isRates(stored) ? stored : FALLBACK_RATES;
  }
  return latest;
}

/** Live rates, cached 12h. Never throws: falls back to the last known or hard-coded rates. */
export async function getRates(): Promise<Rates> {
  if (Date.now() - failedAt < FAILURE_COOLDOWN_MS) return getRatesSync();
  try {
    // keep: the expired entry stays as the "last known" rates (getRatesSync) when pruning the cache.
    const rates = await cached(KEY, TTL_MS, fetchRates, { keep: true });
    publish(rates);
    return getRatesSync();
  } catch {
    failedAt = Date.now();
    return getRatesSync();
  }
}

export function eurToUsd(eur: number, rates: Rates = getRatesSync()): number {
  return eur / rates.EUR;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current rates for rendering; starts with getRatesSync() and re-renders once live rates arrive. */
export function useRates(): Rates {
  const rates = useSyncExternalStore(subscribe, getRatesSync, getRatesSync);
  useEffect(() => {
    void getRates();
  }, []);
  return rates;
}
