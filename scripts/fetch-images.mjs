// Lädt die Kartenbilder des ganzen Edison-Pools (data/edison-db.json) nach assets/cards-small/<id>.jpg
// und setzt in data/cards.json das Flag img=1 für jede Karte, deren Bild vorhanden ist.
// Idempotent: vorhandene Bilder werden nicht erneut geladen. Die Bilder bleiben lokal (.gitignore).
//   node scripts/fetch-images.mjs
import fs from 'node:fs';
import path from 'node:path';

const IMAGES = process.env.YGOPRODECK_IMAGES ?? 'https://images.ygoprodeck.com/images/cards_small';
const DELAY_MS = 100; // YGOPRODeck-Limit: 20 Anfragen/Sekunde
const ROOT = process.cwd();
const DIR = path.join(ROOT, 'assets', 'cards-small');
const CARDS = path.join(ROOT, 'data', 'cards.json');
const headers = { 'User-Agent': 'FrogOTK-Learning-App/1.0' };

const pool = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'edison-db.json'), 'utf8'));
const ids = (pool.cards ?? pool).map((c) => c.id);
fs.mkdirSync(DIR, { recursive: true });

let loaded = 0, failed = 0;
for (const [i, id] of ids.entries()) {
  const target = path.join(DIR, `${id}.jpg`);
  if (!fs.existsSync(target)) {
    try {
      const res = await fetch(`${IMAGES}/${id}.jpg`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
      loaded += 1;
    } catch (e) {
      failed += 1;
      console.warn(`${id}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  if ((i + 1) % 250 === 0) console.log(`${i + 1}/${ids.length} (neu ${loaded}, Fehler ${failed})`);
}

const db = JSON.parse(fs.readFileSync(CARDS, 'utf8'));
let flagged = 0;
for (const card of db.cards) {
  if (fs.existsSync(path.join(DIR, `${card.id}.jpg`)) && !card.img) { card.img = 1; flagged += 1; }
}
fs.writeFileSync(CARDS, JSON.stringify(db)); // gleiches Format wie fetch-cards.mjs (eine Zeile)
console.log(`Fertig: ${loaded} neu geladen, ${failed} Fehler, ${flagged} Flags in cards.json gesetzt.`);
