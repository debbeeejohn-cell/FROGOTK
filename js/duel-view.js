// Bot Duel, reine Hilfen ohne DOM (testbar in Node): was die Engine anbietet, als Aktionen je Karte, Phasenmenü, Zonenzahlen, Summenregel.
// js/duel.js zeichnet damit das Brett und die Menüs; die Engine bleibt die einzige Regel-Quelle.
import { M, R, IDLE, BATTLE } from './duel-core.js';

export const key = (c) => `${c.controller}:${c.location}:${c.sequence}`;

/** Kurznamen der Phasen für die Anzeige. Der Schadensschritt und die Kampfschritte zählen zur Battle Phase. */
export const PHASE_SHORT = { 1: 'DP', 2: 'SP', 4: 'MP1', 8: 'BP', 16: 'BP', 32: 'BP', 64: 'BP', 128: 'BP', 256: 'MP2', 512: 'EP' };
const PHASE_MENU = [['DP', 'Draw Phase'], ['SP', 'Standby Phase'], ['MP1', 'Main Phase 1'], ['BP', 'Battle Phase'], ['MP2', 'Main Phase 2'], ['EP', 'End Phase']];

/** Aktionen, die die Engine im offenen Spielzustand anbietet, je Karte (Schlüssel controller:location:sequence). */
export function actionsByCard(p, table) {
  const map = new Map();
  const push = (c, label, response) => { if (!map.has(key(c))) map.set(key(c), []); map.get(key(c)).push({ label, response }); };
  const effect = (c) => { const t = table.text(c.description); return t && !t.startsWith('Effekt von') ? `Aktivieren: ${t}` : 'Aktivieren'; };
  if (p?.type === M.SELECT_IDLECMD) {
    [['summons', IDLE.SELECT_SUMMON, 'Normalbeschwören'], ['special_summons', IDLE.SELECT_SPECIAL_SUMMON, 'Spezialbeschwören'],
      ['pos_changes', IDLE.SELECT_POS_CHANGE, 'Position ändern'], ['monster_sets', IDLE.SELECT_MONSTER_SET, 'Monster setzen'],
      ['spell_sets', IDLE.SELECT_SPELL_SET, 'Setzen'], ['activates', IDLE.SELECT_ACTIVATE, null]]
      .forEach(([field, action, label]) => p[field].forEach((c, index) => push(c, label ?? effect(c), { type: R.SELECT_IDLECMD, action, index })));
  }
  if (p?.type === M.SELECT_BATTLECMD) {
    p.attacks.forEach((c, index) => push(c, 'Angreifen', { type: R.SELECT_BATTLECMD, action: BATTLE.SELECT_BATTLE, index }));
    p.chains.forEach((c, index) => push(c, effect(c), { type: R.SELECT_BATTLECMD, action: BATTLE.SELECT_CHAIN, index }));
  }
  return map;
}

/** Phasenwechsel, die die Engine gerade anbietet: Battle Phase, Main Phase 2, Zug beenden. */
export function phaseButtons(p) {
  const b = (label, response, primary) => ({ label, response, primary });
  if (p?.type === M.SELECT_IDLECMD) return [p.to_bp && b('Battle Phase', { type: R.SELECT_IDLECMD, action: IDLE.TO_BP, index: null }), p.to_ep && b('Zug beenden', { type: R.SELECT_IDLECMD, action: IDLE.TO_EP, index: null }, true)].filter(Boolean);
  if (p?.type === M.SELECT_BATTLECMD) return [p.to_m2 && b('Main Phase 2', { type: R.SELECT_BATTLECMD, action: BATTLE.TO_M2, index: null }), p.to_ep && b('Zug beenden', { type: R.SELECT_BATTLECMD, action: BATTLE.TO_EP, index: null }, true)].filter(Boolean);
  return [];
}

/**
 * Menü aller sechs Phasen. `response` gibt es nur für das, was die Engine anbietet (Battle Phase, Main Phase 2, End Phase);
 * der Rest ist angezeigt, aber nicht wählbar. `current` markiert die laufende Phase.
 */
export function phaseMenu(p, phase) {
  const go = Object.fromEntries(phaseButtons(p).map((b) => [b.label, b.response]));
  const response = { BP: go['Battle Phase'], MP2: go['Main Phase 2'], EP: go['Zug beenden'] };
  return PHASE_MENU.map(([id, label]) => ({ id, label, current: PHASE_SHORT[phase] === id, response: response[id] ?? null }));
}

/** Zahlen für die Beschriftungen DECK n / EXTRA n / FH n / VERB. n eines Spielers (aus g.view()[p]). */
export const zoneCounts = (v) => ({ deck: v.deck, extra: v.extra.length, gy: v.gy.length, banished: v.banished.length });

/**
 * Stufensummen (z. B. Machina Fortress): genau das Ziel, oder (select_max = 1) mindestens das Ziel, wobei jede gewählte Karte gebraucht wird.
 * Es zählt der erste Wert der Karte; amount >>> 16 wäre eine alternative Stufe.
 */
export function sumState(p, picked) {
  const lvl = (c) => c.amount & 0xffff;
  const target = p.amount & 0xffff;
  const parts = [...picked].map((i) => lvl(p.selects[i]));
  const total = p.selects_must.reduce((t, c) => t + lvl(c), 0) + parts.reduce((t, n) => t + n, 0);
  const ok = p.select_max ? total >= target && parts.every((n) => total - n < target) : total === target;
  return { total, ok };
}

/** Banner-Texte der Phasen (wie im Godot-Client). Der Schadensschritt hat keinen und bleibt stumm. */
export const PHASE_BANNER = { 'Draw Phase': 'Draw-Phase', 'Standby Phase': 'Standby-Phase', 'Main Phase 1': 'Main-Phase 1', 'Battle Phase': 'Battle-Phase', 'Main Phase 2': 'Main-Phase 2', 'End Phase': 'End-Phase' };

/**
 * Aus neuen Ereignissen (g.events.slice(vorher)) die Schritte für die Animation: Banner je Phasenwechsel (nie zweimal dieselbe Phase
 * hintereinander, wie in Godot) und LP-Änderungen. `lastPhase` ist der zuletzt gezeigte Banner-Text; das Ergebnis liefert den neuen.
 */
export function animationSteps(events, lastPhase = '') {
  const steps = [];
  let last = lastPhase;
  for (const e of events) {
    if (e.type === 'phase') {
      const text = PHASE_BANNER[e.phase];
      if (text && text !== last) { steps.push({ kind: 'banner', text }); last = text; }
    } else if (e.type === 'damage' || e.type === 'pay' || e.type === 'heal') {
      steps.push({ kind: 'lp', change: e.type, side: e.side, amount: e.amount, lp: e.lp });
    }
  }
  return { steps, lastPhase: last };
}

/** Füllstand des LP-Kreises: Anteil von 8000 (oben gedeckelt) und Farbton stufenlos rot (0) → gelb (60) → grün (120). */
export function lpRing(lp) {
  const ratio = Math.max(0, Math.min(1, lp / 8000));
  return { ratio, hue: Math.round(ratio * 120) };
}
