// Loaded with `node --import` by build-ja-prices.test.mjs: fetch() is answered from a folder, so the test can run the
// script with its real address (https://tcgcsv.com) and its real pace without touching the internet.
// FAKE_TCGCSV_DIR: the folder; FAKE_TCGCSV_LOG: a file that gets one "<time in ms> <url>" line per request.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

globalThis.fetch = async (url) => {
  appendFileSync(process.env.FAKE_TCGCSV_LOG, `${Date.now()} ${url}\n`);
  const m = /^https:\/\/tcgcsv\.com\/(?:last-updated\.txt|tcgplayer\/85\/(?:(\d+)\/)?(groups|prices|products))$/.exec(String(url));
  if (!m) throw new Error(`unexpected request: ${url}`);
  const file = path.join(process.env.FAKE_TCGCSV_DIR, !m[2] ? 'last-updated.txt' : m[1] ? `${m[1]}.${m[2]}.json` : 'groups.json');
  // tcgcsv (S3) answers 403 for a file it does not have.
  return existsSync(file) ? new Response(readFileSync(file)) : new Response('AccessDenied', { status: 403 });
};
