// Builds src/data/en-sets.json: [{id, abbr, official, total, name, releaseDate}] for every English TCGdex set.
// The printed abbreviation ("PAR EN 123/182" → sv04) is only exposed by the per-set endpoint, so it is baked in at build time.
// Run: node scripts/build-en-sets.mjs
import { writeFileSync } from 'node:fs';

const API = 'https://api.tcgdex.net/v2/en';
const BATCH = 8;
// TCG Pocket is digital-only: no physical cards to scan, no prices.
const POCKET_ID = /^(A\d+[ab]?|B\d+a?|P-A)$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, attempt = 0) {
  const res = await fetch(url).catch((e) => ({ ok: false, status: 0, error: e }));
  if (res.ok) return res.json();
  // TCGdex sporadically answers 503 "No available server".
  if ((res.status === 0 || res.status >= 500) && attempt < 4) {
    await sleep(500 * 2 ** attempt);
    return getJson(url, attempt + 1);
  }
  throw new Error(`${url}: HTTP ${res.status}`);
}

const list = await getJson(`${API}/sets`);
const ids = [...new Set(list.map((s) => s.id))].filter((id) => !POCKET_ID.test(id));

const details = [];
for (let i = 0; i < ids.length; i += BATCH) {
  const batch = ids.slice(i, i + BATCH);
  details.push(...(await Promise.all(batch.map((id) => getJson(`${API}/sets/${encodeURIComponent(id)}`)))));
}

const sets = details
  .filter((s) => s.serie?.id !== 'tcgp')
  .map((s) => ({
    id: s.id,
    abbr: s.abbreviation?.official ?? null,
    official: s.cardCount?.official ?? 0,
    total: s.cardCount?.total ?? 0,
    name: s.name,
    releaseDate: s.releaseDate ?? '',
  }))
  .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.id.localeCompare(b.id));

writeFileSync(new URL('../src/data/en-sets.json', import.meta.url), JSON.stringify(sets, null, 0).replace(/},{/g, '},\n{') + '\n');
console.log(`wrote ${sets.length} sets (${sets.filter((s) => s.abbr).length} with abbreviation)`);
