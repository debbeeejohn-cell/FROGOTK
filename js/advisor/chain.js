// Kettenfenster: Der Gegner hat etwas aktiviert (oder im Kampf eine Falle gezogen), der Bot darf antworten.
// Wie in probe.js misst die ENGINE beide Zweige in Probewelten: A = ich antworte mit dieser Karte, P = ich antworte nicht.
// Dadurch sind Kosten, bereits bevorstehende Verluste (mein Tribut stirbt ohnehin) und Kettenreaktionen schon im Ergebnis,
// ohne dass hier eine Kartenregel steht. Dimensionen = A − P (Opportunity Cost).
//
// Der Auslöser wird in der Probewelt nachgespielt, aus öffentlichen Angaben:
//   activation  Der Gegner aktiviert in seinem Zug eine bekannte Zauber-/Fallenkarte (Kettenlänge 1).
//   attack      Der Bot greift an (Angreifer und Ziel wie gemeldet), der Gegner antwortet mit einer bekannten Falle.
// Alles andere (Monstereffekte, längere Ketten, andere Auslöser) ist nicht messbar: der bisherige Bot entscheidet.
// ponytail: Ziele des Gegners wählt die Probewelt nach den Faustregeln des Bots, nicht wie der echte Gegner.
import { newGame, seededRandom, botAnswer, L, P, M, R, IDLE, BATTLE } from '../duel-core.js';
import { botPlay } from '../decide.js';
import { snapshot } from '../lookahead.js';
import { sideState } from './resources.js';
import { measure, compare, combine } from './dimensions.js';
import { sanitize } from './probe.js';

const MAX_STEPS = 120;
const TYPE_SPELL = 2; const TYPE_TRAP = 4;
const MAIN = 4 | 256;
const KEYS = ['raw', 'quality', 'tempo', 'graveyard'];

/** Nachspielbarer Auslöser des aktuellen Kettenfensters, oder null. */
export function stimulusOf(g, table) {
  if (g.chainBy !== g.me || g.chainSize !== 1 || !g.chainCode) return null;
  const type = table.data.get(g.chainCode)?.type ?? 0;
  if (!(type & (TYPE_SPELL | TYPE_TRAP))) return null;
  const common = { code: g.chainCode, trap: !!(type & TYPE_TRAP) };
  if (g.attackBy === g.bot && g.attackInfo) return { kind: 'attack', ...common, attack: g.attackInfo };
  if (g.active === g.me && g.phase & MAIN) return { kind: 'activation', ...common };
  return null;
}

/** Die aktivierte Karte liegt jetzt offen auf dem Feld. Vor dem Auslöser war sie auf der Hand (Zauber) oder gesetzt (Falle). */
export function restage(start, stim) {
  const at = start.cards.findIndex((c) => c.side === 'me' && c.code === stim.code && c.location === L.SZONE && !(c.position & P.FACEDOWN));
  if (at < 0) return null;
  const card = start.cards[at];
  const rest = start.cards.filter((_, i) => i !== at);
  const handCount = rest.filter((c) => c.side === 'me' && c.location === L.HAND).length;
  const staged = stim.trap ? { ...card, position: P.FACEDOWN } : { ...card, location: L.HAND, sequence: handCount, position: P.FACEDOWN };
  return { ...start, cards: [...rest, staged] };
}

/** Eine Probewelt, eine Antwort (code oder null = nichts tun): Zustand vor dem Auslöser und nachdem alles abgewickelt ist. */
export function branchChain(opts, start, stim, answerCode) {
  const { lib, table, scripts } = opts;
  let before = null; let after = null; let failed = false; let answered = false; let activated = false; let targeted = false;
  const snap = (g) => { const v = g.view(); return { own: sideState(v[g.bot], table), foe: sideState(v[g.me], table) }; };
  const toEnd = (m) => (m.type === M.SELECT_BATTLECMD ? { type: R.SELECT_BATTLECMD, action: m.to_ep ? BATTLE.TO_EP : BATTLE.TO_M2, index: null } : { type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null });
  const fail = (m) => { failed = true; return toEnd(m); };

  const botHook = (m, g) => {
    if (m.type === M.SELECT_CHAIN && g.chainBy === g.me && !answered && !m.forced) {
      answered = true;
      if (answerCode == null) return { type: R.SELECT_CHAIN, index: null };
      const index = m.selects.findIndex((c) => c.code === answerCode);
      return index < 0 ? (failed = true, { type: R.SELECT_CHAIN, index: null }) : { type: R.SELECT_CHAIN, index };
    }
    if (stim.kind !== 'attack' || g.turn !== 2) return undefined;
    if (answered && (m.type === M.SELECT_BATTLECMD || m.type === M.SELECT_IDLECMD)) { after = snap(g); return toEnd(m); }
    if (!before && m.type === M.SELECT_IDLECMD) return m.to_bp ? { type: R.SELECT_IDLECMD, action: IDLE.TO_BP, index: null } : fail(m);
    if (!before && m.type === M.SELECT_BATTLECMD) {
      before = snap(g);
      const index = m.attacks.findIndex((c) => c.sequence === stim.attack.from.sequence);
      return index < 0 ? fail(m) : { type: R.SELECT_BATTLECMD, action: BATTLE.SELECT_BATTLE, index };
    }
    if (before && !targeted && m.type === M.SELECT_CARD && stim.attack.to) {
      targeted = true;
      const index = m.selects.findIndex((c) => c.controller === stim.attack.to.controller && c.sequence === stim.attack.to.sequence);
      return index < 0 ? fail(m) : { type: R.SELECT_CARD, indicies: [index] };
    }
    return undefined;
  };

  let g = null;
  try {
    g = newGame({ lib, table, scripts, me: opts.me, bot: opts.bot, start, seed: [1n, 1n, 1n, 1n], botPlays: true, botHook, askAllChains: stim.kind === 'attack', stopTurn: 4 });
    const mirror = Object.assign(Object.create(g), { bot: g.me, me: g.bot });
    for (let i = 0; g.prompt && !after && !failed && i < MAX_STEPS; i += 1) {
      const m = g.prompt;
      let response;
      if (stim.kind === 'activation' && g.turn === 1 && m.type === M.SELECT_IDLECMD) {
        if (!before) {
          before = snap(g);
          const index = m.activates.findIndex((c) => c.code === stim.code);
          if (index < 0) { failed = true; break; }
          activated = true;
          response = { type: R.SELECT_IDLECMD, action: IDLE.SELECT_ACTIVATE, index };
        } else if (activated && answered) { after = snap(g); break; }
      } else if (stim.kind === 'attack' && g.turn === 2 && m.type === M.SELECT_CHAIN && !activated) {
        const index = m.selects.findIndex((c) => c.code === stim.code);
        if (index < 0) { failed = true; break; }
        activated = true;
        response = { type: R.SELECT_CHAIN, index };
      }
      if (!response) {
        const pass = m.type === M.SELECT_CHAIN && !m.forced ? { type: R.SELECT_CHAIN, index: null } : m.type === M.SELECT_EFFECTYN ? { type: R.SELECT_EFFECTYN, yes: false } : null;
        response = g.turn === 1 && stim.kind === 'attack' ? pass ?? botAnswer(m, table, mirror)
          : stim.kind === 'attack' ? pass ?? botAnswer(m, table, mirror) : botPlay(m, table, mirror) || botAnswer(m, table, mirror);
      }
      g.respond(response);
    }
    return before && after && !failed ? { before, after } : null;
  } catch { return null; } finally { g?.close(); }
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const spread = (xs) => { const u = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - u) ** 2))); };

/**
 * Bewertet jede Antwortmöglichkeit des Kettenfensters gegen „nicht antworten“. null = nicht messbar.
 * Ergebnis: { stimulus, candidates: [{ key, label, response, dims, spread, samples, parts, total, worlds }] }
 */
export function evaluateChain(opts, g, m, ctx, { worlds = 4 } = {}) {
  const stim = stimulusOf(g, opts.table);
  if (!stim || m.forced || !m.selects.length) return null;
  const view = sanitize(g.view(), g.me, { foeMain: opts.me.main, foeExtra: opts.me.extra });
  const info = { bot: g.bot, me: g.me, lp: g.lp, botMain: opts.bot.main, meMain: opts.me.main, table: opts.table, weights: ctx.tendencies ?? {} };
  const list = m.selects.map((c, index) => ({ key: `chain:${index}`, label: `Aktivieren ${opts.table.name(c.code)}`, response: { type: R.SELECT_CHAIN, index }, code: c.code }));
  const samples = new Map(list.map((c) => [c.key, []]));
  for (let w = 0; w < worlds; w += 1) {
    const rand = seededRandom([opts.seed[0] ^ BigInt((g.turn * 16 + w) * 3 + 1), ...opts.seed.slice(1)]);
    const start = restage(snapshot(view, info, rand), stim);
    if (!start) return null;
    const pass = branchChain(opts, start, stim, null);
    if (!pass) continue;
    const baseline = measure(pass.before, pass.after, ctx);
    for (const c of list) {
      const a = branchChain(opts, start, stim, c.code);
      if (a) samples.get(c.key).push(compare(measure(a.before, a.after, ctx), baseline));
    }
  }
  const candidates = list.filter((c) => samples.get(c.key).length).map((c) => {
    const s = samples.get(c.key);
    const dims = Object.fromEntries(KEYS.map((k) => [k, mean(s.map((x) => x[k]))]));
    const scored = combine(dims, null, ctx.weights);
    return { ...c, dims, spread: spread(s.map((x) => x.raw)), worlds: s.length, samples: s.map((x) => x.raw), parts: scored.parts, total: scored.total };
  });
  return candidates.length ? { stimulus: { kind: stim.kind, card: opts.table.name(stim.code) }, candidates } : null;
}
