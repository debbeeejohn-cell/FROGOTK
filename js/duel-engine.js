// Duel board for practice: zones, hand, deck, life points, turns and battle damage.
// There is NO card-effect engine: the player moves cards by hand (summon, send to
// graveyard, ...) and the engine only keeps the board consistent. The bot is passive.
// Every function mutates the game it is given; the UI clones first and drops the clone on error.

export const ZONES = 5;
export const SIDES = ['me', 'bot'];
export const PHASES = ['DP', 'SP', 'MP1', 'BP', 'MP2', 'EP'];
export const NAME = { me: 'Du', bot: 'Bot' };
export const PLACE = {
  hand: 'Hand', deck: 'Deck', extra: 'Extra Deck', gy: 'Friedhof',
  banished: 'Verbannt', mz: 'Monsterzone', st: 'Spell/Falle', field: 'Feldzauber'
};

// Goes to the owner's pile (hand, deck, graveyard, ...); field zones belong to the controller.
const OWNER_PLACES = new Set(['hand', 'deck', 'deckBottom', 'extra', 'gy', 'banished']);

let nextUid = 1;
const card = (name, owner, extra = false) => ({ uid: nextUid++, name, owner, extra, down: false, pos: 'atk' });

export function shuffle(list, rand = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const copies = (section, owner, extra) => (section || [])
  .flatMap(({ card: name, count }) => Array.from({ length: count }, () => card(name, owner, extra)));

function newPlayer(deck, owner, rand) {
  return {
    lp: 8000,
    deck: shuffle(copies(deck.main, owner, false), rand),
    extra: copies(deck.extra, owner, true),
    hand: [],
    mz: Array(ZONES).fill(null),
    st: Array(ZONES).fill(null),
    field: null,
    gy: [],
    banished: []
  };
}

export function log(g, text) {
  g.log.unshift(text);
  g.log.length = Math.min(g.log.length, 80);
}

/**
 * deck: { main, extra } (sections are [{ card, count }]); preset: { monsters, spellTraps } (card names)
 * second: I go second (my first turn includes the draw and attacks are allowed).
 */
export function newDuel({ me, bot, preset = {}, second = true, rand = Math.random }) {
  const g = {
    players: { me: newPlayer(me, 'me', rand), bot: newPlayer(bot, 'bot', rand) },
    turn: second ? 2 : 1, active: 'me', phase: 'MP1', summons: 0, attacked: [],
    noAttack: !second, winner: null, log: []
  };

  // The bot's preset board comes out of its deck (one copy each, if the deck has it).
  const bp = g.players.bot;
  const place = (name, key, down) => {
    const i = bp.deck.findIndex((c) => c.name === name);
    const c = i >= 0 ? bp.deck.splice(i, 1)[0] : card(name, 'bot');
    c.down = down;
    bp[key][bp[key].findIndex((z) => z === null)] = c;
  };
  (preset.monsters || []).slice(0, ZONES).forEach((n) => place(n, 'mz', false));
  (preset.spellTraps || []).slice(0, ZONES).forEach((n) => place(n, 'st', true));

  for (const who of SIDES) g.players[who].hand.push(...g.players[who].deck.splice(0, 5)); // starting hands
  if (second) {
    log(g, 'Zug 1 (Bot): passt');
    draw(g, 'me');
  }
  log(g, `Duell gestartet, Zug ${g.turn}: du bist ${second ? 'zweiter' : 'erster'}`);
  return g;
}

export function locate(g, uid) {
  for (const who of SIDES) {
    const p = g.players[who];
    for (const zone of ['hand', 'deck', 'extra', 'gy', 'banished']) {
      const index = p[zone].findIndex((c) => c.uid === uid);
      if (index >= 0) return { who, zone, index };
    }
    for (const zone of ['mz', 'st']) {
      const index = p[zone].findIndex((c) => c?.uid === uid);
      if (index >= 0) return { who, zone, index };
    }
    if (p.field?.uid === uid) return { who, zone: 'field', index: 0 };
  }
  return null;
}

export function cardOf(g, uid) {
  const loc = locate(g, uid);
  if (!loc) return null;
  const p = g.players[loc.who];
  if (loc.zone === 'field') return p.field;
  return p[loc.zone][loc.index];
}

function detach(g, loc) {
  const p = g.players[loc.who];
  if (loc.zone === 'mz' || loc.zone === 'st') {
    const c = p[loc.zone][loc.index];
    p[loc.zone][loc.index] = null;
    return c;
  }
  if (loc.zone === 'field') {
    const c = p.field;
    p.field = null;
    return c;
  }
  return p[loc.zone].splice(loc.index, 1)[0];
}

/**
 * Moves a card. `to`: hand | deck (top) | deckBottom | extra | gy | banished | mz | st | field.
 * opts: { pos, down, side } - side only matters for zones (taking control of a card).
 */
export function move(g, uid, to, { pos = 'atk', down = false, side } = {}) {
  const loc = locate(g, uid);
  if (!loc) throw new Error('Karte nicht gefunden.');
  const c = detach(g, loc);
  const dest = g.players[OWNER_PLACES.has(to) ? c.owner : (side ?? loc.who)];
  c.down = false;
  c.pos = 'atk';

  if (to === 'mz' || to === 'st') {
    const slot = dest[to].findIndex((z) => z === null);
    if (slot < 0) throw new Error(to === 'mz' ? 'Alle Monsterzonen sind belegt.' : 'Alle Spell-/Fallenzonen sind belegt.');
    c.pos = pos;
    c.down = down;
    dest[to][slot] = c;
  } else if (to === 'field') {
    if (dest.field) dest.gy.push(dest.field); // a new field spell replaces the old one
    c.down = down;
    dest.field = c;
  } else if (to === 'hand') {
    dest.hand.push(c);
  } else if (to === 'deck' || to === 'deckBottom') {
    const pile = c.extra ? dest.extra : dest.deck; // extra deck monsters go back to the extra deck
    if (to === 'deck' && !c.extra) pile.unshift(c); else pile.push(c);
  } else if (to === 'extra') {
    dest.extra.push(c);
  } else if (to === 'gy' || to === 'banished') {
    dest[to].push(c);
  } else {
    throw new Error(`Unbekanntes Ziel "${to}"`);
  }
  log(g, `${NAME[loc.who]}: ${c.name}, ${PLACE[loc.zone]} → ${PLACE[to === 'deckBottom' ? 'deck' : to]}`);
  return c;
}

/** Normal summon / set / special summon of a monster onto my side. */
export function summon(g, uid, mode) {
  if (!cardOf(g, uid)) throw new Error('Karte nicht gefunden.');
  const down = mode === 'set';
  move(g, uid, 'mz', { pos: down || mode === 'ssDef' ? 'def' : 'atk', down, side: 'me' });
  if (mode === 'normal' || mode === 'set') {
    g.summons += 1;
    if (g.summons > 1) log(g, `Hinweis: ${g.summons}. Normalbeschwörung/Setzen in diesem Zug`);
  }
}

export function flip(g, uid) {
  const c = cardOf(g, uid);
  if (!c) throw new Error('Karte nicht gefunden.');
  c.down = false;
  log(g, `${c.name} wird aufgedeckt`);
}

export function togglePos(g, uid) {
  const c = cardOf(g, uid);
  if (!c || c.down) throw new Error('Nur offene Monster ändern die Position.');
  c.pos = c.pos === 'atk' ? 'def' : 'atk';
  log(g, `${c.name}: ${c.pos === 'atk' ? 'Angriffs' : 'Verteidigungs'}position`);
}

export function draw(g, who, n = 1) {
  const p = g.players[who];
  for (let i = 0; i < n; i += 1) {
    if (!p.deck.length) {
      g.winner = who === 'me' ? 'bot' : 'me';
      log(g, `${NAME[who]} kann nicht ziehen: Deck leer`);
      return;
    }
    p.hand.push(p.deck.shift());
  }
  log(g, `${NAME[who]} ${who === 'me' ? 'ziehst' : 'zieht'} ${n} Karte${n > 1 ? 'n' : ''}`);
}

export function shuffleDeck(g, who, rand = Math.random) {
  g.players[who].deck = shuffle(g.players[who].deck, rand);
  log(g, `${NAME[who]}: Deck gemischt`);
}

export function changeLp(g, who, delta) {
  const p = g.players[who];
  p.lp = Math.max(0, p.lp + delta);
  log(g, `${NAME[who]}: ${delta > 0 ? '+' : ''}${delta} LP (${p.lp})`);
  if (p.lp === 0 && !g.winner) g.winner = who === 'me' ? 'bot' : 'me';
}

export function setPhase(g, phase) {
  if (!PHASES.includes(phase)) throw new Error('Unbekannte Phase.');
  g.phase = phase;
}

const destroy = (g, uid) => move(g, uid, 'gy');

/**
 * Attack with one of my monsters. targetUid = null attacks directly.
 * stats(name) -> { atk, def }. Card effects are NOT considered.
 */
export function attack(g, attackerUid, targetUid, stats) {
  const aLoc = locate(g, attackerUid);
  const a = aLoc && cardOf(g, attackerUid);
  if (!a || aLoc.zone !== 'mz') throw new Error('Nur Monster auf dem Feld können angreifen.');
  if (g.noAttack) throw new Error('Im ersten Zug darf nicht angegriffen werden.');
  if (g.phase !== 'BP') throw new Error('Angriffe sind nur in der Battle Phase möglich.');
  if (a.down || a.pos !== 'atk') throw new Error('Nur offene Monster in Angriffsposition können angreifen.');
  if (g.attacked.includes(a.uid)) throw new Error('Dieses Monster hat in diesem Zug schon angegriffen.');

  const foe = aLoc.who === 'me' ? 'bot' : 'me';
  const A = stats(a.name).atk;

  if (targetUid == null) {
    if (g.players[foe].mz.some(Boolean)) throw new Error('Direkter Angriff nur, wenn der Gegner kein Monster kontrolliert.');
    g.attacked.push(a.uid);
    log(g, `${a.name} greift direkt an`);
    changeLp(g, foe, -A);
    return;
  }

  const tLoc = locate(g, targetUid);
  const t = tLoc && cardOf(g, targetUid);
  if (!t || tLoc.zone !== 'mz' || tLoc.who !== foe) throw new Error('Ungültiges Angriffsziel.');
  g.attacked.push(a.uid);
  log(g, `${a.name} greift ${t.name} an`);
  if (t.down) flip(g, t.uid);

  if (t.pos === 'atk') {
    const diff = A - stats(t.name).atk;
    if (diff > 0) { destroy(g, t.uid); changeLp(g, foe, -diff); }
    else if (diff < 0) { destroy(g, a.uid); changeLp(g, aLoc.who, diff); }
    else { destroy(g, t.uid); destroy(g, a.uid); }
  } else {
    const diff = A - stats(t.name).def;
    if (diff > 0) destroy(g, t.uid);
    else if (diff < 0) changeLp(g, aLoc.who, diff);
  }
}

/** Ends my turn. The passive bot draws and passes, then my next turn starts. */
export function endTurn(g) {
  log(g, `Zug ${g.turn} (Du) beendet`);
  g.turn += 1;
  g.active = 'bot';
  draw(g, 'bot');
  log(g, `Zug ${g.turn} (Bot): passt`);
  g.turn += 1;
  g.active = 'me';
  g.phase = 'MP1';
  g.summons = 0;
  g.attacked = [];
  g.noAttack = false;
  draw(g, 'me');
}
