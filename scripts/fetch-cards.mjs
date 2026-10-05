#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const ASSETS_DIR = path.join(ROOT, 'assets');
const CARDS_DIR = path.join(ASSETS_DIR, 'cards');
const SMALL_CARDS_DIR = path.join(ASSETS_DIR, 'cards-small');
const OUTPUT_FILE = path.join(DATA_DIR, 'cards.json');
const ERROR_FILE = path.join(DATA_DIR, 'cards.errors.json');

const neededNames = new Set();

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function collectNames() {
  const aliases = loadJson(path.join(DATA_DIR, 'aliases.json'), {});
  for (const key of Object.keys(aliases)) {
    const values = Array.isArray(aliases[key]) ? aliases[key] : [aliases[key]];
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) neededNames.add(value.trim());
    }
  }

  const decks = loadJson(path.join(DATA_DIR, 'decks.json'), {});
  for (const deckName of Object.keys(decks)) {
    const deck = decks[deckName];
    for (const section of Object.keys(deck)) {
      for (const item of deck[section] || []) {
        if (item && item.card) neededNames.add(item.card);
      }
    }
  }

  const lines = loadJson(path.join(DATA_DIR, 'lines.json'), []);
  for (const line of lines) {
    if (line && line.family) {
      // keep only explicit card names if available later; no guessing here
    }
  }
}

function buildSearchUrl(name) {
  return `https://db.ygoprodeck.com/api/v7/cardinfo.php?name=${encodeURIComponent(name)}`;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'FrogOTK-Learning-App/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.json();
}

async function fetchImage(url, outputPath) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'FrogOTK-Learning-App/1.0'
    }
  });

  if (!response.ok) throw new Error(`Image fetch failed: ${response.status} ${url}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
}

async function main() {
  ensureDir(DATA_DIR);
  ensureDir(CARDS_DIR);
  ensureDir(SMALL_CARDS_DIR);

  collectNames();

  const names = [...neededNames];
  const cards = {};
  const errors = { missingCards: [], missingImages: [] };

  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    await delay(120);

    try {
      const data = await fetchJson(buildSearchUrl(name));
      const card = Array.isArray(data?.data) ? data.data[0] : null;

      if (!card) {
        errors.missingCards.push({ name, reason: 'not found in YGOPRODeck' });
        continue;
      }

      const cardId = String(card.id);
      const fileName = `${cardId}.jpg`;
      const fileNameSmall = `${cardId}-small.jpg`;
      const fullImagePath = path.join(CARDS_DIR, fileName);
      const smallImagePath = path.join(SMALL_CARDS_DIR, fileNameSmall);

      cards[cardId] = {
        id: cardId,
        names: {
          en: card.name || name,
          de: card.name || name
        },
        type: card.type || null,
        subtype: card.race || null,
        attribute: card.attribute || null,
        level: card.level ?? null,
        atk: card.atk ?? null,
        def: card.def ?? null,
        text: {
          en: card.desc || '',
          de: card.desc || ''
        },
        image: fileName,
        imageSmall: fileNameSmall,
        source: 'YGOPRODeck'
      };

      try {
        await fetchImage(card.card_images?.[0]?.image_url || card.card_images?.[0]?.image_url_small, fullImagePath);
      } catch {
        errors.missingImages.push({ id: cardId, name: card.name || name, path: fullImagePath, reason: 'missing full image' });
      }

      try {
        await fetchImage(card.card_images?.[0]?.image_url_small || card.card_images?.[0]?.image_url, smallImagePath);
      } catch {
        errors.missingImages.push({ id: cardId, name: card.name || name, path: smallImagePath, reason: 'missing small image' });
      }
    } catch (error) {
      errors.missingCards.push({ name, reason: String(error.message || error) });
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(cards, null, 2) + '\n');
  fs.writeFileSync(ERROR_FILE, JSON.stringify(errors, null, 2) + '\n');

  console.log(`Fetched ${Object.keys(cards).length} cards.`);
  console.log(`Missing cards: ${errors.missingCards.length}`);
  console.log(`Missing images: ${errors.missingImages.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
