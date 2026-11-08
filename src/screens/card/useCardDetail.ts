import { useCallback, useEffect, useState } from 'react';
import { HttpError } from '../../lib/cache';
import { getCard } from '../../lib/tcgdex';
import type { CardDetail, CardLang } from '../../lib/types';

export type CardState =
  | { status: 'loading' }
  | { status: 'ready'; card: CardDetail }
  | { status: 'missing' }
  | { status: 'error'; offline: boolean };

/** Loads one card; retries by itself when the device comes back online after a failure. */
export function useCardDetail(lang: CardLang, id: string): { state: CardState; retry: () => void } {
  const [state, setState] = useState<CardState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    setState((s) => (s.status === 'loading' ? s : { status: 'loading' }));
    getCard(lang, id).then(
      (card) => alive && setState({ status: 'ready', card }),
      (err: unknown) => {
        if (!alive) return;
        if (err instanceof HttpError && err.status === 404) setState({ status: 'missing' });
        else setState({ status: 'error', offline: !navigator.onLine });
      },
    );
    return () => {
      alive = false;
    };
  }, [lang, id, attempt]);

  const failed = state.status === 'error';
  useEffect(() => {
    if (!failed) return;
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [failed, retry]);

  return { state, retry };
}
