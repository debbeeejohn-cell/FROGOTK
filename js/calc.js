// Hypergeometric calculator: P(draw >= min of every card group) from a deck.
import { esc } from './util.js';
import { parseDecklist } from './decklist.js';

const MAX_DECK = 80;

const choose = (n, k) => {
  if (k < 0n || k > n) return 0n;
  let result = 1n;
  for (let i = 1n; i <= k; i += 1n) result = (result * (n - k + i)) / i;
  return result;
};

// Scale before Number() so huge BigInts keep precision.
const ratio = (part, total) => Number((part * 1_000_000_000n) / total) / 1e9;

/**
 * Chance to draw at least `min` copies of EACH group when drawing `draws` cards
 * from a deck of `deckSize` (groups are disjoint, every other card is a blank).
 * Exact: BigInt counting, one division at the end.
 * groups: [{ copies, min }]
 */
export function chance(deckSize, draws, groups) {
  const N = BigInt(deckSize);
  const n = BigInt(draws);
  const used = groups.reduce((sum, g) => sum + BigInt(g.copies), 0n);
  const blanks = N - used;

  // ways[t] = number of ways to take t cards from the groups so far, each meeting its minimum
  let ways = [1n];
  for (const { copies, min } of groups) {
    const next = Array(ways.length + copies).fill(0n);
    ways.forEach((w, t) => {
      if (w === 0n) return;
      for (let x = min; x <= copies; x += 1) next[t + x] += w * choose(BigInt(copies), BigInt(x));
    });
    ways = next;
  }

  let favourable = 0n;
  ways.forEach((w, t) => { favourable += w * choose(blanks, n - BigInt(t)); });
  return ratio(favourable, choose(N, n));
}

/** P(exactly x copies of one group) for x = 0..min(draws, copies). */
export function distribution(deckSize, draws, copies) {
  const total = choose(BigInt(deckSize), BigInt(draws));
  const rows = [];
  for (let x = 0; x <= Math.min(draws, copies); x += 1) {
    const ways = choose(BigInt(copies), BigInt(x)) * choose(BigInt(deckSize - copies), BigInt(draws - x));
    rows.push({ x, p: ratio(ways, total) });
  }
  return rows;
}

/** Returns an error message or null. */
export function validate(deckSize, draws, groups) {
  if (!Number.isInteger(deckSize) || deckSize < 1 || deckSize > MAX_DECK) return `Deckgröße muss zwischen 1 und ${MAX_DECK} liegen.`;
  if (!Number.isInteger(draws) || draws < 0 || draws > deckSize) return 'Gezogene Karten müssen zwischen 0 und der Deckgröße liegen.';
  if (groups.length === 0) return 'Füge mindestens eine Karte hinzu.';
  for (const g of groups) {
    if (!Number.isInteger(g.copies) || g.copies < 1) return 'Jede Karte braucht mindestens 1 Kopie im Deck.';
    if (!Number.isInteger(g.min) || g.min < 1 || g.min > g.copies) return 'Mindestanzahl muss zwischen 1 und den Kopien im Deck liegen.';
  }
  const used = groups.reduce((sum, g) => sum + g.copies, 0);
  if (used > deckSize) return `Die Kopien (${used}) passen nicht in ein Deck mit ${deckSize} Karten.`;
  return null;
}

/* ---------- UI ---------- */

const pct = (p) => `${(p * 100).toFixed(1).replace('.', ',')}\u00a0%`; // no line break before the %
const sum = (cards) => cards.reduce((total, c) => total + c.count, 0);

const HANDS = [
  [5, 'Erste Hand (5)'],
  [6, 'Zweite Hand (6)'],
  [7, 'Hand + Draw im 2. Zug (7)']
];

/**
 * Returns { setDeck(id, deck) }. The deck comes from the app's deck switch; the user
 * can replace it with an imported decklist/.ydk, which stays until another deck is chosen.
 */
export async function initCalc(root) {
  // Optional card database: turns .ydk passcodes into names and fixes name spelling.
  const cardData = await fetch('./data/cards.json').then((res) => (res.ok ? res.json() : null)).catch(() => null);
  const pool = cardData?.cards ?? [];
  const idToName = new Map(pool.map((c) => [c.id, c.name]));
  const officialName = new Map(pool.map((c) => [c.name.toLowerCase(), c.name]));
  const canon = (name) => officialName.get(name.toLowerCase()) ?? name;

  const state = {
    base: null, deckId: null, deckName: '', cards: [], custom: false,
    deckSize: 40, draws: 5, groups: [], msg: '', msgError: false
  };

  const useCards = (name, cards, custom) => {
    Object.assign(state, { deckName: name, cards, custom, deckSize: sum(cards) });
    const top = cards.reduce((best, c) => (c.count > (best?.count ?? 0) ? c : best), null);
    state.groups = [{ name: top?.card ?? '', copies: top?.count ?? 1, min: 1 }];
  };

  const setMsg = (text, isError = false) => Object.assign(state, { msg: text, msgError: isError });

  const loadFromText = (text, label) => {
    const parsed = parseDecklist(text, { idToName, known: new Set(officialName.keys()) });
    const main = parsed.main.map(({ card, count }) => ({ card: canon(card), count }));
    if (!main.length) {
      setMsg('Keine Karten erkannt. Erwartet wird eine .ydk-Datei oder eine Liste wie „3 Des Frog" pro Zeile.', true);
      return render();
    }
    useCards(label, main, true);
    const total = sum(main);
    const notes = [];
    if (parsed.unknownIds.length) notes.push(`${parsed.unknownIds.length} Kartennummer(n) ohne Namen${pool.length ? '' : ' (Kartendatenbank nicht geladen)'}`);
    const unrecognised = pool.length ? main.filter((c) => !officialName.has(c.card.toLowerCase()) && !c.card.startsWith('Karte #')) : [];
    if (unrecognised.length) notes.push(`nicht im Edison-Kartenpool gefunden (Tippfehler?): ${unrecognised.map((c) => c.card).join(', ')}`);
    if (total < 40 || total > 60) notes.push(`Das Main Deck hat ${total} Karten, im Edison-Format sind 40 bis 60 erlaubt`);
    if (parsed.extra.length || parsed.side.length) notes.push('Extra und Side Deck werden für Hand-Wahrscheinlichkeiten nicht gebraucht');
    setMsg(`„${label}" geladen: ${total} Karten im Main Deck.${notes.length ? ` Hinweis: ${notes.join('; ')}.` : ''}`);
    return render();
  };

  const render = () => {
    const presetOptions = state.cards.map((c, i) => `<option value="${i}">${esc(c.card)} (${c.count}×)</option>`).join('');
    const rows = state.groups.map((g, i) => `
      <li class="calc-row" data-i="${i}">
        <label class="calc-field calc-name">Karte
          <input type="text" data-f="name" value="${esc(g.name)}" placeholder="z. B. Des Frog" />
        </label>
        ${state.cards.length ? `<label class="calc-field">Aus Deck
          <select data-f="preset"><option value="">–</option>${presetOptions}</select>
        </label>` : ''}
        <label class="calc-field">Kopien im Deck
          <input type="number" inputmode="numeric" min="1" data-f="copies" value="${g.copies}" />
        </label>
        <label class="calc-field">Mindestens ziehen
          <input type="number" inputmode="numeric" min="1" data-f="min" value="${g.min}" />
        </label>
        <button type="button" class="ghost-button" data-remove aria-label="Karte ${i + 1} entfernen"${state.groups.length === 1 ? ' disabled' : ''}>Entfernen</button>
      </li>`).join('');

    root.innerHTML = `
      <div class="calc-deck">
        <p class="calc-deckline"><strong>${esc(state.deckName)}</strong> · Main Deck: ${sum(state.cards)} Karten${state.custom ? ' · importiert' : ''}</p>
        <details class="calc-import">
          <summary>Eigenes Deck laden</summary>
          <div class="calc-import-body">
            <label class="calc-field">.ydk- oder .txt-Datei
              <input type="file" id="calcFile" accept=".ydk,.txt,text/plain" />
            </label>
            <label class="calc-field">oder Deckliste einfügen
              <textarea id="calcPaste" rows="7" placeholder="3 Des Frog&#10;2 Dandylion&#10;1 Scapegoat"></textarea>
            </label>
            <div class="calc-import-actions">
              <button type="button" class="secondary-button" id="calcLoad">Deck laden</button>
              ${state.custom && state.base ? `<button type="button" class="ghost-button" id="calcReset">Zurück zu ${esc(state.base.deck.name)}</button>` : ''}
            </div>
            <p class="calc-note">Aus Dueling Nexus, YGOPro oder dem Lexikon (Export) kommt eine .ydk-Datei. Für Namen aus Nummern braucht der Rechner die Kartendatenbank${pool.length ? ' (geladen).' : ' (noch nicht geladen).'}</p>
          </div>
        </details>
        <p class="calc-msg${state.msgError ? ' calc-msg-error' : ''}" role="status">${esc(state.msg)}</p>
      </div>

      <div class="calc-settings">
        <label class="calc-field">Deckgröße
          <input type="number" inputmode="numeric" min="1" max="${MAX_DECK}" id="calcDeck" value="${state.deckSize}" />
        </label>
        <label class="calc-field">Gezogene Karten
          <input type="number" inputmode="numeric" min="0" id="calcDraws" value="${state.draws}" />
        </label>
        <div class="calc-quick" role="group" aria-label="Schnellauswahl Handgröße">
          ${HANDS.map(([n, label]) => `<button type="button" class="secondary-button" data-draws="${n}" aria-pressed="${state.draws === n}">${label}</button>`).join('')}
        </div>
      </div>

      <div id="calcCards"></div>

      <h3 class="calc-heading">Combo: mehrere Karten zusammen</h3>
      <ul class="calc-rows">${rows}</ul>
      <button type="button" class="secondary-button" id="calcAdd">+ Karte hinzufügen</button>
      <div class="calc-result" id="calcResult" role="status" aria-live="polite"></div>`;
    result();
  };

  /** "How likely is it to draw this card?" for every card of the deck. */
  const cardTable = () => {
    const rows = state.cards
      .filter((c) => c.count <= state.deckSize)
      .map((c) => ({
        ...c,
        one: chance(state.deckSize, state.draws, [{ copies: c.count, min: 1 }]),
        two: c.count >= 2 ? chance(state.deckSize, state.draws, [{ copies: c.count, min: 2 }]) : null
      }))
      .sort((a, b) => b.one - a.one || a.card.localeCompare(b.card));
    if (!rows.length) return '';

    const body = rows.map((r, i) => `
      <tr>
        <th scope="row">${esc(r.card)}</th>
        <td>${r.count}×</td>
        <td>${pct(r.one)}</td>
        <td>${r.two == null ? '–' : pct(r.two)}</td>
        <td><button type="button" class="ghost-button calc-add-card" data-add="${i}" aria-label="${esc(r.card)} zur Combo hinzufügen">+ Combo</button></td>
      </tr>`).join('');
    state.tableRows = rows;
    return `
      <h3 class="calc-heading">Jede Karte in den ersten ${state.draws} Karten</h3>
      <div class="table-wrap">
        <table class="lex-table calc-table calc-cards">
          <thead><tr><th scope="col">Karte</th><th scope="col">Kopien</th><th scope="col">mind. 1×</th><th scope="col">mind. 2×</th><th scope="col"><span class="visually-hidden">Aktion</span></th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  };

  const result = () => {
    const box = root.querySelector('#calcResult');
    const tableBox = root.querySelector('#calcCards');
    const groups = state.groups;

    const deckError = validate(state.deckSize, state.draws, [{ copies: 1, min: 1 }]);
    tableBox.innerHTML = deckError ? '' : cardTable();

    const error = validate(state.deckSize, state.draws, groups);
    if (error) {
      box.innerHTML = `<p class="notice notice-error">${esc(error)}</p>`;
      return;
    }

    const label = (g, i) => esc(g.name.trim() || `Karte ${i + 1}`);
    const total = chance(state.deckSize, state.draws, groups);
    const parts = groups.map((g, i) => `<li>${label(g, i)}: mindestens ${g.min}× → <strong>${pct(chance(state.deckSize, state.draws, [g]))}</strong></li>`).join('');

    let table = '';
    if (groups.length === 1) {
      const rows = distribution(state.deckSize, state.draws, groups[0].copies)
        .map(({ x, p }) => `<tr><th scope="row">${x}×</th><td>${pct(p)}</td></tr>`).join('');
      table = `<table class="lex-table calc-table"><thead><tr><th scope="col">Genau</th><th scope="col">Wahrscheinlichkeit</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    box.innerHTML = `
      <p class="calc-big">${pct(total)}</p>
      <p class="calc-sub">${groups.length > 1 ? 'Alle gesuchten Karten zusammen' : 'Wahrscheinlichkeit'} in ${state.draws} gezogenen Karten aus ${state.deckSize}</p>
      ${groups.length > 1 ? `<ul class="calc-parts">${parts}</ul>` : ''}
      ${table}
      <p class="calc-note">Annahme: Die gesuchten Karten sind verschiedene Karten, alle übrigen zählen als Blanks. Ohne Mulligan, ohne Karten wie Pot of Avarice.</p>`;
  };

  root.addEventListener('input', (event) => {
    const t = event.target;
    if (t.id === 'calcDeck') state.deckSize = t.valueAsNumber;
    else if (t.id === 'calcDraws') state.draws = t.valueAsNumber;
    else if (t.dataset.f) {
      const g = state.groups[Number(t.closest('.calc-row').dataset.i)];
      if (t.dataset.f === 'name') g.name = t.value;
      else if (t.dataset.f === 'preset') {
        const card = state.cards[Number(t.value)];
        if (card) { g.name = card.card; g.copies = card.count; g.min = Math.min(g.min, card.count); render(); }
        return;
      } else g[t.dataset.f] = t.valueAsNumber;
    } else return;
    result();
  });

  root.addEventListener('change', async (event) => {
    if (event.target.id !== 'calcFile' || !event.target.files[0]) return;
    const file = event.target.files[0];
    loadFromText(await file.text(), file.name.replace(/\.[^.]+$/, ''));
  });

  root.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    if (btn.dataset.draws) { state.draws = Number(btn.dataset.draws); render(); }
    else if (btn.id === 'calcAdd') { state.groups.push({ name: '', copies: 1, min: 1 }); render(); }
    else if (btn.dataset.remove !== undefined) {
      state.groups.splice(Number(btn.closest('.calc-row').dataset.i), 1);
      render();
    } else if (btn.dataset.add !== undefined) {
      const card = state.tableRows[Number(btn.dataset.add)];
      if (!state.groups.some((g) => g.name === card.card)) {
        const first = state.groups.length === 1 && !state.groups[0].name; // replace the empty starter row
        const entry = { name: card.card, copies: card.count, min: 1 };
        if (first) state.groups[0] = entry; else state.groups.push(entry);
      }
      render();
    } else if (btn.id === 'calcLoad') {
      loadFromText(root.querySelector('#calcPaste').value, 'Eigenes Deck');
    } else if (btn.id === 'calcReset') {
      useCards(state.base.deck.name, state.base.deck.main, false);
      setMsg('');
      render();
    }
  });

  return {
    setDeck(id, deck) {
      state.base = { id, deck };
      if (state.deckId !== id) { // a different deck replaces an imported one
        state.deckId = id;
        useCards(deck.name, deck.main, false);
        setMsg('');
      }
      render();
    }
  };
}
