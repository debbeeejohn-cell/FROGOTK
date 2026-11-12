#!/usr/bin/env node
// Eigene Edison-Kartenbank: alle Karten aus data/cards.json, die im Edison-Format gespielt werden dürfen.
// cards.json enthält schon nur Karten bis zum Edison-Stichtag (scripts/fetch-cards.mjs) und die Edison-Texte.
// Hier kommen die verbotenen Karten raus; begrenzte Karten bleiben drin und werden markiert.
//   node --no-warnings scripts/build-edison-db.mjs
// Schreibt data/edison-db.json. Nur Daten (Name, Typ, Werte, Text): keine Bilder, keine Konami-Grafik.
// ponytail: Die Banlist stammt von edisonformat.net und ist nicht gegen das Konami-Original geprüft.

import fs from 'node:fs';
import path from 'node:path';

const DATA = path.join(process.cwd(), 'data');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));

export function buildEdisonDb(cards, banlist) {
  const forbidden = new Set(banlist.forbidden);
  const limited = new Set(banlist.limited);
  const semi = new Set(banlist.semiLimited);
  const missing = banlist.forbidden.filter((name) => !cards.some((c) => c.name === name));
  const playable = cards
    .filter((c) => !forbidden.has(c.name))
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      race: c.race,
      attribute: c.attribute,
      level: c.level,
      atk: c.atk,
      def: c.def,
      desc: c.desc,
      limit: limited.has(c.name) ? 'limited' : semi.has(c.name) ? 'semiLimited' : null
    }));
  return { cards: playable, excludedForbidden: cards.length - playable.length, notInCardData: missing };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/build-edison-db.mjs')) {
  const { cards } = readJson('cards.json');
  const { cards: playable, excludedForbidden, notInCardData } = buildEdisonDb(cards, readJson('edison-banlist.json'));
  fs.writeFileSync(path.join(DATA, 'edison-db.json'), JSON.stringify({
    source: 'data/cards.json (Edison-Stichtag, YGOPRODeck) minus data/edison-banlist.json (forbidden)',
    generated: new Date().toISOString().slice(0, 10),
    cards: playable
  }, null, 1) + '\n');
  console.log(`${playable.length} Edison-Karten gespeichert, ${excludedForbidden} verbotene entfernt.`);
  if (notInCardData.length) console.warn(`Verboten, aber nicht in cards.json: ${notInCardData.join(', ')}`);
}
