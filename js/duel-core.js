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

const randomSeed = () => Array.from(crypto.getRandomValues(new BigUint64Array(4)), (n) => n || 1n);

/**
 * opts: { lib, table, scripts, me: {main, extra}, bot: {main, extra} (passcode lists),
 *         preset: {monsters, spellTraps} (passcodes), hand (my fixed opening hand, passcodes),
 *         second, seed, askAllChains }
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
  for (const [owner, deck] of [[ME, { main: myMain, extra: me.extra }], [BOT, { main: botMain, extra: bot.extra }]]) {
    deck.main.forEach((code) => add(owner, code, L.DECK));
    deck.extra.forEach((code) => add(owner, code, L.EXTRA));
  }

  const who = (p) => (p === ME ? 'Du' : 'Bot');
  const say = (line) => { g.log.unshift(line); g.log.length = Math.min(g.log.length, 120); };
  const named = (code) => table.name(code);

  function onMessage(m) {
    switch (m.type) {
      case M.HINT: if (m.hint_type === HINT_SELECTMSG && m.player === ME) g.hint = table.text(m.hint); break;
      case M.NEW_TURN: g.turn += 1; g.active = m.player; say(`— Zug ${g.turn}: ${who(m.player)} —`); break;
      case M.NEW_PHASE: g.phase = m.phase; break;
      case M.DRAW: say(m.player === ME ? `Du ziehst ${m.drawn.map((c) => named(c.code)).join(', ')}` : `Bot zieht ${m.drawn.length} Karte(n)`); break;
      case M.SUMMONING: say(`${who(m.controller)}: Normalbeschwörung ${named(m.code)}`); break;
      case M.SPSUMMONING: say(`${who(m.controller)}: Spezialbeschwörung ${named(m.code)}`); break;
      case M.FLIPSUMMONING: say(`${who(m.controller)}: Flippbeschwörung ${named(m.code)}`); break;
      case M.SET: say(`${who(m.controller)}: setzt ${m.code && m.controller === ME ? named(m.code) : 'eine Karte'}`); break;
      case M.CHAINING: say(`${who(m.controller)}: aktiviert ${named(m.code)}${m.chain_size > 1 ? ` (Kettenglied ${m.chain_size})` : ''}`); break;
      case M.CHAIN_NEGATED: case M.CHAIN_DISABLED: say(`Kettenglied ${m.chain_size} wird annulliert`); break;
      case M.MOVE:
        if ([L.GRAVE, L.REMOVED].includes(m.to.location) || (m.to.location === L.HAND && m.from.location !== L.DECK)
          || ([L.DECK, L.EXTRA].includes(m.to.location) && m.from.location & (L.ONFIELD | L.HAND | L.GRAVE))) {
          say(`${named(m.card)}: ${PLACE[m.from.location] ?? '?'} → ${PLACE[m.to.location] ?? '?'}`);
        }
        break;
      case M.ATTACK: say(`Angriff${m.target ? '' : ' (direkt)'}`); break;
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
        lib.duelSetResponse(h, botAnswer(last, table));
        continue;
      }
      const auto = last.type === M.SELECT_CHAIN && !wantsChain(last) ? { type: R.SELECT_CHAIN, index: null } : autoAnswer(last);
      if (auto !== undefined) { lib.duelSetResponse(h, auto); continue; }
      g.prompt = last;
      return;
    }
  }

  g.respond = (response) => {
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

/** Passive bot: never starts anything in its own turn, but always uses what the engine offers it. */
export function botAnswer(m, table) {
  const auto = autoAnswer(m);
  if (auto) return auto;
  switch (m.type) {
    case M.SELECT_IDLECMD: return { type: R.SELECT_IDLECMD, action: m.to_ep ? IDLE.TO_EP : IDLE.TO_BP, index: null };
    case M.SELECT_BATTLECMD: return { type: R.SELECT_BATTLECMD, action: m.to_ep ? BATTLE.TO_EP : BATTLE.TO_M2, index: null };
    case M.SELECT_CHAIN: return { type: R.SELECT_CHAIN, index: 0 };
    case M.SELECT_EFFECTYN: return { type: R.SELECT_EFFECTYN, yes: true };
    case M.SELECT_YESNO: return { type: R.SELECT_YESNO, yes: true };
    case M.SELECT_OPTION: return { type: R.SELECT_OPTION, index: 0 };
    case M.SELECT_CARD: return { type: R.SELECT_CARD, indicies: firstN(Math.min(Math.max(m.min, 1), m.selects.length)) };
    case M.SELECT_TRIBUTE: return { type: R.SELECT_TRIBUTE, indicies: firstN(Math.min(Math.max(m.min, 1), m.selects.length)) };
    case M.SELECT_UNSELECT_CARD: return { type: R.SELECT_UNSELECT_CARD, index: m.can_finish || !m.select_cards.length ? null : 0 };
    case M.SELECT_SUM: {
      let sum = m.selects_must.reduce((s, c) => s + (c.amount & 0xffff), 0); const picked = [];
      for (let i = 0; i < m.selects.length && sum < m.amount; i += 1) { picked.push(i); sum += m.selects[i].amount & 0xffff; }
      return { type: R.SELECT_SUM, indicies: picked };
    }
    case M.SELECT_POSITION: return { type: R.SELECT_POSITION, position: Number(bits(m.positions, 1)[0]) };
    case M.ANNOUNCE_RACE: return { type: R.ANNOUNCE_RACE, races: bits(m.available, m.count) };
    case M.ANNOUNCE_ATTRIB: return { type: R.ANNOUNCE_ATTRIB, attributes: bits(m.available, m.count).map(Number) };
    case M.ANNOUNCE_NUMBER: return { type: R.ANNOUNCE_NUMBER, value: 0 };
    case M.ANNOUNCE_CARD: return { type: R.ANNOUNCE_CARD, card: [...table.data.keys()][0] };
    default: throw new Error(`Unbekannte Engine-Nachricht ${m.type}`);
  }
}
