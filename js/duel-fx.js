// Bot Duel, Animationen: Phasen-Banner und LP-Kreis aus den Schritten von animationSteps (js/duel-view.js).
// Läuft in einer Ebene (.dl-fx) außerhalb des Spielfelds, denn render() ersetzt das Feld bei jeder Antwort.
// Der Aufrufer sperrt währenddessen die Eingaben; skip() beendet alles sofort (der Endzustand steht schon im Feld).
import { lpRing } from './duel-view.js';

const SHOW = { banner: [100, 350, 120], tweenLp: 600, pop: 1000 }; // ms: Banner ein, halten, aus; LP-Zählen; schwebende Zahl
const POP_COLOR = { damage: '#ff5a4d', pay: '#ff9933', heal: '#66ff80' };

/** Tempo-Faktor aus der Einstellung „Animationen“ und dem System: 1 = voll, 0,5 = reduziert, 0 = aus. */
export function speed() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  const mode = document.documentElement.dataset.animMode;
  return mode === 'off' ? 0 : mode === 'reduced' ? 0.5 : 1;
}

export function createFx(root) {
  const layer = root.querySelector('.dl-fx');
  const stops = new Set(); // laufende Animationen: jede Funktion beendet ihre sofort
  let running = false;
  let skipped = false;

  const hold = (el, frames, ms) => new Promise((done) => {
    const a = el.animate(frames, { duration: ms, easing: 'ease-out', fill: 'forwards' });
    const stop = () => { stops.delete(stop); a.finish(); done(); };
    stops.add(stop);
    a.onfinish = stop;
  });
  const tween = (ms, step) => new Promise((done) => {
    const t0 = performance.now();
    const stop = () => { if (!stops.delete(stop)) return; step(1); done(); };
    stops.add(stop);
    const frame = (now) => {
      if (!stops.has(stop)) return;
      const t = Math.min(1, (now - t0) / ms);
      step(1 - (1 - t) ** 3); // ease-out
      if (t < 1) requestAnimationFrame(frame); else stop();
    };
    requestAnimationFrame(frame);
  });

  const ring = (side) => root.querySelector(`.dl-lp[data-lp="${side}"] .dl-ring`);
  /** Zahl, Bogen und Farbe des Kreises auf einen LP-Wert setzen. */
  function setRing(side, lp) {
    const el = ring(side);
    if (!el) return;
    const { ratio, hue } = lpRing(lp);
    el.style.setProperty('--ratio', ratio);
    el.style.setProperty('--hue', hue);
    el.querySelector('strong').textContent = Math.round(lp);
  }

  async function banner(text, f) {
    const [inMs, holdMs, outMs] = SHOW.banner.map((ms) => ms * f);
    const el = Object.assign(document.createElement('div'), { className: 'dl-banner', textContent: text });
    const stage = root.querySelector('.dl-stage')?.getBoundingClientRect(); // mittig über dem Spielfeld, nicht über dem Fenster
    if (stage) el.style.cssText = `left:${stage.left + stage.width / 2}px;top:${stage.top + stage.height / 2}px`;
    layer.append(el);
    const total = inMs + holdMs + outMs;
    await hold(el, [{ opacity: 0 }, { opacity: 1, offset: inMs / total }, { opacity: 1, offset: (inMs + holdMs) / total }, { opacity: 0 }], total);
    el.remove();
  }

  async function lpStep(s, f) {
    const el = ring(s.side);
    if (!el) return;
    const from = Number(el.querySelector('strong').textContent);
    const box = el.getBoundingClientRect();
    const pop = Object.assign(document.createElement('div'), { className: 'dl-pop', textContent: `${s.change === 'heal' ? '+' : '−'}${s.amount}` });
    pop.style.cssText = `left:${box.left - 8}px;top:${box.top + box.height / 2 - 16}px;color:${POP_COLOR[s.change]}`; // links neben dem Kreis, die Zahl im Kreis bleibt lesbar
    layer.append(pop);
    const float = hold(pop, [{ transform: 'translate(-100%, 0)', opacity: 1 }, { transform: 'translate(-100%, -36px)', opacity: 1, offset: 0.6 }, { transform: 'translate(-100%, -48px)', opacity: 0 }], SHOW.pop * f);
    await tween(SHOW.tweenLp * f, (t) => setRing(s.side, from + (s.lp - from) * t));
    await float;
    pop.remove();
  }

  return {
    busy: () => running,
    skip() { skipped = true; [...stops].forEach((stop) => stop()); },
    /** Spielt die Schritte nacheinander. lpBefore/lpAfter: { me, bot }. Gibt sofort zurück, wenn das Tempo 0 ist. */
    async play(steps, lpBefore, lpAfter) {
      const f = speed();
      if (!f || !steps.length) return;
      running = true; skipped = false;
      setRing('me', lpBefore.me); setRing('bot', lpBefore.bot); // erst der alte Stand, der Kreis zählt dann herunter
      try {
        for (const s of steps) {
          if (skipped) break;
          await (s.kind === 'banner' ? banner(s.text, f) : lpStep(s, f));
        }
      } finally {
        setRing('me', lpAfter.me); setRing('bot', lpAfter.bot);
        layer.replaceChildren(); stops.clear(); running = false;
      }
    }
  };
}
