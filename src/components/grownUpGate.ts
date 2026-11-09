// "Look together with a grown-up" check before a link leaves the app for a shop (eBay, TCGplayer, …).
// Once a grown-up says OK, it stays OK for the rest of the session (sessionStorage), so links open directly.

export const GROWN_UP_KEY = 'cc:grownUpOk';

type SessionLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Remembered in memory too: private mode / blocked storage still skips the question until the next reload. */
let okThisLoad = false;

function session(): SessionLike | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined; // Safari with blocked site data throws on access
  }
}

/** True when a grown-up already said OK this session. */
export function grownUpConfirmed(storage: SessionLike | undefined = session()): boolean {
  if (okThisLoad) return true;
  try {
    return storage?.getItem(GROWN_UP_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember the grown-up's OK for this session. Never throws. */
export function confirmGrownUp(storage: SessionLike | undefined = session()): void {
  okThisLoad = true;
  try {
    storage?.setItem(GROWN_UP_KEY, '1');
  } catch {
    // quota / blocked storage: the in-memory flag above still holds until reload
  }
}

/** Tests only: forget the in-memory OK. */
export function resetGrownUpGate(): void {
  okThisLoad = false;
}

/** Only web pages: a listing URL from the eBay worker must never run script (javascript:) or open another app. */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

export type OpenWindow = (url: string, target: string, features: string) => unknown;

const browserOpen: OpenWindow = (url, target, features) =>
  typeof window === 'undefined' ? null : window.open(url, target, features);

/** Opens a shop page in a new tab that gets no handle on the app. False (nothing opened) for a non-web URL. */
export function openShop(url: string, open: OpenWindow = browserOpen): boolean {
  if (!isWebUrl(url)) return false;
  open(url, '_blank', 'noopener');
  return true;
}

/**
 * What a tap on a shop button does. Shop links are buttons, not <a href>, so iOS long-press "Open in New Tab"
 * can't skip the question: the shop opens only from here, once a grown-up said OK ('opened'); otherwise `ask`
 * shows the question ('asked'). A non-web URL does nothing ('blocked').
 */
export function shopTap(
  url: string,
  ask: () => void,
  open: OpenWindow = browserOpen,
  storage: SessionLike | undefined = session(),
): 'opened' | 'asked' | 'blocked' {
  if (!isWebUrl(url)) return 'blocked';
  if (!grownUpConfirmed(storage)) {
    ask();
    return 'asked';
  }
  openShop(url, open);
  return 'opened';
}
