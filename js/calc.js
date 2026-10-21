// Hypergeometric calculator: P(draw >= min of every card group) from a deck.

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

const esc = (value) => String(value).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const pct = (p) => `${(p * 100).toFixed(1).replace('.', ',')} %`;

const HANDS = [
  [5, 'Erste Hand (5)'],
  [6, 'Zweite Hand (6)'],
  [7, 'Hand + Draw im 2. Zug (7)']
];

export async function initCalc(root) {
  let cards = [];
  try {
    const res = await fetch('./data/decks.json');
    if (res.ok) cards = (await res.json()).frogOtk.main;
  } catch {
    // presets are optional, manual input still works
  }

  const mainSize = cards.reduce((sum, c) => sum + c.count, 0) || 40;
  const state = { deckSize: mainSize, draws: 5, groups: [{ name: '', copies: 3, min: 1 }] };

  const render = () => {
    const presetOptions = cards.map((c, i) => `<option value="${i}">${esc(c.card)} (${c.count}×)</option>`).join('');
    const rows = state.groups.map((g, i) => `
      <li class="calc-row" data-i="${i}">
        <label class="calc-field calc-name">Karte
          <input type="text" data-f="name" value="${esc(g.name)}" placeholder="z. B. Des Frog" />
        </label>
        ${cards.length ? `<label class="calc-field">Aus Deck
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
      <h3 class="calc-heading">Gesuchte Karten</h3>
      <ul class="calc-rows">${rows}</ul>
      <button type="button" class="secondary-button" id="calcAdd">+ Karte hinzufügen</button>
      <div class="calc-result" id="calcResult" role="status" aria-live="polite"></div>`;
    result();
  };

  const result = () => {
    const box = root.querySelector('#calcResult');
    const groups = state.groups;
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
        const card = cards[Number(t.value)];
        if (card) { g.name = card.card; g.copies = card.count; g.min = Math.min(g.min, card.count); render(); }
        return;
      } else g[t.dataset.f] = t.valueAsNumber;
    }
    result();
  });

  root.addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    if (btn.dataset.draws) { state.draws = Number(btn.dataset.draws); render(); }
    else if (btn.id === 'calcAdd') { state.groups.push({ name: '', copies: 1, min: 1 }); render(); }
    else if (btn.dataset.remove !== undefined) {
      state.groups.splice(Number(btn.closest('.calc-row').dataset.i), 1);
      render();
    }
  });

  render();
}
