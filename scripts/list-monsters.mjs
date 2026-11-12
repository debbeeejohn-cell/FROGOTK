#!/usr/bin/env node
// Listet alle Monster der Decks in data/decks.json mit dem Dateinamen für ein eigenes Design (godot/art/sprites/<name>.png).
//   node scripts/list-monsters.mjs            Name, Datei und ob die Datei schon da ist
// Der Dateiname ist derselbe wie CardView.slug() in godot/duel3d/card_view.gd: Kleinbuchstaben, Rest wird "_".
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const json = (file) => JSON.parse(fs.readFileSync(new URL(`data/${file}`, root), 'utf8'));
export const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export function monsterNames(decks, cards) {
  const type = new Map(cards.map((c) => [c.name, c.type]));
  const names = new Set();
  for (const deck of Object.values(decks)) {
    if (!deck.name) continue;
    for (const { card } of [...(deck.main ?? []), ...(deck.extra ?? [])]) if (/Monster/.test(type.get(card) ?? '')) names.add(card);
  }
  return [...names].sort();
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/list-monsters.mjs')) {
  const names = monsterNames(json('decks.json'), json('cards.json').cards);
  let have = 0;
  for (const name of names) {
    const file = `${slug(name)}.png`;
    const there = fs.existsSync(new URL(`godot/art/sprites/${file}`, root));
    if (there) have += 1;
    console.log(`${there ? '✓' : ' '} ${name.padEnd(42)} ${file}`);
  }
  console.log(`\n${names.length} Monster, ${have} mit eigenem Design.`);
}
