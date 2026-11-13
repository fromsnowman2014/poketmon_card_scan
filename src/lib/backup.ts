// Backups of My Cards: a code to copy and paste, or a file. iOS keeps a separate My Cards for the Home Screen app,
// Safari, each Private tab and each app's built-in browser (store.ts), and no code can merge those: a backup is how
// cards move from one to another, or survive removing the app icon. Nothing here touches storage;
// store.importCollection merges what decodeBackup returns. Photos (store.ts "cc:thumbs") are never included.
import { collectionKey, isCollectionItem } from './store';
import type { CollectionItem } from './types';
import { todayLocal } from './weekChange';

export const BACKUP_APP = 'cardcheck';
export const BACKUP_KIND = 'my-cards';
export const BACKUP_VERSION = 1;

/** What a backup holds: the code and the file carry this same JSON. */
export interface BackupEnvelope {
  app: typeof BACKUP_APP;
  kind: typeof BACKUP_KIND;
  v: typeof BACKUP_VERSION;
  /** When the backup was made, ISO. */
  exportedAt: string;
  items: CollectionItem[];
}

/** A backup read back: its entries as stored (importCollection checks each one) and when it was made. */
export interface DecodedBackup {
  items: unknown[];
  exportedAt?: string;
}

/** The longest text decodeBackup reads (about 5 MB, far more than My Cards can hold). */
export const MAX_BACKUP_CHARS = 5_000_000;
/** The most a compressed code may unpack to, so a tiny code can't make the phone unpack gigabytes. */
const MAX_UNPACKED_BYTES = 10_000_000;
/** Code prefixes: gzip, or plain JSON on a phone without CompressionStream (Safari before 16.4). */
const ZIPPED = 'CC1z:';
const PLAIN = 'CC1:';
/** Where a code starts. A code can't contain ":", so the next prefix also ends the code before it. */
const PREFIX = /CC1(z?):/gi;
/** Characters a code is made of, plus the spaces, line breaks and zero-width spaces chat apps put in. */
const CODE_RUN = /^[A-Za-z0-9\-_+/=\s​-‍⁠]*/;
const GAPS = /[\s​-‍⁠]+/;
/** Text typed after a code ("… thanks"): the last words are dropped one by one, this many times at most. */
const MAX_DROPPED_WORDS = 5;
/** Decoding attempts per call, over every prefix found. */
const MAX_TRIES = 12;
/** The same cap as store.ts puts on one card's count. */
const MAX_QTY = 999;

const isPhoto = (x: unknown) => typeof x === 'string' && x.startsWith('data:');

/** The card as a backup keeps it: pictures by web address only, never a photo. */
function withoutPhotos(item: CollectionItem): CollectionItem {
  if (!isPhoto(item.image) && !isPhoto(item.imageFallback)) return item;
  const copy = { ...item };
  if (isPhoto(copy.image)) delete copy.image;
  if (isPhoto(copy.imageFallback)) delete copy.imageFallback;
  return copy;
}

export function backupEnvelope(items: readonly CollectionItem[], now = new Date()): BackupEnvelope {
  return { app: BACKUP_APP, kind: BACKUP_KIND, v: BACKUP_VERSION, exportedAt: now.toISOString(), items: items.map(withoutPhotos) };
}

// ---------- bytes ----------

function canGzip(): boolean {
  return (
    typeof CompressionStream === 'function' &&
    typeof DecompressionStream === 'function' &&
    typeof Response === 'function' &&
    typeof Blob === 'function' &&
    typeof Blob.prototype.stream === 'function'
  );
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The unpacked bytes, or null: not gzip, cut short, damaged, or bigger than MAX_UNPACKED_BYTES. */
async function gunzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  const reader: ReadableStreamDefaultReader<Uint8Array> = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UNPACKED_BYTES) {
        reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** base64url without padding: letters, digits, "-" and "_" only, so nothing in it reads as punctuation. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x2000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The bytes of a base64url (or standard base64) text; null when it isn't one. */
function fromBase64(text: string): Uint8Array | null {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!b64 || /[^A-Za-z0-9+/]/.test(b64) || b64.length % 4 === 1) return null;
  let binary: string;
  try {
    binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function utf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ---------- making a backup ----------

/**
 * The backup code for My Cards: "CC1z:" + base64url(gzip(JSON)), or "CC1:" + base64url(JSON) where the phone can't
 * compress. Thumbnails/photos are not included.
 */
export async function encodeBackupCode(items: readonly CollectionItem[], now = new Date()): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(backupEnvelope(items, now)));
  if (canGzip()) {
    try {
      return ZIPPED + toBase64Url(await gzip(json));
    } catch {
      // the plain form below works everywhere
    }
  }
  return PLAIN + toBase64Url(json);
}

/** The backup as a file: "cardcheck-my-cards-2026-11-13.json" (today, local time) holding the envelope, indented. */
export function backupFile(
  items: readonly CollectionItem[],
  now = new Date(),
): { name: `cardcheck-my-cards-${string}.json`; text: string } {
  return { name: `cardcheck-my-cards-${todayLocal(now)}.json`, text: `${JSON.stringify(backupEnvelope(items, now), null, 2)}\n` };
}

// ---------- reading one back ----------

function fromEnvelope(x: unknown): DecodedBackup | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const e = x as Record<string, unknown>;
  if (e.app !== BACKUP_APP || e.kind !== BACKUP_KIND || e.v !== BACKUP_VERSION || !Array.isArray(e.items)) return null;
  const at = typeof e.exportedAt === 'string' && !Number.isNaN(Date.parse(e.exportedAt)) ? e.exportedAt : undefined;
  return at ? { items: e.items as unknown[], exportedAt: at } : { items: e.items as unknown[] };
}

interface Candidate {
  zipped: boolean;
  payload: string;
}

/**
 * The codes `text` may hold, most likely first. For each prefix: the code characters after it with every gap
 * removed, then the same without its last word, and so on (words typed after the code).
 */
function* candidates(text: string): Generator<Candidate> {
  const prefixes = [...text.matchAll(PREFIX)];
  for (let p = 0; p < prefixes.length; p++) {
    const start = (prefixes[p].index ?? 0) + prefixes[p][0].length;
    const end = p + 1 < prefixes.length ? (prefixes[p + 1].index ?? text.length) : text.length;
    const run = CODE_RUN.exec(text.slice(start, end))?.[0] ?? '';
    const words = run.split(GAPS).filter(Boolean);
    const zipped = prefixes[p][1] !== '';
    for (let n = words.length; n > 0 && n >= words.length - MAX_DROPPED_WORDS; n--) {
      yield { zipped, payload: words.slice(0, n).join('') };
    }
  }
}

async function unpack({ zipped, payload }: Candidate): Promise<string | null> {
  const bytes = fromBase64(payload);
  if (!bytes) return null;
  const json = zipped ? (canGzip() ? await gunzip(bytes) : null) : bytes;
  return json && utf8(json);
}

/**
 * Reads a backup: a code in either form (spaces and line breaks anywhere are ignored, and so is text around it, like
 * "CardCheck backup: CC1z:…"), or the content of a backup file. Null for anything else: another app's or a newer
 * version's data, a broken or cut-off code, no items array, more than about 5 MB of text. Never throws.
 */
export async function decodeBackup(text: string): Promise<DecodedBackup | null> {
  try {
    if (typeof text !== 'string' || text.length > MAX_BACKUP_CHARS) return null;
    const trimmed = text.replace(/^﻿/, '').trim();
    if (trimmed.startsWith('{')) {
      const file = fromEnvelope(parseJson(trimmed));
      if (file) return file;
    }
    let tries = 0;
    for (const candidate of candidates(text)) {
      if (++tries > MAX_TRIES) break;
      const json = await unpack(candidate);
      const backup = json === null ? null : fromEnvelope(parseJson(json));
      if (backup) return backup;
    }
  } catch {
    // anything unexpected reads as "not a backup"
  }
  return null;
}

/**
 * How many cards (copies) a decoded backup brings, counted the way My Cards counts them (Σ qty) and the way
 * importCollection reads them: valid entries only, one per card and printing.
 */
export function backupCardCount(items: readonly unknown[]): number {
  const qty = new Map<string, number>();
  for (const item of items) {
    if (!isCollectionItem(item)) continue;
    const key = collectionKey(item, item.variant);
    qty.set(key, Math.max(qty.get(key) ?? 0, Math.min(Math.floor(item.qty), MAX_QTY)));
  }
  let total = 0;
  for (const n of qty.values()) total += n;
  return total;
}
