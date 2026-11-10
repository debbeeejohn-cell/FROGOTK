// Bot Duel on a real rules engine: ygopro-core (EDOPro build, vendor/ocgcore) runs the official Lua
// card scripts, so effects, triggers, chains, costs and life points work like on Dueling Nexus/EDOPro.
// This module turns the engine's message stream into a small game state with ONE pending prompt for
// the player. The bot and trivial prompts (zone choice, empty chain windows, sorting) are answered here.
import createCore, {
  OcgDuelMode, OcgLocation as L, OcgPosition as P, OcgProcessResult, OcgQueryFlags as Q,
  OcgMessageType as M, OcgResponseType as R, SelectIdleCMDAction as IDLE, SelectBattleCMDAction as BATTLE
} from '../vendor/ocgcore/index.js';

export { L, P, M, R, IDLE, BATTLE };

let corePromise;
export const loadCore = () => (corePromise ??= createCore({ sync: true }));

const SELECT_TYPES = new Set([
  M.SELECT_BATTLECMD, M.SELECT_IDLECMD, M.SELECT_EFFECTYN, M.SELECT_YESNO, M.SELECT_OPTION, M.SELECT_CARD,
  M.SELECT_CHAIN, M.SELECT_PLACE, M.SELECT_POSITION, M.SELECT_TRIBUTE, M.SORT_CHAIN, M.SELECT_COUNTER,
  M.SELECT_SUM, M.SELECT_DISFIELD, M.SORT_CARD, M.SELECT_UNSELECT_CARD, M.ANNOUNCE_RACE, M.ANNOUNCE_ATTRIB,
  M.ANNOUNCE_CARD, M.ANNOUNCE_NUMBER, M.ROCK_PAPER_SCISSORS
]);
const HINT_SELECTMSG = 3;
const ZONES = 5;
const NO_EFFECT = 'local s,id=GetID()\nfunction s.initial_effect(c) end';
const MAX_BOT_RETRIES = 5;
export const PLACE = { 1: 'Deck', 2: 'Hand', 4: 'Monsterzone', 8: 'Zauber-/Fallenzone', 16: 'Friedhof', 32: 'Verbannt', 64: 'Extra Deck', 128: 'Material', 256: 'Feldzone' };
export const PHASE = { 1: 'Draw Phase', 2: 'Standby Phase', 4: 'Main Phase 1', 8: 'Battle Phase', 16: 'Battle Phase', 32: 'Damage Step', 64: 'Damage Step', 128: 'Battle Phase', 256: 'Main Phase 2', 512: 'End Phase' };

const setcodes = (v) => {
  const out = [];
  for (let s = BigInt(v); s; s >>= 16n) out.push(Number(s & 0xffffn));
  return out;
};

/** data/core-cards.json -> { data: Map(code -> engine card data), name(code), text(description) } */
export function cardTable(json) {
  const data = new Map(); const names = new Map();
  for (const [code, alias, setcode, type, level, attribute, race, atk, def, name] of json.cards) {
    data.set(code, {
      code, alias, setcodes: setcodes(setcode), type, level: level & 0xff, attribute, race: BigInt(race),
      attack: atk, defense: def, lscale: (level >>> 24) & 0xff, rscale: (level >>> 16) & 0xff, link_marker: 0
    });
    names.set(code, name);
  }
  const name = (code) => names.get(code) || (code ? `#${code}` : 'verdeckte Karte');
  // Effect descriptions are aux.Stringid(code, i) = code << 20 | i; code 0 means a system string.
  // %ls placeholders: card name, then its location ("Activate the Trigger Effect of "X" from [Y]?").
  const text = (desc, card = 0, place = '') => {
    const d = BigInt(desc ?? 0);
    const code = Number(d >> 20n); const i = Number(d & 0xfffffn);
    const raw = code ? json.strings[code]?.[i] : json.system[i];
    return (raw || (names.has(code) ? `Effekt von ${name(code)}` : '')).replace('%ls', name(card)).replace('%ls', place);
  };
  return { data, name, text };
}

/** mulberry32 seeded from the duel seed: small deterministic PRNG, only used to shuffle the decks. */
function seededRandom(seed) {
  let a = Number((seed[0] ^ seed[1] ^ seed[2] ^ seed[3]) & 0xffffffffn) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(list, rand) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

const randomSeed = () => Array.from(crypto.getRandomValues(new BigUint64Array(4)), (n) => n || 1n);

/**
 * opts: { lib, table, scripts, me: {main, extra}, bot: {main, extra} (passcode lists),
 *         preset: {monsters, spellTraps} (passcodes), hand (my fixed opening hand, passcodes),
 *         second, seed, askAllChains, botPlays (bot summons, sets traps and attacks) }
 */
export function newGame(opts) {
  const { lib, table, scripts, me, bot, preset = {}, hand = [], second = false } = opts;
  opts.seed ??= randomSeed(); // kept so the same duel can be replayed (undo)
  const ME = second ? 1 : 0; const BOT = 1 - ME;
  const g = {
    me: ME, bot: BOT, lp: [8000, 8000], turn: 0, active: null, phase: 0, winner: null,
    log: [], errors: [], prompt: null, hint: '', error: ''
  };
  const team = (p) => ({ drawCountPerTurn: 1, startingDrawCount: p === ME ? Math.max(0, 5 - hand.length) : 5, startingLP: 8000 });
  const h = lib.createDuel({
    flags: OcgDuelMode.MODE_MR1, // Master Rule 1 = 2010 rules (Edison): first player draws, no Extra Monster Zones
    seed: opts.seed, team1: team(0), team2: team(1),
    cardReader: (code) => table.data.get(code) ?? null,
    // Tokens and Normal Monsters have no script: give them an empty one instead of an engine error.
    scriptReader: (name) => scripts[name] ?? (/^c[1-9]\d*\.lua$/.test(name) ? NO_EFFECT : null),
    errorHandler: (_type, text) => g.errors.push(text)
  });
  if (!h) throw new Error('Engine konnte das Duell nicht anlegen.');
  for (const f of ['constant.lua', 'utility.lua']) lib.loadScript(h, f, scripts[f]);

  const add = (owner, code, location, sequence = 0, position = P.FACEDOWN_DEFENSE) =>
    lib.duelNewCard(h, { team: owner, duelist: 0, code, controller: owner, location, sequence, position });
  // Preset/hand cards come out of the deck when it has them.
  const take = (list, code) => { const at = list.indexOf(code); if (at >= 0) list.splice(at, 1); };
  const myMain = [...me.main]; const botMain = [...bot.main];
  hand.slice(0, 5).forEach((code, i) => { take(myMain, code); add(ME, code, L.HAND, i, P.FACEDOWN); });
  (preset.monsters || []).slice(0, 5).forEach((code, i) => { take(botMain, code); add(BOT, code, L.MZONE, i, P.FACEUP_ATTACK); });
  (preset.spellTraps || []).slice(0, 5).forEach((code, i) => { take(botMain, code); add(BOT, code, L.SZONE, i, P.FACEDOWN); });
  // The engine does not shuffle: decks must arrive shuffled. Seeded, so a replay (undo) deals the same cards.
  const rand = seededRandom(opts.seed);
  for (const [owner, deck] of [[ME, { main: myMain, extra: me.extra }], [BOT, { main: botMain, extra: bot.extra }]]) {
    shuffle(deck.main, rand).forEach((code) => add(owner, code, L.DECK));
    deck.extra.forEach((code) => add(owner, code, L.EXTRA));
  }

  const who = (p) => (p === ME ? 'Du' : 'Bot');
  const say = (line) => { g.log.unshift(line); g.log.length = Math.min(g.log.length, 120); };
  const named = (code) => table.name(code);

  function onMessage(m) {
    switch (m.type) {
      case M.HINT: if (m.hint_type === HINT_SELECTMSG && m.player === ME) g.hint = table.text(m.hint); break;
      case M.NEW_TURN: g.botActs = 0; g.turn += 1; g.active = m.player; say(`— Zug ${g.turn}: ${who(m.player)} —`); break;
      case M.NEW_PHASE: g.phase = m.phase; break;
      case M.DRAW: say(m.player === ME ? `Du ziehst ${m.drawn.map((c) => named(c.code)).join(', ')}` : `Bot zieht ${m.drawn.length} Karte(n)`); break;
      case M.SUMMONING: say(`${who(m.controller)}: Normalbeschwörung ${named(m.code)}`); break;
      case M.SPSUMMONING: say(`${who(m.controller)}: Spezialbeschwörung ${named(m.code)}`); break;
      case M.FLIPSUMMONING: say(`${who(m.controller)}: Flippbeschwörung ${named(m.code)}`); break;
      case M.SET: say(`${who(m.controller)}: setzt ${m.code && m.controller === ME ? named(m.code) : 'eine Karte'}`); break;
      case M.CHAINING: g.chainBy = m.controller; say(`${who(m.controller)}: aktiviert ${named(m.code)}${m.chain_size > 1 ? ` (Kettenglied ${m.chain_size})` : ''}`); break;
      case M.CHAIN_END: g.chainBy = null; break;
      case M.CHAIN_NEGATED: case M.CHAIN_DISABLED: say(`Kettenglied ${m.chain_size} wird annulliert`); break;
      case M.MOVE:
        if ([L.GRAVE, L.REMOVED].includes(m.to.location) || (m.to.location === L.HAND && m.from.location !== L.DECK)
          || ([L.DECK, L.EXTRA].includes(m.to.location) && m.from.location & (L.ONFIELD | L.HAND | L.GRAVE))) {
          say(`${named(m.card)}: ${PLACE[m.from.location] ?? '?'} → ${PLACE[m.to.location] ?? '?'}`);
        }
        break;
      case M.ATTACK: say(`${who(m.card.controller)}: ${named(g.view()[m.card.controller].mz[m.card.sequence]?.code)} greift an${m.target ? '' : ' (direkt)'}`); break;
      case M.DAMAGE: g.lp[m.player] = Math.max(0, g.lp[m.player] - m.amount); say(`${who(m.player)}: −${m.amount} LP (${g.lp[m.player]})`); break;
      case M.PAY_LPCOST: g.lp[m.player] = Math.max(0, g.lp[m.player] - m.amount); say(`${who(m.player)} zahlt ${m.amount} LP (${g.lp[m.player]})`); break;
      case M.RECOVER: g.lp[m.player] += m.amount; say(`${who(m.player)}: +${m.amount} LP (${g.lp[m.player]})`); break;
      case M.LPUPDATE: g.lp[m.player] = m.lp; break;
      case M.WIN: g.winner = m.player; say(m.player === ME ? 'Du gewinnst!' : m.player === BOT ? 'Der Bot gewinnt.' : 'Unentschieden.'); break;
      default:
    }
  }

  // Like Dueling Nexus: only stop for an optional chain when something just happened (summon, attack,
  // an open chain), for simultaneous triggers, or in the bot's End Phase. In my own open Main Phase the
  // same effects are in the action menu anyway. askAllChains stops at every window.
  const EVENTS = new Set([M.SUMMONED, M.SPSUMMONED, M.FLIPSUMMONED, M.ATTACK, M.CHAINING, M.CHAIN_SOLVED, M.SET]);
  let event = false;
  const MAIN = 4 | 256; const END = 512;
  const wantsChain = (m) => opts.askAllChains || m.forced || event || (g.active === BOT && g.phase === END)
    || (m.spe_count > 0 && !(g.active === ME && g.phase & MAIN));

  let retries = 0;
  let last = null;
  function run() {
    for (;;) {
      const status = lib.duelProcess(h);
      for (const m of lib.duelGetMessage(h)) {
        if (SELECT_TYPES.has(m.type)) last = m;
        else if (m.type === M.RETRY) { retries += 1; if (last?.player === ME) g.error = 'Ungültige Auswahl, bitte erneut wählen.'; }
        else { if (EVENTS.has(m.type)) event = true; if (m.type === M.CHAIN_END) event = false; onMessage(m); }
      }
      if (status === OcgProcessResult.END || g.winner !== null) { g.prompt = null; return; }
      if (status !== OcgProcessResult.WAITING) continue;
      if (last.player === BOT) {
        if (retries > MAX_BOT_RETRIES) throw new Error(`Bot hängt bei Engine-Nachricht ${last.type}`);
        lib.duelSetResponse(h, (opts.botPlays && botPlay(last, table, g)) || botAnswer(last, table, g));
        continue;
      }
      const auto = last.type === M.SELECT_CHAIN && !wantsChain(last) ? { type: R.SELECT_CHAIN, index: null } : autoAnswer(last);
      if (auto !== undefined) { lib.duelSetResponse(h, auto); continue; }
      g.prompt = last;
      return;
    }
  }

  g.respond = (response) => {
    teach(g, g.prompt, response, table);
    g.prompt = null; g.error = ''; g.hint = ''; retries = 0; event = false;
    lib.duelSetResponse(h, response);
    run();
  };

  /** Board snapshot per player: hand/mz/st/field/gy/banished/extra (query info or null) + deck count. */
  g.view = () => {
    const flags = Q.CODE | Q.POSITION | Q.ATTACK | Q.DEFENSE; // Q.TYPE breaks the wrapper's parser
    const q = (p, location) => lib.duelQueryLocation(h, { flags, controller: p, location });
    return [0, 1].map((p) => {
      const sz = q(p, L.SZONE);
      return {
        hand: q(p, L.HAND), mz: q(p, L.MZONE).slice(0, 5), st: sz.slice(0, 5), field: sz[5] ?? null,
        gy: q(p, L.GRAVE), banished: q(p, L.REMOVED), extra: q(p, L.EXTRA), deck: lib.duelQueryCount(h, p, L.DECK)
      };
    });
  };
  g.close = () => lib.destroyDuel(h);

  lib.startDuel(h);
  run();
  return g;
}

/**
 * Teacher: when I leave the Battle Phase or end my turn, compare what the engine still offered with
 * what I did. Findings collect in g.pending and are published as g.review when the turn ends.
 * ponytail: fixed rules of thumb, no search for better lines; add checks here as they come up.
 */
function teach(g, p, response, table) {
  if (!p || p.player !== g.me) return;
  const leavesBattle = p.type === M.SELECT_BATTLECMD && (response.action === BATTLE.TO_M2 || response.action === BATTLE.TO_EP);
  const endsTurn = (p.type === M.SELECT_IDLECMD && response.action === IDLE.TO_EP) || (p.type === M.SELECT_BATTLECMD && response.action === BATTLE.TO_EP);
  if (!leavesBattle && !endsTurn) return;
  const notes = (g.pending ??= []);
  const mine = g.view()[g.me]; const foe = g.view()[g.bot];
  const names = (list) => [...new Set(list.map((c) => table.name(c.code)))].slice(0, 3).join(', ');
  if (leavesBattle && p.attacks.length) {
    const direct = p.attacks.filter((c) => c.can_direct).reduce((sum, c) => sum + (mine.mz[c.sequence]?.attack ?? 0), 0);
    notes.push(direct >= g.lp[g.bot] ? `Tödlicher Schaden lag auf dem Feld: ${direct} direkter Schaden gegen ${g.lp[g.bot]} LP.`
      : `Noch nicht angegriffen: ${names(p.attacks)}.`);
  }
  if (p.type === M.SELECT_IDLECMD) {
    const attackers = mine.mz.filter((c) => c && c.position === P.FACEUP_ATTACK);
    if (p.to_bp && attackers.length) {
      const total = attackers.reduce((sum, c) => sum + c.attack, 0);
      notes.push(!foe.mz.some(Boolean) && total >= g.lp[g.bot] ? `Tödlicher Schaden lag auf dem Feld: ${total} direkter Schaden gegen ${g.lp[g.bot]} LP, aber keine Battle Phase.`
        : `Battle Phase übersprungen, obwohl ${names(attackers)} angreifen konnte.`);
    }
    if (p.summons.length) notes.push(`Normalbeschwörung nicht genutzt (möglich: ${names(p.summons)}).`);
  }
  if (endsTurn) {
    if (mine.gy.some((c) => table.name(c.code) === 'Treeborn Frog') && (mine.st.some(Boolean) || mine.field)) {
      notes.push('Treeborn Frog liegt im Friedhof, aber du kontrollierst Zauber-/Fallenkarten: Er kommt in der Standby Phase nicht zurück.');
    }
    g.review = { turn: g.turn, notes: g.pending };
    g.pending = [];
  }
}

/** My own plays in order, taken from the log: the comparable "steps" of a combo. */
export const traceOf = (log) => log.filter((l) => /^Du: (Normalbeschwörung|Spezialbeschwörung|Flippbeschwörung|aktiviert|setzt) /.test(l))
  .reverse().map((l) => l.slice(4));

/**
 * Teacher, part 2: compare my plays with a saved combo. line = { name, hand (cards it needs in the
 * opening hand), trace }. Returns a note, or null when the combo does not fit my opening hand.
 */
export function compareCombo(line, openHand, myTrace) {
  const left = [...openHand];
  for (const card of line.hand) {
    const at = left.indexOf(card);
    if (at < 0) return null;
    left.splice(at, 1);
  }
  const at = line.trace.findIndex((step, i) => myTrace[i] !== step);
  if (at < 0) return `Combo „${line.name}“ vollständig gespielt (${line.trace.length} Schritte).`;
  return `Combo „${line.name}“ war mit deiner Starthand möglich. Abweichung bei Schritt ${at + 1} von ${line.trace.length}: `
    + `erwartet „${line.trace[at]}“, ${myTrace[at] ? `du hast „${myTrace[at]}“ gespielt` : 'du hast nichts mehr gespielt'}.`;
}

/** Zones the engine offers (field_mask bit set = blocked), own side first. */
function places(m) {
  const out = [];
  for (let i = 0; i < 32 && out.length < m.count; i += 1) {
    const b = i % 16;
    if ((m.field_mask >>> i) & 1 || b === 5 || b === 6 || b > 12) continue; // no Extra Monster / pendulum zones in Edison
    out.push({ player: i < 16 ? m.player : 1 - m.player, location: b < 8 ? L.MZONE : L.SZONE, sequence: b % 8 });
  }
  return out;
}

/** Prompts nobody needs to click (Dueling Nexus answers these for you too). undefined = ask the player. */
export function autoAnswer(m) {
  switch (m.type) {
    case M.SELECT_CHAIN: return m.selects.length || m.forced ? undefined : { type: R.SELECT_CHAIN, index: null };
    case M.SELECT_PLACE: return { type: R.SELECT_PLACE, places: places(m) };
    case M.SELECT_DISFIELD: return { type: R.SELECT_DISFIELD, places: places(m) };
    case M.SORT_CARD: case M.SORT_CHAIN: return { type: R.SORT_CARD, order: null };
    case M.SELECT_COUNTER: {
      let left = m.count;
      return { type: R.SELECT_COUNTER, counters: m.cards.map((c) => { const n = Math.min(left, c.count); left -= n; return n; }) };
    }
    case M.ROCK_PAPER_SCISSORS: return { type: R.ROCK_PAPER_SCISSORS, value: 1 };
    default: return undefined;
  }
}

const firstN = (n) => Array.from({ length: n }, (_, i) => i);
const bits = (mask, count) => {
  const out = []; const all = BigInt(mask);
  for (let b = 1n; out.length < count && b <= all; b <<= 1n) if (all & b) out.push(b);
  return out;
};

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

/** Passive bot: never starts anything in its own turn, but always uses what the engine offers it. */
export function botAnswer(m, table, g) {
  const auto = autoAnswer(m);
  if (auto) return auto;
  switch (m.type) {
    case M.SELECT_IDLECMD: return { type: R.SELECT_IDLECMD, action: m.to_ep ? IDLE.TO_EP : IDLE.TO_BP, index: null };
    case M.SELECT_BATTLECMD: return { type: R.SELECT_BATTLECMD, action: m.to_ep ? BATTLE.TO_EP : BATTLE.TO_M2, index: null };
    // Uses whatever the engine offers, but never chains to its own card (e.g. Solemn Judgment on its own trap).
    case M.SELECT_CHAIN: return { type: R.SELECT_CHAIN, index: !m.forced && g?.chainBy === g?.bot ? null : 0 };
    case M.SELECT_EFFECTYN: return { type: R.SELECT_EFFECTYN, yes: true };
    case M.SELECT_YESNO: return { type: R.SELECT_YESNO, yes: true };
    case M.SELECT_OPTION: return { type: R.SELECT_OPTION, index: 0 };
    case M.SELECT_CARD: return { type: R.SELECT_CARD, indicies: firstN(Math.min(Math.max(m.min, 1), m.selects.length)) };
    case M.SELECT_TRIBUTE: return { type: R.SELECT_TRIBUTE, indicies: firstN(Math.min(Math.max(m.min, 1), m.selects.length)) };
    case M.SELECT_UNSELECT_CARD: return { type: R.SELECT_UNSELECT_CARD, index: m.can_finish || !m.select_cards.length ? null : 0 };
    case M.SELECT_SUM: {
      // First subset the engine accepts: exact sum, or (select_max) at least the sum with every card needed.
      const lvl = (c) => c.amount & 0xffff; const target = m.amount & 0xffff;
      const base = m.selects_must.reduce((t, c) => t + lvl(c), 0);
      for (let mask = 1; mask < 1 << Math.min(m.selects.length, 12); mask += 1) {
        const picked = m.selects.map((_, k) => k).filter((k) => mask & (1 << k));
        const total = base + picked.reduce((t, k) => t + lvl(m.selects[k]), 0);
        if (m.select_max ? total >= target && picked.every((k) => total - lvl(m.selects[k]) < target) : total === target) return { type: R.SELECT_SUM, indicies: picked };
      }
      return { type: R.SELECT_SUM, indicies: firstN(m.selects.length) };
    }
    case M.SELECT_POSITION: return { type: R.SELECT_POSITION, position: Number(bits(m.positions, 1)[0]) };
    case M.ANNOUNCE_RACE: return { type: R.ANNOUNCE_RACE, races: bits(m.available, m.count) };
    case M.ANNOUNCE_ATTRIB: return { type: R.ANNOUNCE_ATTRIB, attributes: bits(m.available, m.count).map(Number) };
    case M.ANNOUNCE_NUMBER: return { type: R.ANNOUNCE_NUMBER, value: 0 };
    case M.ANNOUNCE_CARD: return { type: R.ANNOUNCE_CARD, card: [...table.data.keys()][0] };
    default: throw new Error(`Unbekannte Engine-Nachricht ${m.type}`);
  }
}
