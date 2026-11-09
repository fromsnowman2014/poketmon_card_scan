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
