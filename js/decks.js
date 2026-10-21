// Shared deck list (data/decks.json) and the remembered deck choice.
// A deck is { name, source?, main, extra, side }, each section [{ card, count }].
import { getStoredSettings, saveSettings } from './store.js';

let cache;

export const loadDecks = () => {
  cache ??= fetch('./data/decks.json').then((res) => {
    if (!res.ok) throw new Error(`decks.json: HTTP ${res.status}`);
    return res.json();
  }).catch((error) => { cache = undefined; throw error; });
  return cache;
};

/** Only decks with a display name are offered for selection. */
export const deckOptions = (decks) => Object.entries(decks)
  .filter(([, deck]) => deck.name)
  .map(([id, deck]) => ({ id, name: deck.name }));

/** The last chosen deck if it still exists, else the first one. */
export function pickDeck(decks) {
  const saved = getStoredSettings().deck;
  return decks[saved]?.name ? saved : deckOptions(decks)[0].id;
}

export const rememberDeck = (id) => saveSettings({ deck: id });

export const deckTotal = (deck, section) => (deck[section] || []).reduce((sum, c) => sum + c.count, 0);
