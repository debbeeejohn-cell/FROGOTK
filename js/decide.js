// Bot-Entscheidungen: wählt unter den legalen Aktionen, die die Engine anbietet. Die Regeln bestimmt die Engine.
// Phase 1 des Entscheidungsmoduls: die bisherige Heuristik, unverändert, nur an einen eigenen Ort verschoben.
import { OcgLocation as L, OcgPosition as P, OcgMessageType as M, OcgResponseType as R, SelectIdleCMDAction as IDLE, SelectBattleCMDAction as BATTLE } from '../vendor/ocgcore/index.js';

const ZONES = 5;
const FACEDOWN_GUESS = 1500; // the bot must not peek at my face-down monsters
const TYPE_SPELL = 2; const TYPE_TRAP = 4; const TYPE_CONTINUOUS = 0x20000; const TYPE_FIELD = 0x80000;
const MAX_BACKROW = 3; // do not overcommit into Heavy Storm
const MAX_BOARD_INTO_BACKROW = 3; // ... or into Mirror Force / Torrential Tribute when I have 2+ set cards
const MAX_ACTIONS_PER_TURN = 15; // stops effect loops (e.g. Swap Frog bouncing itself forever)
// Normal Spells the bot may play from its hand, each with the board it needs (foe = my side as seen by the bot).
const SPELL_WHEN = {
  'Allure of Darkness': () => true,
  'Pot of Avarice': () => true,
  'Mystical Space Typhoon': (own, foe) => foe.backrow > 0,
  'Heavy Storm': (own, foe) => foe.backrow >= 2 && foe.backrow > own.backrow,
  'Giant Trunade': (own, foe) => foe.backrow >= 2 && own.backrow === 0,
  'Brain Control': (own, foe) => foe.faceUp > 0
};

/**
 * Simple active bot (rules of thumb, no look-ahead). Returns undefined when it has nothing to do,
 * then botAnswer passes. Its Main Phase, in this order (Blackwing-style tempo, works for any deck):
 *   1. activate Continuous/Field Spells and the Normal Spells in SPELL_WHEN (Black Whirlwind first),
 *   2. Normal Summon the strongest Level 4 or lower monster (triggers Whirlwind),
 *   3. Special Summon whatever the engine offers (Bora, Gale, Dark Armed Dragon, Synchros),
 *   4. use monster effects on the field (Gale, Dark Armed Dragon), 5. set traps, 6. attack.
 * Attack order is always lowest ATK first, so an opposing Gorz gets the smallest token.
 * ponytail: no tribute summons and no per-deck combo plans; add a plan table per deck when needed.
 */
export function botPlay(m, table, g) {
  const view = g.view(); const mine = view[g.bot]; const theirs = view[g.me];
  const foes = theirs.mz.filter(Boolean);
  const data = (c) => table.data.get(c.code);
  if (m.type === M.SELECT_IDLECMD && (g.botActs = (g.botActs ?? 0) + 1) <= MAX_ACTIONS_PER_TURN) {
    const act = (action, index) => ({ type: R.SELECT_IDLECMD, action, index });
    const side = (v) => ({ backrow: v.st.filter(Boolean).length, faceUp: v.mz.filter((c) => c && !(c.position & P.FACEDOWN)).length });
    const own = side(mine); const foe = side(theirs);
    const spell = m.activates.findIndex((c) => c.location === L.HAND && data(c)?.type & TYPE_SPELL
      && (data(c).type & (TYPE_CONTINUOUS | TYPE_FIELD) || SPELL_WHEN[table.name(c.code)]?.(own, foe)));
    if (spell >= 0) return act(IDLE.SELECT_ACTIVATE, spell);
    const level4 = m.summons.map((c, index) => ({ index, d: data(c) })).filter((x) => x.d && x.d.level <= 4);
    if (level4.length) return act(IDLE.SELECT_SUMMON, level4.reduce((a, b) => (b.d.attack > a.d.attack ? b : a)).index);
    const board = mine.mz.filter(Boolean).length;
    if (m.special_summons.length && board < (foe.backrow >= 2 ? MAX_BOARD_INTO_BACKROW : ZONES)) return act(IDLE.SELECT_SPECIAL_SUMMON, 0);
    const effect = m.activates.findIndex((c) => c.location === L.MZONE);
    if (effect >= 0) return act(IDLE.SELECT_ACTIVATE, effect);
    const trap = m.spell_sets.findIndex((c) => data(c)?.type & TYPE_TRAP);
    if (trap >= 0 && own.backrow < MAX_BACKROW) return act(IDLE.SELECT_SPELL_SET, trap);
    if (m.to_bp) return act(IDLE.TO_BP, null);
  }
  const value = (c) => (c.position & P.FACEDOWN ? FACEDOWN_GUESS : c.position & P.DEFENSE ? c.defense : c.attack);
  if (m.type === M.SELECT_BATTLECMD) {
    const weakest = Math.min(...foes.map(value));
    const next = m.attacks.map((c, index) => ({ index, atk: mine.mz[c.sequence]?.attack ?? 0, direct: c.can_direct }))
      .filter((a) => a.direct || a.atk > weakest).sort((a, b) => a.atk - b.atk)[0];
    if (next) { g.botAtk = next.atk; return { type: R.SELECT_BATTLECMD, action: BATTLE.SELECT_BATTLE, index: next.index }; }
  }
  if (m.type === M.SELECT_CARD) {
    const count = Math.min(Math.max(m.min, 1), m.selects.length);
    // Attack target: the strongest monster this attacker still beats.
    if (g.botAtk != null && m.selects.every((c) => c.controller === g.me && c.location === L.MZONE)) {
      const atk = g.botAtk; g.botAtk = null;
      const beat = m.selects.map((c, index) => ({ index, v: value(theirs.mz[c.sequence]) })).filter((t) => t.v < atk).sort((a, b) => b.v - a.v)[0];
      if (beat) return { type: R.SELECT_CARD, indicies: [beat.index] };
    }
    // A choice across both fields is removal (Icarus Attack, Dark Armed Dragon): hit my cards, not its own.
    const sides = new Set(m.selects.map((c) => c.controller));
    if (sides.size === 2) {
      const order = m.selects.map((c, index) => ({ index, own: c.controller === g.bot })).sort((a, b) => a.own - b.own);
      return { type: R.SELECT_CARD, indicies: order.slice(0, count).map((x) => x.index).sort((a, b) => a - b) };
    }
  }
  return undefined;
}

/**
 * Phase 2: Merkmale jeder legalen Aktion aus Sicht von `side`. Die Funktion verändert den Zustand nicht und
 * entscheidet nichts. Sie wird protokolliert, damit Phase 3 (Bewertung) später darauf aufbauen kann.
 * boardGain: ATK, die das Feld dazugewinnt. handCost: Karten, die die Hand verlassen. damage: erwarteter Schaden.
 * risk: verdeckte Karten des Gegners, die auf die Aktion antworten könnten (nur die Anzahl ist öffentlich).
 * Gegnerische verdeckte Monster zählen mit FACEDOWN_GUESS, nicht mit ihren echten Werten.
 */
export function features(m, table, g, side = g.bot) {
  const view = g.view();
  const own = view[side]; const foe = view[1 - side];
  const data = (c) => table.data.get(c.code);
  const hand = (c) => (c.location === L.HAND ? 1 : 0);
  const risk = foe.st.filter((c) => c && c.position & P.FACEDOWN).length;
  const valueOf = (c) => (c.position & P.FACEDOWN ? FACEDOWN_GUESS : c.position & P.DEFENSE ? c.defense : c.attack);
  const foeTop = Math.max(0, ...foe.mz.filter(Boolean).map(valueOf));
  const out = [];
  const add = (kind, index, f) => out.push({ kind, index, boardGain: 0, handCost: 0, damage: 0, risk: 0, ...f });
  if (m.type === M.SELECT_IDLECMD) {
    for (const field of ['summons', 'special_summons']) {
      m[field].forEach((c, i) => add(field, i, { boardGain: data(c)?.attack ?? 0, handCost: hand(c), risk }));
    }
    m.monster_sets.forEach((c, i) => add('monster_sets', i, { boardGain: data(c)?.defense ?? 0, handCost: hand(c) }));
    m.spell_sets.forEach((c, i) => add('spell_sets', i, { handCost: hand(c) }));
    m.activates.forEach((c, i) => add('activates', i, { handCost: hand(c), risk }));
    if (m.to_bp) add('to_bp', null, {});
    if (m.to_ep) add('to_ep', null, {});
  } else if (m.type === M.SELECT_BATTLECMD) {
    m.attacks.forEach((c, i) => {
      const atk = own.mz[c.sequence]?.attack ?? 0;
      add('attacks', i, { damage: c.can_direct ? atk : Math.max(0, atk - foeTop), risk });
    });
    m.chains.forEach((c, i) => add('chains', i, { handCost: hand(c), risk }));
  }
  return out;
}
