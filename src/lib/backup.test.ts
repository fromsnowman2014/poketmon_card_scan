import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  backupCardCount,
  backupEnvelope,
  backupFile,
  decodeBackup,
  encodeBackupCode,
  MAX_BACKUP_CHARS,
} from './backup';
import type { CardDetail, CollectionItem } from './types';

const NOW = new Date('2026-11-13T05:30:00.000Z');

function item(id: string, over: Partial<CollectionItem> = {}): CollectionItem {
  const variant = over.variant ?? 'normal';
  return {
    key: `ja:${id}:${variant}`,
    id,
    lang: 'ja',
    name: 'ルチャブル',
    image: `https://assets.tcgdex.net/ja/SV/SV8a/${id.split('-').pop()}`,
    imageFallback: 'https://tcgplayer-cdn.tcgplayer.com/product/550123_400w.jpg',
    setId: 'SV8a',
    setName: 'テラスタルフェスex',
    localId: id.split('-').pop() ?? '',
    variant,
    qty: 1,
    priceUsd: 0.18,
    priceApprox: false,
    firstPriceUsd: 0.12,
    priceUpdatedAt: '2026-11-12T10:00:00.000Z',
    addedAt: '2026-11-10T09:00:00.000Z',
    dexIds: [701],
    ...over,
  };
}

/** A collection like a kid's: many cards of a few sets, a few with more copies or no price. */
function collection(n: number): CollectionItem[] {
  return Array.from({ length: n }, (_, i) =>
    item(`SV8a-${String(i + 1).padStart(3, '0')}`, {
      qty: (i % 4) + 1,
      variant: i % 3 ? 'normal' : 'reverse-masterball',
      priceUsd: i % 7 ? Math.round(i * 37.3) / 100 : null,
    }),
  );
}

const CODE_CHARS = /^[A-Za-z0-9_-]+$/;
/** The part after "CC1z:" / "CC1:". */
const payloadOf = (code: string) => code.slice(code.indexOf(':') + 1);

async function gzipText(text: string): Promise<Uint8Array> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const zippedCode = async (json: unknown) => `CC1z:${b64url(await gzipText(typeof json === 'string' ? json : JSON.stringify(json)))}`;
const plainCode = (json: unknown) => `CC1:${Buffer.from(typeof json === 'string' ? json : JSON.stringify(json)).toString('base64url')}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('encodeBackupCode / decodeBackup', () => {
  it('round-trips My Cards through a compressed code made of letters, digits, - and _', async () => {
    const items = collection(40);
    const code = await encodeBackupCode(items, NOW);
    expect(code.startsWith('CC1z:')).toBe(true);
    expect(payloadOf(code)).toMatch(CODE_CHARS);
    expect(await decodeBackup(code)).toEqual({ items, exportedAt: NOW.toISOString() });
  });

  it('compresses: the code is much shorter than the plain form', async () => {
    const items = collection(200);
    const zipped = await encodeBackupCode(items, NOW);
    vi.stubGlobal('CompressionStream', undefined);
    const plain = await encodeBackupCode(items, NOW);
    expect(plain.startsWith('CC1:')).toBe(true);
    expect(zipped.length).toBeLessThan(plain.length / 5);
  });

  it('falls back to a plain code on a phone without CompressionStream, which every phone can read', async () => {
    const items = collection(5);
    vi.stubGlobal('CompressionStream', undefined);
    vi.stubGlobal('DecompressionStream', undefined);
    const code = await encodeBackupCode(items, NOW);
    expect(code.startsWith('CC1:')).toBe(true);
    expect(payloadOf(code)).toMatch(CODE_CHARS);
    expect((await decodeBackup(code))?.items).toEqual(items);
    vi.unstubAllGlobals();
    expect((await decodeBackup(code))?.items).toEqual(items);
  });

  it('keeps names in any script intact', async () => {
    const items = [item('SV8a-084', { name: '루차불 ルチャブル Hawlucha é ✨' })];
    expect((await decodeBackup(await encodeBackupCode(items, NOW)))?.items).toEqual(items);
  });

  it('ignores spaces, line breaks and zero-width spaces anywhere in the code', async () => {
    const items = collection(30);
    const code = await encodeBackupCode(items, NOW);
    const wrapped = code.match(/.{1,37}/g)!.join('\n');
    expect((await decodeBackup(wrapped))?.items).toEqual(items);
    const messy = code.match(/.{1,50}/g)!.join([' ', '\r\n', '\t', ' ', '​'][code.length % 5]);
    expect((await decodeBackup(messy))?.items).toEqual(items);
    expect((await decodeBackup(`CC1z: \n${payloadOf(code)}`))?.items).toEqual(items);
    expect((await decodeBackup(code.replace(/(.{60})/g, '$1 ​\n ')))?.items).toEqual(items);
  });

  it('finds the code inside other text', async () => {
    const items = collection(3);
    const code = await encodeBackupCode(items, NOW);
    for (const text of [
      `CardCheck backup:\n${code}\n`,
      `CardCheck backup: ${code}`,
      `내 카드 백업 코드예요 ${code} 고마워요!`,
      `"${code}".`,
      `(${code})`,
      `${code} thanks`,
      `${code} is my code for you`,
      `${code}\n\nSent from my iPhone`,
    ]) {
      expect((await decodeBackup(text))?.items, text.slice(-30)).toEqual(items);
    }
  });

  it('reads the prefix in any case and skips a broken code before a good one', async () => {
    const items = collection(3);
    const code = await encodeBackupCode(items, NOW);
    expect((await decodeBackup(`cc1Z:${payloadOf(code)}`))?.items).toEqual(items);
    expect((await decodeBackup(`CC1z:abc CC1:### ${code}`))?.items).toEqual(items);
    expect((await decodeBackup(`${code.slice(0, 40)}${code}`))?.items).toEqual(items); // a cut-off copy glued on
  });

  it('reads the backup file’s content too (with a byte-order mark or Windows line endings)', async () => {
    const items = collection(4);
    const { text } = backupFile(items, NOW);
    expect(await decodeBackup(text)).toEqual({ items, exportedAt: NOW.toISOString() });
    expect((await decodeBackup(`﻿${text}`))?.items).toEqual(items);
    expect((await decodeBackup(text.replace(/\n/g, '\r\n')))?.items).toEqual(items);
    expect((await decodeBackup(JSON.stringify(backupEnvelope(items, NOW))))?.items).toEqual(items);
  });

  it('passes the entries on as stored: importCollection checks each one', async () => {
    const items = [item('SV8a-001'), { junk: true }, 'x', null];
    const decoded = await decodeBackup(await zippedCode({ app: 'cardcheck', kind: 'my-cards', v: 1, exportedAt: NOW.toISOString(), items }));
    expect(decoded?.items).toEqual(items);
  });

  it('leaves out a missing or unreadable date', async () => {
    const env = { app: 'cardcheck', kind: 'my-cards', v: 1, items: [item('SV8a-001')] };
    expect(await decodeBackup(await zippedCode(env))).toEqual({ items: env.items });
    expect(await decodeBackup(plainCode({ ...env, exportedAt: 'yesterday' }))).toEqual({ items: env.items });
    expect(await decodeBackup(JSON.stringify({ ...env, exportedAt: 12 }))).toEqual({ items: env.items });
  });

  it('says null for anything that is not a CardCheck My Cards backup of this version', async () => {
    const good = { app: 'cardcheck', kind: 'my-cards', v: 1, exportedAt: NOW.toISOString(), items: [item('SV8a-001')] };
    const code = await encodeBackupCode(good.items, NOW);
    const bad: unknown[] = [
      '',
      '   ',
      'hello',
      'CC1z:',
      'CC1:',
      'CC1z:!!!!',
      'CC1z:A', // a length base64 can't have
      'CC1z:SGVsbG8', // base64 of "Hello": not gzip
      plainCode('Hello'), // not JSON
      plainCode('[1,2,3]'),
      plainCode({ ...good, app: 'other' }),
      await zippedCode({ ...good, kind: 'settings' }),
      await zippedCode({ ...good, v: 2 }), // a newer app's backup
      await zippedCode({ ...good, items: { a: 1 } }),
      await zippedCode({ app: 'cardcheck', kind: 'my-cards', v: 1 }),
      await zippedCode(good.items), // a bare array
      `${code.slice(0, -12)}`, // cut short
      `CC1z:${payloadOf(code).slice(0, 20)}x${payloadOf(code).slice(21)}`, // one character changed
      JSON.stringify({ ...good, app: 'cardcheck2' }),
      JSON.stringify(good.items),
      `${JSON.stringify(good)} trailing`,
      '{"app":"cardcheck"',
      `CC1z:${'A'.repeat(MAX_BACKUP_CHARS)}`, // over the size limit
      JSON.stringify({ ...good, items: Array.from({ length: 12_000 }, (_, i) => item(`SV8a-${i}`)) }), // over 5 MB
    ];
    for (const text of bad) {
      expect(await decodeBackup(text as string), String(text).slice(0, 60)).toBeNull();
    }
    for (const notText of [undefined, null, 42, {}, ['CC1:']]) {
      expect(await decodeBackup(notText as unknown as string)).toBeNull();
    }
  });

  it('does not unpack a tiny code into gigabytes', async () => {
    const bomb = `{"app":"cardcheck","kind":"my-cards","v":1,"items":["${' '.repeat(11_000_000)}"]}`;
    const code = await zippedCode(bomb);
    expect(code.length).toBeLessThan(40_000);
    expect(await decodeBackup(code)).toBeNull();
  });

  it('cannot read a compressed code where the phone has no DecompressionStream (it says null, never throws)', async () => {
    const code = await encodeBackupCode(collection(2), NOW);
    vi.stubGlobal('DecompressionStream', undefined);
    expect(await decodeBackup(code)).toBeNull();
  });

  it('never throws, whatever is pasted', async () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
    const pieces = ['CC1z:', 'CC1:', 'H4sI', 'A', '_', '-', '=', ' ', '\n', '{', '}', '"app"', ':', 'cardcheck', '카드', '​', '﻿', '🙂'];
    for (let i = 0; i < 300; i++) {
      const text = Array.from({ length: 1 + Math.floor(random() * 40) }, () => pieces[Math.floor(random() * pieces.length)]).join('');
      await expect(decodeBackup(text)).resolves.toBeNull();
    }
    const real = await encodeBackupCode(collection(2), NOW);
    for (let i = 5; i < real.length; i += 7) {
      const damaged = `${real.slice(0, i)}${real[i] === 'A' ? 'B' : 'A'}${real.slice(i + 1)}`;
      const result = await decodeBackup(damaged);
      // A changed character either breaks the code or (in the last few bits) changes nothing at all.
      expect(result === null || result.items.length === 2).toBe(true);
    }
  });
});

describe('backupFile', () => {
  it('names the file after today (local time) and holds the envelope, indented', () => {
    const items = collection(2);
    const now = new Date(2026, 10, 13, 23, 59); // local time, whatever the machine's zone
    const file = backupFile(items, now);
    expect(file.name).toBe('cardcheck-my-cards-2026-11-13.json');
    expect(file.text.endsWith('\n')).toBe(true);
    expect(file.text).toContain('\n  "app": "cardcheck",');
    expect(JSON.parse(file.text)).toEqual({ app: 'cardcheck', kind: 'my-cards', v: 1, exportedAt: now.toISOString(), items });
  });

  it('pads the month and day', () => {
    expect(backupFile([], new Date(2027, 0, 5, 8)).name).toBe('cardcheck-my-cards-2027-01-05.json');
  });
});

describe('photos', () => {
  it('are never in a backup: picture web addresses stay, photo data goes', async () => {
    const photo = `data:image/jpeg;base64,${'/9j/4AAQ'.repeat(500)}`;
    const items = [item('SV8a-001', { image: photo, imageFallback: photo }), item('SV8a-002', { image: undefined, imageFallback: photo }), item('SV8a-003')];
    const env = backupEnvelope(items, NOW);
    expect(env.items[0]).not.toHaveProperty('image');
    expect(env.items[0]).not.toHaveProperty('imageFallback');
    expect(env.items[1]).not.toHaveProperty('imageFallback');
    expect(env.items[2]).toBe(items[2]); // nothing to drop: the same object
    expect(backupFile(items, NOW).text).not.toContain('data:');
    const decoded = await decodeBackup(await encodeBackupCode(items, NOW));
    expect(JSON.stringify(decoded)).not.toContain('data:');
    expect(decoded?.items[0]).toEqual({ ...items[0], image: undefined, imageFallback: undefined });
    expect(items[0].image).toBe(photo); // the saved card itself is untouched
  });
});

describe('backupCardCount', () => {
  it('counts copies of valid cards, like My Cards does', () => {
    expect(backupCardCount([])).toBe(0);
    expect(backupCardCount([item('SV8a-001', { qty: 3 }), item('SV8a-002')])).toBe(4);
    expect(backupCardCount([item('SV8a-001'), { junk: true }, null, 'x', { ...item('SV8a-002'), qty: 0 }])).toBe(1);
  });

  it('reads entries the way importCollection does: one per card and printing, whole numbers, at most 999', () => {
    const twice = [item('SV8a-001', { qty: 2 }), item('SV8a-001', { qty: 5, key: 'wrong-key' })];
    expect(backupCardCount(twice)).toBe(5);
    expect(backupCardCount([item('SV8a-001', { qty: 2.7 })])).toBe(2);
    expect(backupCardCount([item('SV8a-001', { qty: 5000 })])).toBe(999);
    expect(backupCardCount([item('SV8a-001'), item('SV8a-001', { variant: 'reverse' })])).toBe(2);
  });
});

/** Minimal Storage (enough for store.ts). */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
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
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

function card(id: string, market: number | null): CardDetail {
  return {
    id,
    lang: 'ja',
    localId: id.split('-').pop() ?? '',
    name: 'ルチャブル',
    image: `https://assets.tcgdex.net/ja/SV/SV8a/${id}`,
    setId: 'SV8a',
    setName: 'テラスタルフェスex',
    setOfficialCount: 187,
    dexIds: [701],
    variants: [
      { key: 'normal', type: 'normal', summary: market === null ? null : { market, low: null, high: null, changePct: null, source: 'tcgplayer', converted: false } },
      { key: 'reverse', type: 'reverse', summary: { market: 1.69, low: null, high: null, changePct: null, source: 'cardmarket', converted: true } },
    ],
    defaultVariant: 'normal',
    fetchedAt: '2026-11-08T00:00:00.000Z',
  };
}

/** A new storage area (another Home Screen icon, Safari, an app's built-in browser) with its own My Cards. */
async function storageArea() {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.resetModules();
  return import('./store');
}

describe('moving My Cards from one storage area to another', () => {
  it('brings every card over as it was, and a second paste changes nothing', async () => {
    const safari = await storageArea();
    safari.addToCollection(card('SV8a-001', 0.18), 'normal');
    safari.addToCollection(card('SV8a-001', 0.18), 'normal');
    safari.addToCollection(card('SV8a-002', null), 'normal');
    safari.addToCollection(card('SV8a-003', 2.5), 'reverse');
    const code = await encodeBackupCode(safari.exportCollection());

    const app = await storageArea();
    expect(app.exportCollection()).toEqual([]);
    const decoded = await decodeBackup(code);
    expect(decoded && backupCardCount(decoded.items)).toBe(4);
    expect(app.importCollection(decoded!.items)).toEqual({ added: 3, updated: 0, skipped: 0, saved: true });
    expect(app.exportCollection()).toEqual(safari.exportCollection());
    expect(app.importCollection(decoded!.items)).toEqual({ added: 0, updated: 0, skipped: 0, saved: true });
  });

  it('merges into cards already there without removing any', async () => {
    const safari = await storageArea();
    safari.addToCollection(card('SV8a-001', 0.18), 'normal');
    safari.addToCollection(card('SV8a-001', 0.18), 'normal');
    safari.addToCollection(card('SV8a-002', 0.5), 'normal');
    const file = backupFile(safari.exportCollection());

    const app = await storageArea();
    app.addToCollection(card('SV8a-001', 0.2), 'normal');
    app.addToCollection(card('SV8a-009', 3), 'normal');
    const decoded = await decodeBackup(file.text);
    const result = app.importCollection(decoded!.items);
    expect(result).toMatchObject({ added: 1, updated: 1, saved: true });
    const keys = app.exportCollection().map((i) => `${i.key}×${i.qty}`).sort();
    expect(keys).toEqual(['ja:SV8a-001:normal×2', 'ja:SV8a-002:normal×1', 'ja:SV8a-009:normal×1']);
  });
});
