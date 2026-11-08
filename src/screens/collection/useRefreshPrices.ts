import { useCallback, useRef, useState } from 'react';
import { updateCollectionPrice } from '../../lib/store';
import { getCard } from '../../lib/tcgdex';
import type { CollectionItem } from '../../lib/types';

export interface RefreshProgress {
  done: number;
  total: number;
}

// A few requests at a time: quick for a big binder without hammering the free API.
const CONCURRENCY = 3;

/**
 * Re-checks the price of every saved card (one request per card, shared by its saved variants) and
 * stores it. `refresh` resolves with how many cards could not be checked.
 */
export function useRefreshPrices(items: readonly CollectionItem[]) {
  const [progress, setProgress] = useState<RefreshProgress | null>(null);
  const running = useRef(false);

  const refresh = useCallback(async (): Promise<{ failed: number }> => {
    if (running.current) return { failed: 0 };
    running.current = true;
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
            const price = card.variants.find((v) => v.key === item.variant)?.summary?.market ?? item.priceUsd;
            updateCollectionPrice(item.key, price);
          }
        } catch {
          failed++;
        }
        setProgress({ done: ++done, total });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
    running.current = false;
    setProgress(null);
    return { failed };
  }, [items]);

  return { progress, refresh };
}
