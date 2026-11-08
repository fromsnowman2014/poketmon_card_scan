// Builds src/data/pokemon-names.json: [[dexId, en, ko, ja], ...] from PokeAPI's open CSV data.
// Run: node scripts/build-names.mjs
import { writeFileSync } from 'node:fs';

const CSV_URL = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv';
// PokeAPI language ids: 1 = ja-Hrkt (kana), 3 = ko, 9 = en
const LANG = { 1: 'ja', 3: 'ko', 9: 'en' };

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const res = await fetch(CSV_URL);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const text = await res.text();
const rows = text.split(/\r?\n/).slice(1).filter(Boolean);
const map = new Map();
for (const line of rows) {
  const [speciesId, langId, name] = parseCsvLine(line);
  const lang = LANG[Number(langId)];
  if (!lang) continue;
  const id = Number(speciesId);
  if (!map.has(id)) map.set(id, { en: '', ko: '', ja: '' });
  map.get(id)[lang] = name;
}
const list = [...map.entries()]
  .sort((a, b) => a[0] - b[0])
  .filter(([, n]) => n.en)
  .map(([id, n]) => [id, n.en, n.ko, n.ja]);
writeFileSync(new URL('../src/data/pokemon-names.json', import.meta.url), JSON.stringify(list));
console.log(`wrote ${list.length} species`);
