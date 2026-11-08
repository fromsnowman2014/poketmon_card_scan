import { useEffect, useSyncExternalStore } from 'react';
import './Toast.css';

interface ToastState {
  id: number;
  text: string;
  icon?: string;
  durationMs: number;
}

let current: ToastState | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function publish(next: ToastState | null): void {
  current = next;
  listeners.forEach((l) => l());
}

/**
 * Shows a short message above the tab bar (replaces any visible toast). Works from anywhere,
 * including outside React. Pass already-translated text.
 */
export function showToast(text: string, opts: { icon?: string; durationMs?: number } = {}): void {
  publish({ id: nextId++, text, icon: opts.icon, durationMs: opts.durationMs ?? 2400 });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getToast = () => current;

/** Render once near the app root. */
export function ToastHost() {
  const toast = useSyncExternalStore(subscribe, getToast, getToast);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      if (current?.id === toast.id) publish(null);
    }, toast.durationMs);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className="toast">
          {toast.icon && (
            <span className="toast-icon" aria-hidden="true">
              {toast.icon}
            </span>
          )}
          {toast.text}
        </div>
      )}
    </div>
  );
}
