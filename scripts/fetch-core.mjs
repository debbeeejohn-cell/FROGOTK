#!/usr/bin/env node
// Downloads what the duel engine (ygopro-core, EDOPro build) needs for the Bot Duel ONCE:
// card data from ProjectIgnis/BabelCDB and the Lua card scripts from ProjectIgnis/CardScripts
// (the same scripts EDOPro/Dueling Nexus-style simulators run). Needs data/cards.json first.
//
//   node scripts/fetch-core.mjs
//
// Writes data/core-cards.json (card stats, effect strings, system prompt strings) and data/core-scripts.json (Lua sources)
// for every card in decks.json and bot-presets.json. Node >= 22.5 (node:sqlite).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const RAW = 'https://raw.githubusercontent.com/ProjectIgnis';
const DATA = path.join(process.cwd(), 'data');
const headers = { 'User-Agent': 'FrogOTK-Learning-App/1.0' };

async function get(url, as = 'text') {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res[as]();
}
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));

function deckCodes() {
  const ids = new Map(readJson('cards.json').cards.map((c) => [c.name, c.id]));
  const names = new Set();
  for (const deck of Object.values(readJson('decks.json'))) {
    for (const section of ['main', 'extra', 'side']) (deck[section] || []).forEach((c) => names.add(c.card));
  }
  for (const preset of Object.values(readJson('bot-presets.json'))) [...preset.monsters, ...preset.spellTraps].forEach((n) => names.add(n));
  const missing = [...names].filter((n) => !ids.has(n));
  if (missing.length) throw new Error(`Not in data/cards.json: ${missing.join(', ')}`);
  return [...names].map((n) => ids.get(n));
}

async function main() {
  const cdbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cdb-')), 'cards.cdb');
  fs.writeFileSync(cdbFile, Buffer.from(await get(`${RAW}/BabelCDB/master/cards.cdb`, 'arrayBuffer')));
  const db = new DatabaseSync(cdbFile, { readOnly: true });
  const data = db.prepare('SELECT id, alias, setcode, type, level, attribute, race, atk, def FROM datas WHERE id = ?');
  const texts = db.prepare('SELECT * FROM texts WHERE id = ?');
  // A card's tokens use the next passcodes (Scapegoat 73915051 -> Sheep Tokens 73915052-73915055).
  const tokens = db.prepare('SELECT id FROM datas WHERE id > ? AND id <= ? + 20 AND type & 16384');

  // Library scripts: constant.lua + utility.lua and everything they pull in via Duel.LoadScript("...").
  const scripts = {};
  const queue = ['constant.lua', 'utility.lua'];
  while (queue.length) {
    const name = queue.shift();
    if (scripts[name]) continue;
    const dir = name === 'proc_unofficial.lua' ? 'unofficial/' : '';
    scripts[name] = await get(`${RAW}/CardScripts/master/${dir}${name}`);
    for (const [, dep] of scripts[name].matchAll(/LoadScript\("([\w.]+\.lua)"\)/g)) queue.push(dep);
  }

  const cards = {};
  const strings = {};
  const addData = (code) => {
    if (cards[code]) return true;
    const d = data.get(code);
    if (!d) return false;
    const t = texts.get(code);
    cards[code] = [d.id, d.alias, String(d.setcode), d.type, d.level, d.attribute, d.race, d.atk, d.def, t?.name ?? ''];
    const strs = Array.from({ length: 16 }, (_, i) => t?.[`str${i + 1}`] ?? '');
    while (strs.length && !strs.at(-1)) strs.pop();
    if (strs.length) strings[code] = strs;
    return true;
  };

  // Prompt texts like "Select the card(s) to use as Fusion Material" (!system <id> <text>).
  const system = Object.fromEntries([...(await get(`${RAW}/Distribution/master/config/strings.conf`))
    .matchAll(/^!system (\d+) (.+)$/gm)].map(([, id, text]) => [id, text.trim()]));

  const missing = [];
  for (const code of deckCodes()) {
    if (!addData(code)) { missing.push(code); continue; }
    const scriptCode = cards[code][1] || code; // alternate artworks run the original card's script
    const name = `c${scriptCode}.lua`;
    if (scriptCode !== code) addData(scriptCode);
    if (!scripts[name]) {
      const res = await fetch(`${RAW}/CardScripts/master/official/${name}`, { headers });
      if (res.status === 404) continue; // Normal Monsters have no script
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${name}`);
      scripts[name] = await res.text();
    }
    // Tokens and cards an effect names need card data too.
    for (const ref of scripts[name].match(/\b\d{5,9}\b/g) ?? []) addData(Number(ref));
    for (const { id } of tokens.all(code, code)) addData(id);
  }

  fs.writeFileSync(path.join(DATA, 'core-cards.json'), JSON.stringify({
    source: 'https://github.com/ProjectIgnis/BabelCDB (cards.cdb)',
    generated: new Date().toISOString().slice(0, 10),
    cards: Object.values(cards),
    strings,
    system
  }));
  fs.writeFileSync(path.join(DATA, 'core-scripts.json'), JSON.stringify({
    source: 'https://github.com/ProjectIgnis/CardScripts (AGPL-3.0)',
    scripts
  }));
  console.log(`Saved ${Object.keys(cards).length} cards, ${Object.keys(scripts).length} scripts.`);
  if (missing.length) console.warn(`WARNING: not in cards.cdb: ${missing.join(', ')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
