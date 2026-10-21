#!/usr/bin/env node
// Downloads the Edison card pool from YGOPRODeck ONCE and stores it locally
// (their API guide asks for local storage instead of hotlinking/polling).
//
//   node scripts/fetch-cards.mjs
//
// Writes data/cards.json (all cards up to the Edison cut-off set) and
// assets/cards-small/<id>.jpg for the cards used in decks.json / line-catalog.json.
// YGOPRODECK_API / YGOPRODECK_IMAGES override the hosts (used for offline tests).

import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const API = process.env.YGOPRODECK_API ?? 'https://db.ygoprodeck.com/api/v7';
const IMAGES = process.env.YGOPRODECK_IMAGES ?? 'https://images.ygoprodeck.com/images/cards_small';
// Edison = March 2010 banlist, cards up to and including Duelist Pack: Kaiba.
// The date is looked up from the API instead of being hard-coded.
const CUTOFF_SET = 'Duelist Pack: Kaiba';
const IMAGE_DELAY_MS = 100; // API limit is 20 requests/second

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const IMAGE_DIR = path.join(ROOT, 'assets', 'cards-small');
const OUTPUT_FILE = path.join(DATA_DIR, 'cards.json');

const headers = { 'User-Agent': 'FrogOTK-Learning-App/1.0' };

async function getJson(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Names the app actually shows: every deck card plus every line end board card. */
function neededNames() {
  const names = new Set();
  const decks = readJson(path.join(DATA_DIR, 'decks.json'), {});
  for (const deck of Object.values(decks)) {
    for (const section of Object.values(deck)) {
      if (Array.isArray(section)) section.forEach((item) => item?.card && names.add(item.card));
    }
  }
  const catalog = readJson(path.join(DATA_DIR, 'line-catalog.json'), { lines: [] });
  for (const line of catalog.lines) (line.endBoard || []).forEach((name) => names.add(name));
  return names;
}

async function downloadImage(id) {
  const target = path.join(IMAGE_DIR, `${id}.jpg`);
  if (fs.existsSync(target)) return true; // idempotent: never fetch an image twice
  const response = await fetch(`${IMAGES}/${id}.jpg`, { headers });
  if (!response.ok) return false;
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  return true;
}

async function main() {
  const sets = await getJson(`${API}/cardsets.php`);
  const cutoff = sets.find((set) => set.set_name === CUTOFF_SET);
  if (!cutoff?.tcg_date) throw new Error(`Set "${CUTOFF_SET}" with tcg_date not found in cardsets.php`);
  console.log(`Edison cut-off: ${CUTOFF_SET} (${cutoff.tcg_date})`);

  const { data } = await getJson(`${API}/cardinfo.php?startdate=1999-01-01&enddate=${cutoff.tcg_date}&dateregion=tcg`);
  if (!Array.isArray(data) || data.length === 0) throw new Error('cardinfo.php returned no cards');

  const cards = data
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      race: c.race ?? null,
      attribute: c.attribute ?? null,
      level: c.level ?? null,
      atk: c.atk ?? null,
      def: c.def ?? null,
      desc: c.desc ?? ''
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Images only for cards the app uses, otherwise this would be thousands of downloads.
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const byName = new Map(cards.map((c) => [c.name.toLowerCase(), c]));
  const missing = [];
  let images = 0;
  for (const name of neededNames()) {
    const card = byName.get(name.toLowerCase());
    if (!card) { missing.push(name); continue; }
    await delay(IMAGE_DELAY_MS);
    if (await downloadImage(card.id)) { card.img = 1; images += 1; }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
    source: 'https://db.ygoprodeck.com/api/v7/cardinfo.php',
    pool: `Edison (TCG bis ${CUTOFF_SET}, ${cutoff.tcg_date})`,
    generated: new Date().toISOString().slice(0, 10),
    cards
  }));

  console.log(`Saved ${cards.length} cards, ${images} images.`);
  if (missing.length) console.warn(`WARNING: not in the Edison pool (check names/cut-off): ${missing.join(', ')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
