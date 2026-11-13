// Where My Cards is saved. iOS keeps a separate storage area for the Home Screen app (each icon), each Safari tab
// profile, each Private tab (erased when it closes) and each app's built-in browser (KakaoTalk, Instagram…). Saving in
// one and opening another shows an empty My Cards, and no code can merge them: the app says where it runs
// (components/StorageNotice, Settings › Where My Cards is saved) and backups move cards between them.
import { writeWithRoom } from './cache';
import type { UiLang } from './types';

/**
 * - `app`: the Home Screen app (any installed app window);
 * - `browser`: a tab on an iPhone/iPad (Safari, Chrome, Firefox…, or an app's Safari view, which looks the same);
 * - `in-app`: an app's own built-in browser (KakaoTalk, Instagram…), or a bare iOS web view;
 * - `desktop`: anything else (Android, computers), where storage works the usual way.
 */
export type StorageKind = 'app' | 'browser' | 'in-app' | 'desktop';

export interface StorageContext {
  kind: StorageKind;
  /** iPhone, iPad or iPod (an iPad asking for desktop sites included). */
  ios: boolean;
  /** The app around an in-app browser when known ('KakaoTalk', 'Instagram'…); `inAppLabel` gives its Korean name. */
  inAppName?: string;
  /** Not the real github.io app: a tunnel, this computer, the local network or a pages.dev preview. */
  testAddress: boolean;
  /** `location.host`, e.g. "fromsnowman2014.github.io". */
  host: string;
}

/** What detection reads (tests pass their own). */
export interface StorageEnv {
  userAgent: string;
  /** `navigator.maxTouchPoints`: iPadOS says "Macintosh" but has a touch screen. */
  maxTouchPoints: number;
  /** `isStandalone()`. */
  standalone: boolean;
  /** `location.host`. */
  host: string;
}

/** Built-in browsers of apps people open links in. `name` is the app's own name, `ko` how Korean speakers say it. */
const IN_APPS: readonly { re: RegExp; name: string; ko: string }[] = [
  { re: /KAKAOTALK/i, name: 'KakaoTalk', ko: '카카오톡' },
  { re: /NAVER\(inapp/i, name: 'NAVER', ko: '네이버' },
  { re: /Instagram/i, name: 'Instagram', ko: '인스타그램' },
  { re: /FBAN|FBAV|FB_IAB|FBIOS/, name: 'Facebook', ko: '페이스북' },
  { re: /\bLine\//, name: 'LINE', ko: '라인' },
  { re: /DaumApps/i, name: 'Daum', ko: '다음' },
  { re: /everytimeApp/i, name: 'Everytime', ko: '에브리타임' },
  { re: /\bGSA\//, name: 'Google', ko: '구글' },
  { re: /Twitter/i, name: 'X (Twitter)', ko: 'X(트위터)' },
];

/** Running as an installed app: the iOS Home Screen app (`navigator.standalone`) or `display-mode: standalone`. */
export function isStandalone(): boolean {
  try {
    if (typeof navigator !== 'undefined' && (navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

/** "localhost:5971" → "localhost", "[::1]:5173" → "[::1]". */
function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end < 0 ? h : h.slice(0, end + 1);
  }
  const colon = h.indexOf(':');
  // More than one colon without brackets: a bare IPv6 address, no port.
  return colon < 0 || h.indexOf(':', colon + 1) >= 0 ? h : h.slice(0, colon);
}

/**
 * True for addresses that are not the real app, where My Cards starts empty whenever the address changes: a Cloudflare
 * tunnel (*.trycloudflare.com, new every run), this computer (localhost, 127.x, [::1]), the local network (10/8,
 * 172.16/12, 192.168/16, *.local) and Cloudflare Pages previews (*.pages.dev).
 */
export function isTestAddress(host: string): boolean {
  const name = hostnameOf(host);
  if (!name) return false;
  if (['.trycloudflare.com', '.pages.dev', '.localhost', '.local'].some((end) => name.endsWith(end))) return true;
  if (name === 'localhost' || name === '[::1]' || name === '::1') return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(name);
  if (!ip) return false;
  const a = Number(ip[1]);
  const b = Number(ip[2]);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Works out where the app runs from the user agent, the touch screen, standalone mode and the address. */
export function detectStorageContext(env: StorageEnv): StorageContext {
  const ua = env.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1);
  const base = { ios, testAddress: isTestAddress(env.host), host: env.host };
  // First: a Home Screen app's user agent has no "Safari/" either.
  if (env.standalone) return { kind: 'app', ...base };
  const app = IN_APPS.find((a) => a.re.test(ua));
  if (app) return { kind: 'in-app', inAppName: app.name, ...base };
  // Every iOS browser says "Safari/" (Chrome and Firefox too, and an app's Safari view); a bare web view doesn't.
  if (ios && /AppleWebKit/.test(ua) && !/Safari\//.test(ua)) return { kind: 'in-app', ...base };
  return { kind: ios ? 'browser' : 'desktop', ...base };
}

/** The in-app browser's app in the UI language ("카카오톡" / "KakaoTalk"); undefined when unknown. */
export function inAppLabel(ctx: Pick<StorageContext, 'inAppName'>, lang: UiLang): string | undefined {
  const known = IN_APPS.find((a) => a.name === ctx.inAppName);
  return known ? (lang === 'ko' ? known.ko : known.name) : ctx.inAppName;
}

// ---------- Can this storage save at all? ----------

export type ProbeResult = 'ok' | 'blocked' | 'full';

export const PROBE_KEY = 'cc:probe';

type ProbeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function localStorageOrNull(): ProbeStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // access itself throws when storage is blocked
  }
}

function errorName(e: unknown): string {
  return typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : '';
}

const isQuotaError = (e: unknown) =>
  ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'].includes(errorName(e)) ||
  (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 22);

/**
 * Writes, reads back and removes a tiny `cc:probe` value: 'blocked' when storage is missing or refuses (Safari's
 * "Block All Cookies"), 'full' when there is no room even after dropping cached API data (as a My Cards save would).
 * Never throws.
 */
export function probeStorage(storage: ProbeStorage | null = localStorageOrNull()): ProbeResult {
  if (!storage) return 'blocked';
  const value = String(Date.now());
  let error: unknown;
  const written = writeWithRoom(() => {
    try {
      storage.setItem(PROBE_KEY, value);
    } catch (e) {
      error = e;
      throw e;
    }
  });
  if (!written) return isQuotaError(error) ? 'full' : 'blocked';
  let result: ProbeResult;
  try {
    result = storage.getItem(PROBE_KEY) === value ? 'ok' : 'blocked';
  } catch {
    result = 'blocked';
  }
  try {
    storage.removeItem(PROBE_KEY);
  } catch {
    // nothing to clean up then
  }
  return result;
}

// ---------- Once per session ----------

/** The context plus the storage check made when the app started. */
export interface StorageCheck extends StorageContext {
  probe: ProbeResult;
}

function readEnv(): StorageEnv {
  let host = '';
  try {
    host = typeof location === 'undefined' ? '' : location.host;
  } catch {
    // no address (tests)
  }
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return { userAgent: nav?.userAgent ?? '', maxTouchPoints: nav?.maxTouchPoints ?? 0, standalone: isStandalone(), host };
}

let session: StorageCheck | undefined;

/** Detects the context and probes storage the first time it is asked; the same answer for the rest of the session. */
export function getStorageContext(): StorageCheck {
  session ??= { ...detectStorageContext(readEnv()), probe: probeStorage() };
  return session;
}

/** `getStorageContext()` for components; none of it changes while the app runs, so no re-render ever needs it. */
export function useStorageContext(): StorageCheck {
  return getStorageContext();
}

/** Tests only: detect again on the next call. */
export function resetStorageContext(): void {
  session = undefined;
}

// ---------- Which notice ----------

/** The "where cards are saved" notices (components/StorageNotice), most urgent first. */
export type StorageNoticeKind = 'unsaved' | 'cant-save' | 'in-app' | 'test-address' | 'browser';

/**
 * The first notice that applies: a change to My Cards not saved yet, storage that failed the startup check, an
 * in-app browser, a test address, an iPhone browser tab. Null in the Home Screen app (or on Android and computers)
 * when nothing is wrong. `skipUnsaved` on the card page, where the Add button already says "not saved yet".
 * `savedThisSession`: a save of My Cards has worked since startup, so a failed startup check is out of date.
 */
export function storageNotice(
  check: StorageCheck,
  saved: boolean,
  skipUnsaved = false,
  savedThisSession = false,
): StorageNoticeKind | null {
  if (!saved && !skipUnsaved) return 'unsaved';
  if (check.probe !== 'ok' && !savedThisSession) return 'cant-save';
  if (check.kind === 'in-app') return 'in-app';
  if (check.testAddress) return 'test-address';
  if (check.kind === 'browser') return 'browser';
  return null;
}
