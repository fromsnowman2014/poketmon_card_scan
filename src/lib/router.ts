// In-memory router. The URL never changes while navigating: iOS home-screen apps re-ask for camera
// permission whenever the URL or hash changes (WebKit bug 215884). The current path lives in
// history.state (so the back button and reloads work) and in sessionStorage as a backup.
import { createElement, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

export interface Route {
  /** Path without query, e.g. "/card/ja/SV8a-084". */
  path: string;
  /** Path + query exactly as navigated to, e.g. "/search?q=pikachu". */
  href: string;
  /** Decoded path parts, e.g. ["card", "ja", "SV8a-084"]. */
  segments: string[];
  query: URLSearchParams;
}

interface Entry {
  cc: 1;
  href: string;
  /** Position in our own stack; 0 = first screen of this session (nothing in-app to go back to). */
  idx: number;
  /** Scroll position saved when leaving this entry. */
  y?: number;
}

const SESSION_KEY = 'cc:route';
const listeners = new Set<() => void>();
let entry: Entry | undefined;
let route: Route = parseRoute('/');

function isEntry(x: unknown): x is Entry {
  const e = x as Partial<Entry> | null;
  return !!e && e.cc === 1 && typeof e.href === 'string' && typeof e.idx === 'number';
}

/** "card/ja/x/" → "/card/ja/x"; keeps the query, drops any hash. */
function normalize(to: string): string {
  const s = to.trim().replace(/^#/, '').split('#')[0];
  const q = s.indexOf('?');
  const rawPath = q < 0 ? s : s.slice(0, q);
  const query = q < 0 ? '' : s.slice(q + 1);
  const path = ('/' + rawPath).replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
  return query ? `${path}?${query}` : path;
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function parseRoute(href: string): Route {
  const q = href.indexOf('?');
  const path = q < 0 ? href : href.slice(0, q);
  return {
    path,
    href,
    segments: path.split('/').filter(Boolean).map(decode),
    query: new URLSearchParams(q < 0 ? '' : href.slice(q + 1)),
  };
}

function remember(href: string): void {
  try {
    sessionStorage.setItem(SESSION_KEY, href);
  } catch {
    // storage blocked: reloads fall back to history.state only
  }
}

function recall(): string | undefined {
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function cleanUrl(): string {
  return location.pathname + location.search;
}

function hashRoute(): string | undefined {
  return location.hash.startsWith('#/') ? normalize(location.hash.slice(1)) : undefined;
}

function current(): Entry {
  if (entry) return entry;
  if (typeof window === 'undefined') return (entry = { cc: 1, href: '/', idx: 0 });

  history.scrollRestoration = 'manual';
  const state: unknown = history.state;
  const deepLink = hashRoute();
  const idx = isEntry(state) ? state.idx : 0;
  entry = { cc: 1, href: deepLink ?? (isEntry(state) ? state.href : recall() ?? '/'), idx };
  // A "#/…" deep link is honored once; drop the hash so the URL stays fixed from here on.
  if (deepLink) history.replaceState(entry, '', cleanUrl());
  else history.replaceState(entry, '');
  route = parseRoute(entry.href);
  remember(entry.href);
  window.addEventListener('popstate', onPopState);
  return entry;
}

function onPopState(e: PopStateEvent): void {
  if (isEntry(e.state)) {
    entry = e.state;
  } else {
    // Not one of ours (e.g. a hash typed into the address bar): adopt it as a fresh entry.
    entry = { cc: 1, href: hashRoute() ?? '/', idx: 0 };
    history.replaceState(entry, '', cleanUrl());
  }
  commit(entry.y ?? 0);
}

function commit(scrollY: number): void {
  route = parseRoute(current().href);
  remember(route.href);
  listeners.forEach((l) => l());
  restoreScroll(scrollY);
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Runs after React has rendered the new screen; retries briefly while async content grows the page. */
function restoreScroll(y: number): void {
  let tries = 0;
  const step = () => {
    window.scrollTo(0, y);
    if (y > 0 && Math.abs(window.scrollY - y) > 2 && ++tries < 30) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function subscribe(listener: () => void): () => void {
  current();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getRoute(): Route {
  current();
  return route;
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getRoute, getRoute);
}

/**
 * Go to an app path such as "/card/ja/SV8a-084" or "/search?q=pika". Navigating to the current
 * path just scrolls to the top (tapping the active tab).
 */
export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const from = current();
  const href = normalize(to);
  if (href === from.href && !opts.replace) {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    return;
  }
  if (opts.replace) {
    entry = { cc: 1, href, idx: from.idx };
    history.replaceState(entry, '');
  } else {
    history.replaceState({ ...from, y: window.scrollY }, '');
    entry = { cc: 1, href, idx: from.idx + 1 };
    history.pushState(entry, '');
  }
  commit(0);
}

/** Back within the app, or to `fallback` (replacing this entry) when this is the first screen. */
export function goBack(fallback = '/'): void {
  if (current().idx > 0) history.back();
  else navigate(fallback, { replace: true });
}

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string;
  replace?: boolean;
}

/** An <a> that navigates in-app. Its href is a "#/…" deep link, so "open in new tab" still works. */
export function Link({ to, replace, onClick, ...rest }: LinkProps) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to, { replace });
  };
  return createElement('a', { ...rest, href: '#' + normalize(to), onClick: handleClick });
}
