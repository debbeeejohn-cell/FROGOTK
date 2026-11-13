// Schiedsrichter: spielt Partien Bot gegen den alten Bot (gespiegelt auf meiner Seite) im selben Prozess und prüft jede
// Entscheidung des Bots gegen feste Regeln. Vorlage ist der Lehrer (teach in js/duel-core.js), der nur meine Seite prüft.
//   hart  = klarer Fehler (tödlicher Schaden liegt auf dem Feld und wird nicht genutzt)
//   weich = Hinweis, kann Absicht sein (freier Angriff ausgelassen, Normalbeschwörung nicht genutzt, Zug ohne jede Aktion)
import { newGame, botAnswer, M, IDLE, BATTLE, P } from '../js/duel-core.js';
import { botPlay } from '../js/decide.js';
import { advisorHook } from '../js/advisor/index.js';

export const HARD = 'hart', SOFT = 'weich';
const OFFERS = ['summons', 'special_summons', 'activates', 'spell_sets'];
const sum = (cards, f) => cards.reduce((s, c) => s + f(c), 0);

/** Prüft jede Bot-Entscheidung. check(m, g, resp) vor dem Antworten aufrufen; Funde stehen in found (je Zug und Regel einmal). */
export function referee() {
  const seen = new Set(); const found = [];
  let turn = 0; let acted = false; let offered = false;
  const note = (g, rule, severity, text) => {
    const key = `${g.turn}|${rule}`;
    if (!seen.has(key)) { seen.add(key); found.push({ rule, severity, turn: g.turn, text }); }
  };
  const check = (m, g, resp) => {
    if (g.active !== g.bot || (m.type !== M.SELECT_IDLECMD && m.type !== M.SELECT_BATTLECMD)) return;
    if (g.turn !== turn) { turn = g.turn; acted = false; offered = false; }
    const view = g.view(); const mine = view[g.bot]; const foe = view[g.me]; const foeLp = g.lp[g.me];
    if (m.type === M.SELECT_BATTLECMD) {
      if (resp.action !== BATTLE.TO_M2 && resp.action !== BATTLE.TO_EP) { acted = true; return; }
      const direct = sum((m.attacks ?? []).filter((c) => c.can_direct), (c) => mine.mz[c.sequence]?.attack ?? 0);
      if (direct >= foeLp) note(g, 'tödlicher Schaden', HARD, `Battle Phase verlassen, obwohl ${direct} direkter Schaden gegen ${foeLp} LP möglich war.`);
      return;
    }
    if (OFFERS.some((k) => m[k]?.length)) offered = true;
    if (resp.action !== IDLE.TO_EP) { if (resp.action !== IDLE.TO_BP) acted = true; return; }
    const attackers = mine.mz.filter((c) => c && c.position === P.FACEUP_ATTACK);
    if (m.to_bp && attackers.length && !foe.mz.some(Boolean)) {
      const total = sum(attackers, (c) => c.attack);
      if (total >= foeLp) note(g, 'tödlicher Schaden', HARD, `Zug beendet ohne Battle Phase, obwohl ${total} direkter Schaden gegen ${foeLp} LP möglich war.`);
      else note(g, 'freier Angriff', SOFT, 'Gegner ohne Monster, Angriff möglich, aber keine Battle Phase.');
    }
    if (m.summons?.length) note(g, 'Normalbeschwörung', SOFT, 'Zug beendet mit unbenutzter Normalbeschwörung.');
    if (!acted && offered) note(g, 'leerer Zug', SOFT, 'Zug ohne jede Aktion, obwohl welche angeboten wurden.');
  };
  return { found, check };
}

/** Eine Partie im selben Prozess. variant '' = alter Bot, 'advisor'. Meine Seite spielt nach den Regeln des alten Bots (gespiegelt). */
export function refereedGame(env, meDeck, botDeck, seed, variant = '') {
  const opts = { lib: env.lib, table: env.table, scripts: env.scripts, me: env.deck(meDeck), bot: env.deck(botDeck), seed, botPlays: true, stopTurn: 40 };
  const ref = referee();
  const inner = variant === 'advisor' ? advisorHook(opts, env.weights, { worlds: 2 }) : null;
  opts.botHook = (m, g) => {
    // wie die Engine, nur mit Blick auf die Antwort; 'passiv' = Gegenprobe: tut nichts und beendet den Zug, muss Funde ergeben
    const resp = variant === 'passiv' ? botAnswer(m, env.table, g) : inner?.(m, g) || botPlay(m, env.table, g) || botAnswer(m, env.table, g);
    ref.check(m, g, resp);
    return resp;
  };
  let g = null;
  try {
    g = newGame(opts);
    const mirror = Object.assign(Object.create(g), { bot: g.me, me: g.bot });
    let turn = 0;
    for (let i = 0; g.prompt && i < 3000; i += 1) {
      if (g.turn !== turn) { turn = g.turn; mirror.botActs = 0; }
      g.respond(botPlay(g.prompt, env.table, mirror) || botAnswer(g.prompt, env.table, mirror));
    }
    const winner = g.winner === null ? null : g.winner === g.bot ? 'bot' : g.winner === g.me ? 'me' : 'draw';
    return { meDeck, botDeck, seed, variant, winner, turns: g.turn, findings: ref.found, errors: [...g.errors] };
  } catch (e) {
    return { meDeck, botDeck, seed, variant, winner: null, turns: g?.turn ?? 0, findings: ref.found, errors: [`Ausnahme: ${e.message}`] };
  } finally { g?.close(); }
}

/** Alle Partien: je Paar `n` Seeds, je Variante dieselben Seeds (gepaarter Vergleich). */
export function refereeGames(env, n, pairs, variants = ['', 'advisor']) {
  const out = Object.fromEntries(variants.map((v) => [v, []]));
  for (const v of variants) for (const [meDeck, botDeck] of pairs) for (let i = 0; i < n; i += 1) out[v].push(refereedGame(env, meDeck, botDeck, [BigInt(3000 + i * 11), 1n, 2n, 3n], v));
  return out;
}
