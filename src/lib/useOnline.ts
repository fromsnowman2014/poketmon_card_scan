import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const getOnline = () => navigator.onLine;

/** navigator.onLine, re-rendering when the connection drops or comes back. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getOnline, () => true);
}
