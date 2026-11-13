import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectStorageContext,
  getStorageContext,
  inAppLabel,
  isStandalone,
  isTestAddress,
  PROBE_KEY,
  probeStorage,
  resetStorageContext,
  storageNotice,
  type StorageCheck,
  type StorageEnv,
} from './storageContext';

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const UA = {
  safari: `${IOS} Version/17.5 Mobile/15E148 Safari/604.1`,
  // The Home Screen app and a bare web view both leave out "Safari/".
  homeScreen: `${IOS} Mobile/15E148`,
  chromeIos: `${IOS} CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1`,
  firefoxIos: `${IOS} FxiOS/127.0 Mobile/15E148 Safari/605.1.15`,
  kakaoIos: `${IOS} Mobile/15E148 KAKAOTALK 10.8.5`,
  naverIos: `${IOS} Mobile/15E148 NAVER(inapp; search; 2000; 12.6.1; 15PRO)`,
  instagramIos: `${IOS} Mobile/15E148 Instagram 337.0.3.23.54 (iPhone15,3; iOS 17_5; ko_KR; ko; scale=3.00; 1290x2796; 615411958)`,
  facebookIos: `${IOS} Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.97;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/17.5]`,
  lineIos: `${IOS} Mobile/15E148 Safari Line/14.10.0`,
  daumIos: `${IOS} Mobile/15E148 DaumApps/8.10.0 DaumDevice/mobile`,
  everytimeIos: `${IOS} Mobile/15E148 everytimeApp`,
  googleAppIos: `${IOS} GSA/322.0.648915268 Mobile/15E148 Safari/604.1`,
  twitterIos: `${IOS} Mobile/15E148 Twitter for iPhone/10.50`,
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidKakao:
    'Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36;KAKAOTALK 2410800',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  macWebView: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
};

const REAL_HOST = 'fromsnowman2014.github.io';

function env(userAgent: string, more: Partial<StorageEnv> = {}): StorageEnv {
  return { userAgent, maxTouchPoints: /iPhone/.test(userAgent) ? 5 : 0, standalone: false, host: REAL_HOST, ...more };
}

describe('detectStorageContext', () => {
  it('the Home Screen app is the app, though its user agent has no "Safari/"', () => {
    expect(detectStorageContext(env(UA.homeScreen, { standalone: true }))).toEqual({
      kind: 'app',
      ios: true,
      testAddress: false,
      host: REAL_HOST,
    });
  });

  it('a Safari tab, Chrome or Firefox on iPhone is the browser', () => {
    for (const ua of [UA.safari, UA.chromeIos, UA.firefoxIos]) {
      expect(detectStorageContext(env(ua))).toMatchObject({ kind: 'browser', ios: true });
    }
  });

  it('names the app around a built-in browser', () => {
    const cases: [string, string][] = [
      [UA.kakaoIos, 'KakaoTalk'],
      [UA.naverIos, 'NAVER'],
      [UA.instagramIos, 'Instagram'],
      [UA.facebookIos, 'Facebook'],
      [UA.lineIos, 'LINE'],
      [UA.daumIos, 'Daum'],
      [UA.everytimeIos, 'Everytime'],
      // The Google app says "Safari/" like a real browser: only its own token gives it away.
      [UA.googleAppIos, 'Google'],
      [UA.twitterIos, 'X (Twitter)'],
    ];
    for (const [ua, name] of cases) {
      expect(detectStorageContext(env(ua))).toMatchObject({ kind: 'in-app', ios: true, inAppName: name });
    }
  });

  it('a bare iOS web view (no "Safari/", not standalone) is an in-app browser without a name', () => {
    const ctx = detectStorageContext(env(UA.homeScreen));
    expect(ctx).toMatchObject({ kind: 'in-app', ios: true });
    expect(ctx.inAppName).toBeUndefined();
  });

  it('an iPad asking for desktop sites is iOS; a Mac (no touch screen) is a computer', () => {
    expect(detectStorageContext(env(UA.ipadDesktop, { maxTouchPoints: 5 }))).toMatchObject({ kind: 'browser', ios: true });
    expect(detectStorageContext(env(UA.ipadDesktop, { maxTouchPoints: 0 }))).toMatchObject({ kind: 'desktop', ios: false });
  });

  it('Android and computers keep storage the usual way: desktop, no notice', () => {
    for (const ua of [UA.androidChrome, UA.macChrome, UA.macWebView]) {
      expect(detectStorageContext(env(ua))).toMatchObject({ kind: 'desktop', ios: false });
    }
  });

  it("an app's built-in browser on Android is still in-app", () => {
    expect(detectStorageContext(env(UA.androidKakao))).toMatchObject({ kind: 'in-app', ios: false, inAppName: 'KakaoTalk' });
  });

  it('an installed app on a computer is the app', () => {
    expect(detectStorageContext(env(UA.macChrome, { standalone: true }))).toMatchObject({ kind: 'app', ios: false });
  });

  it('keeps the host and flags test addresses in every kind', () => {
    const tunnel = 'warm-cards-live.trycloudflare.com';
    expect(detectStorageContext(env(UA.homeScreen, { standalone: true, host: tunnel }))).toMatchObject({
      kind: 'app',
      testAddress: true,
      host: tunnel,
    });
    expect(detectStorageContext(env(UA.safari, { host: '' }))).toMatchObject({ testAddress: false, host: '' });
  });
});

describe('isTestAddress', () => {
  it('the real app is not a test address', () => {
    expect(isTestAddress(REAL_HOST)).toBe(false);
    expect(isTestAddress('')).toBe(false);
    expect(isTestAddress('8.8.8.8')).toBe(false);
  });

  it('tunnels, this computer, the local network and pages.dev previews are', () => {
    for (const host of [
      'warm-cards-live.trycloudflare.com',
      'localhost:5971',
      'localhost',
      'app.localhost:5173',
      '127.0.0.1:4173',
      '[::1]:5173',
      '[::1]',
      '10.0.0.8:5173',
      '172.16.4.2',
      '172.31.255.1:80',
      '192.168.0.12:5173',
      'my-mac.local:5173',
      'poketmon-card-scan.pages.dev',
      'abc123.poketmon-card-scan.pages.dev',
      'LOCALHOST:5971',
    ]) {
      expect(isTestAddress(host), host).toBe(true);
    }
  });

  it('only real private ranges and real suffixes count', () => {
    for (const host of ['172.15.0.1', '172.32.0.1', '192.169.0.1', '11.0.0.1', 'pages.dev.example.com', 'evil-trycloudflare.com', 'mylocal']) {
      expect(isTestAddress(host), host).toBe(false);
    }
  });
});

describe('inAppLabel', () => {
  it('says the app the way the UI language does', () => {
    expect(inAppLabel({ inAppName: 'KakaoTalk' }, 'ko')).toBe('카카오톡');
    expect(inAppLabel({ inAppName: 'KakaoTalk' }, 'en')).toBe('KakaoTalk');
    expect(inAppLabel({ inAppName: 'NAVER' }, 'ko')).toBe('네이버');
    expect(inAppLabel({}, 'ko')).toBeUndefined();
    expect(inAppLabel({ inAppName: 'Something' }, 'ko')).toBe('Something');
  });
});

/** Minimal Storage with an optional byte quota (UTF-16 chars × 2, like browsers count it). */
class MemoryStorage implements Storage {
  data = new Map<string, string>();
  writes = 0;
  constructor(private quotaBytes = Infinity) {}
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.writes++;
    const used = [...this.data].reduce((n, [key, val]) => n + (key === k ? 0 : (key.length + val.length) * 2), 0);
    if (used + (k.length + v.length) * 2 > this.quotaBytes) throw new DOMException('full', 'QuotaExceededError');
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

function failingStorage(error: unknown, overrides: Partial<Storage> = {}) {
  return {
    getItem: () => null,
    setItem: () => {
      throw error;
    },
    removeItem: () => undefined,
    ...overrides,
  };
}

describe('probeStorage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ok when a value can be written and read back, and leaves nothing behind', () => {
    const storage = new MemoryStorage();
    storage.setItem('cc:collection', '{"v":1,"data":[]}');
    expect(probeStorage(storage)).toBe('ok');
    expect(storage.getItem(PROBE_KEY)).toBeNull();
    expect([...storage.data.keys()]).toEqual(['cc:collection']);
  });

  it('blocked when there is no storage or it refuses (Block All Cookies)', () => {
    expect(probeStorage(null)).toBe('blocked');
    expect(probeStorage(failingStorage(new DOMException('denied', 'SecurityError')))).toBe('blocked');
    expect(probeStorage(failingStorage(new Error('weird')))).toBe('blocked');
  });

  it('full on every browser\'s "no room" error', () => {
    expect(probeStorage(failingStorage(new DOMException('full', 'QuotaExceededError')))).toBe('full');
    expect(probeStorage(failingStorage({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }))).toBe('full');
    expect(probeStorage(failingStorage({ code: 22 }))).toBe('full');
  });

  it("blocked when the write doesn't stick, and never throws", () => {
    const forgetful = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
    expect(probeStorage(forgetful)).toBe('blocked');
    const unreadable = {
      getItem: (): string | null => {
        throw new Error('gone');
      },
      setItem: () => undefined,
      removeItem: () => {
        throw new Error('gone');
      },
    };
    expect(() => probeStorage(unreadable)).not.toThrow();
    expect(probeStorage(unreadable)).toBe('blocked');
  });

  it('a value that sticks but cannot be removed is still ok', () => {
    const data = new Map<string, string>();
    const sticky = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: () => {
        throw new Error('nope');
      },
    };
    expect(probeStorage(sticky)).toBe('ok');
  });

  it('makes room by dropping cached API data first, like a My Cards save', () => {
    const ls = new MemoryStorage(2000);
    for (let i = 0; i < 8; i++) ls.setItem(`cc:cache:k${i}`, JSON.stringify({ v: 'x'.repeat(40), exp: Date.now() + 60_000 + i }));
    // Fill the rest so not even the tiny probe fits.
    let filler = 'y'.repeat(200);
    while (filler.length > 0) {
      try {
        ls.setItem('cc:filler', (ls.getItem('cc:filler') ?? '') + filler);
      } catch {
        filler = filler.slice(0, Math.floor(filler.length / 2));
      }
    }
    vi.stubGlobal('localStorage', ls);
    expect(probeStorage(ls)).toBe('ok');
    expect([...ls.data.keys()].filter((k) => k.startsWith('cc:cache:')).length).toBeLessThan(8);
    expect(ls.getItem('cc:filler')).not.toBeNull();
  });

  it('full when nothing can be dropped', () => {
    const ls = new MemoryStorage(40);
    ls.setItem('cc:x', 'y'.repeat(14));
    vi.stubGlobal('localStorage', ls);
    expect(probeStorage(ls)).toBe('full');
    expect(ls.getItem('cc:x')).toBe('y'.repeat(14));
  });
});

describe('isStandalone', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('true for the iOS Home Screen app or display-mode: standalone, false otherwise, never throws', () => {
    vi.stubGlobal('navigator', { standalone: true });
    expect(isStandalone()).toBe(true);

    vi.stubGlobal('navigator', { standalone: false });
    vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: q === '(display-mode: standalone)' }) });
    expect(isStandalone()).toBe(true);

    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(isStandalone()).toBe(false);

    vi.stubGlobal('window', {
      matchMedia: () => {
        throw new Error('no');
      },
    });
    expect(isStandalone()).toBe(false);
  });

  it('false where there is no window (tests, server)', () => {
    vi.stubGlobal('navigator', {});
    expect(isStandalone()).toBe(false);
  });
});

describe('getStorageContext', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetStorageContext();
  });

  it('detects and probes once, then gives the same answer for the session', () => {
    const ls = new MemoryStorage();
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('navigator', { userAgent: UA.kakaoIos, maxTouchPoints: 5 });
    vi.stubGlobal('location', { host: 'localhost:5971' });
    resetStorageContext();
    const first = getStorageContext();
    expect(first).toEqual({ kind: 'in-app', ios: true, inAppName: 'KakaoTalk', testAddress: true, host: 'localhost:5971', probe: 'ok' });
    expect(ls.writes).toBe(1);
    expect(getStorageContext()).toBe(first);
    expect(ls.writes).toBe(1);
  });

  it('reports blocked storage found at startup', () => {
    vi.stubGlobal('localStorage', failingStorage(new DOMException('denied', 'SecurityError')));
    vi.stubGlobal('navigator', { userAgent: UA.safari, maxTouchPoints: 5 });
    resetStorageContext();
    expect(getStorageContext()).toMatchObject({ kind: 'browser', probe: 'blocked', host: '' });
  });
});

describe('storageNotice', () => {
  const check = (more: Partial<StorageCheck> = {}): StorageCheck => ({
    kind: 'app',
    ios: true,
    testAddress: false,
    host: REAL_HOST,
    probe: 'ok',
    ...more,
  });

  it('nothing in the Home Screen app, on Android or on a computer when all is well', () => {
    expect(storageNotice(check(), true)).toBeNull();
    expect(storageNotice(check({ kind: 'desktop', ios: false }), true)).toBeNull();
  });

  it('shows the first that applies: unsaved, storage refused, in-app, test address, iPhone browser', () => {
    const everything = check({ kind: 'in-app', testAddress: true, probe: 'blocked' });
    expect(storageNotice(everything, false)).toBe('unsaved');
    expect(storageNotice(everything, true)).toBe('cant-save');
    expect(storageNotice(check({ kind: 'in-app', testAddress: true, probe: 'full' }), true)).toBe('cant-save');
    expect(storageNotice(check({ kind: 'in-app', testAddress: true }), true)).toBe('in-app');
    expect(storageNotice(check({ kind: 'browser', testAddress: true }), true)).toBe('test-address');
    expect(storageNotice(check({ kind: 'app', testAddress: true }), true)).toBe('test-address');
    expect(storageNotice(check({ kind: 'browser' }), true)).toBe('browser');
  });

  it('the card page skips "not saved yet" (its Add button says it) and shows the next one', () => {
    expect(storageNotice(check(), false, true)).toBeNull();
    expect(storageNotice(check({ kind: 'browser' }), false, true)).toBe('browser');
    expect(storageNotice(check({ probe: 'blocked' }), false, true)).toBe('cant-save');
  });

  it('a save that worked after a failed startup check wins over that check', () => {
    expect(storageNotice(check({ probe: 'full' }), true, false, true)).toBeNull();
    expect(storageNotice(check({ kind: 'browser', probe: 'blocked' }), true, false, true)).toBe('browser');
    expect(storageNotice(check({ probe: 'full' }), false, false, true)).toBe('unsaved'); // and failing again says so
  });
});
