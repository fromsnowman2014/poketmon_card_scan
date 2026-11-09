import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { updateCollectionPrice } from '../../lib/store';
import { getCard } from '../../lib/tcgdex';
import type { CollectionItem } from '../../lib/types';
import { useOnline } from '../../lib/useOnline';

export interface RefreshProgress {
  done: number;
  total: number;
}

// A few requests at a time: quick for a big binder without hammering the free API.
const CONCURRENCY = 3;
/** Background refreshes are gentler: nobody is waiting for them. */
const AUTO_CONCURRENCY = 2;
/** Saved prices older than this are refreshed automatically when Home or My Cards opens. */
export const STALE_MS = 24 * 60 * 60 * 1000;
/** At most one automatic refresh per hour (failed cards stay stale and would otherwise retry on every visit). */
export const AUTO_INTERVAL_MS = 60 * 60 * 1000;
/** Let the screen settle (and the first card images load) before starting. */
const AUTO_DELAY_MS = 2000;
const AUTO_KEY = 'cc:pricesAutoRefreshedAt';

// One refresh at a time for the whole app, shared by Home and My Cards.
let progress: RefreshProgress | null = null;
let current: { run: Promise<{ failed: number }>; background: boolean } | null = null;
let autoAtMemory = 0;
const listeners = new Set<() => void>();

function setProgress(next: RefreshProgress | null): void {
  progress = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getProgress = () => progress;

function lastAutoAt(): number {
  try {
    return Math.max(autoAtMemory, Number(globalThis.localStorage?.getItem(AUTO_KEY)) || 0);
  } catch {
    return autoAtMemory;
  }
}

function markAutoAt(now: number): void {
  autoAtMemory = now;
  try {
    globalThis.localStorage?.setItem(AUTO_KEY, String(now));
  } catch {
    // memory is enough for this session
  }
}

async function run(items: readonly CollectionItem[], concurrency: number): Promise<{ failed: number }> {
  const groups = new Map<string, CollectionItem[]>();
  for (const item of items) {
    const key = `${item.lang}:${item.id}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const queue = [...groups.values()];
  const total = queue.length;
  let done = 0;
  let failed = 0;
  setProgress({ done, total });

  const worker = async () => {
    for (let group = queue.shift(); group; group = queue.shift()) {
      try {
        const card = await getCard(group[0].lang, group[0].id);
        for (const item of group) {
          // A variant that lost its price keeps the last known one rather than dropping to "no price".
          const summary = card.variants.find((v) => v.key === item.variant)?.summary;
          if (summary?.market != null) updateCollectionPrice(item.key, summary.market, summary.converted);
          else updateCollectionPrice(item.key, item.priceUsd, !!item.priceApprox);
        }
      } catch {
        failed++;
      }
      setProgress({ done: ++done, total });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  return { failed };
}

/**
 * Re-checks the price of each card in `items` (one request per card, shared by its saved variants) and stores it.
 * Resolves with how many cards could not be checked. One refresh runs at a time: a call during a manual refresh
 * joins it; a manual call during a background refresh waits for it, then runs.
 */
export async function refreshPrices(
  items: readonly CollectionItem[],
  opts: { background?: boolean } = {},
): Promise<{ failed: number }> {
  const background = !!opts.background;
  if (current && (background || !current.background)) return current.run;
  if (current) await current.run;
  if (current) return current.run; // another call started first while we waited
  const promise = run(items, background ? AUTO_CONCURRENCY : CONCURRENCY).finally(() => {
    current = null;
    setProgress(null);
  });
  current = { run: promise, background };
  return promise;
}

/** Saved cards whose price was last checked more than a day ago (or at an unreadable time). */
export function staleItems<T extends Pick<CollectionItem, 'priceUpdatedAt'>>(items: readonly T[], now = Date.now()): T[] {
  return items.filter((i) => !(now - Date.parse(i.priceUpdatedAt) < STALE_MS));
}

/**
 * Starts a background refresh of the stale cards, unless one is running, nothing is stale or the last automatic
 * refresh was less than an hour ago. Returns its promise, or undefined when it did not start.
 */
export function autoRefreshPrices(items: readonly CollectionItem[], now = Date.now()): Promise<{ failed: number }> | undefined {
  if (current || now - lastAutoAt() < AUTO_INTERVAL_MS) return undefined;
  const stale = staleItems(items, now);
  if (!stale.length) return undefined;
  markAutoAt(now);
  return refreshPrices(stale, { background: true });
}

/** Refresh state shared across screens, and a manual refresh of every saved card. */
export function useRefreshPrices(items: readonly CollectionItem[]) {
  const shared = useSyncExternalStore(subscribe, getProgress, getProgress);
  const refresh = useCallback(() => refreshPrices(items), [items]);
  return { progress: shared, refresh };
}

/** Keeps saved prices fresh: when online, refreshes prices older than a day in the background (hourly at most). */
export function useAutoRefreshPrices(items: readonly CollectionItem[]): void {
  const online = useOnline();
  useEffect(() => {
    if (!online || !items.length) return;
    const timer = setTimeout(() => void autoRefreshPrices(items), AUTO_DELAY_MS);
    return () => clearTimeout(timer);
  }, [online, items]);
}
