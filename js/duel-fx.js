// Bot Duel, Animationen aus den Schritten von animationSteps (js/duel-view.js): Phasen-Banner, LP-Kreis, wandernde Karten,
// Beschwörungs-Show, Effekt-Aktivierung, Angriff mit Wackeln. Läuft in einer Ebene (.dl-fx) außerhalb des Spielfelds, denn render()
// ersetzt das Feld bei jeder Antwort. Das Feld zeigt dabei schon den Endzustand; die Karten am Ziel bleiben bis zur Landung unsichtbar.
// Der Aufrufer sperrt währenddessen die Eingaben; skip() beendet alles sofort.
import { lpRing, zoneKey } from './duel-view.js';

// ms bei vollem Tempo: Banner (ein, halten, aus), LP-Zählen, schwebende Zahl, Flug, Aktivierung (groß, halten, aus), Angriff (hin, zurück), Show, Wackeln
const MS = { banner: [100, 350, 120], lp: 600, pop: 1000, fly: 250, chain: [300, 600, 200], attack: [200, 300], show: [150, 700, 200], shake: 260 };
const POP_COLOR = { damage: '#ff5a4d', pay: '#ff9933', heal: '#66ff80' };
const CARD = { w: 64, h: 93 }; // Größe einer Karte, wenn nur die Hand als Ganzes da ist

/** Tempo-Faktor aus der Einstellung „Animationen“ und dem System: 1 = voll, 0,5 = reduziert, 0 = aus. */
export function speed() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  const mode = document.documentElement.dataset.animMode;
  return mode === 'off' ? 0 : mode === 'reduced' ? 0.5 : 1;
}

export function createFx(root) {
  const layer = root.querySelector('.dl-fx');
  const stops = new Set(); // laufende Animationen: jede Funktion beendet ihre sofort
  const hidden = new Set(); // Karten am Ziel, die bis zur Landung unsichtbar sind
  let running = false;
  let skipped = false;

  // ---------- Bausteine ----------
  const pause = (ms) => new Promise((done) => {
    if (skipped) return done();
    let timer;
    const stop = () => { clearTimeout(timer); stops.delete(stop); done(); };
    timer = setTimeout(stop, ms);
    stops.add(stop);
  });
  const go = (el, frames, ms, easing = 'ease-out') => new Promise((done) => {
    if (skipped) return done();
    const a = el.animate(frames, { duration: Math.max(1, ms), easing, fill: 'forwards' });
    const stop = () => { stops.delete(stop); a.finish(); done(); };
    stops.add(stop);
    a.onfinish = stop;
  });
  const tween = (ms, step) => new Promise((done) => {
    if (skipped) { step(1); return done(); }
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
  const hide = (el) => { if (el) { el.style.visibility = 'hidden'; hidden.add(el); } };
  const reveal = (el) => { if (el) { el.style.visibility = ''; hidden.delete(el); } };

  // ---------- Elemente finden (data-z: Spieler:Ort:Platz oder Spieler:Stapel) ----------
  const at = (key) => (key ? root.querySelector(`[data-z="${key}"]`) : null);
  const cardIn = (el) => (el?.matches('.dl-card, .dl-back') ? el : el?.querySelector('.dl-card'));
  const ring = (side) => root.querySelector(`.dl-lp[data-lp="${side}"] .dl-ring`);
  function rectOf(key, side) {
    const el = at(key);
    if (el) return el.getBoundingClientRect();
    if (key.split(':')[1] === '2') { // Handplatz, den es nach dem Zug nicht mehr gibt: Mitte der Hand
      const hand = root.querySelector(side === 'me' ? '.dl-hand' : '.dl-handrow')?.getBoundingClientRect();
      if (hand) return new DOMRect(hand.left + hand.width / 2 - CARD.w / 2, hand.top + hand.height / 2 - CARD.h / 2, CARD.w, CARD.h);
    }
    return null;
  }
  /** Bild der Karte für einen Geist: Kopie der fertigen Karte am Ziel, sonst Name aus den Kartendaten, sonst Rückseite. */
  function ghostOf(real, name, c) {
    if (real) {
      const copy = real.cloneNode(true);
      copy.style.visibility = '';
      copy.removeAttribute('data-key'); copy.removeAttribute('data-z'); copy.tabIndex = -1;
      return copy.outerHTML;
    }
    return name ? `<div class="dl-card">${c.cardFace(name)}</div>` : '<div class="dl-card down"></div>';
  }

  /** Zahl, Bogen und Farbe des Kreises auf einen LP-Wert setzen. */
  function setRing(side, lp) {
    const el = ring(side);
    if (!el) return;
    const { ratio, hue } = lpRing(lp);
    el.style.setProperty('--ratio', ratio);
    el.style.setProperty('--hue', hue);
    el.querySelector('strong').textContent = Math.round(lp);
  }
  const shake = (f, power = 1) => {
    const stage = root.querySelector('.dl-stage');
    const p = 6 * power;
    return stage && go(stage, [{ transform: 'translate(0, 0)' }, { transform: `translate(${-p}px, ${p / 2}px)` }, { transform: `translate(${p}px, ${-p / 2}px)` }, { transform: `translate(${-p / 2}px, ${p / 3}px)` }, { transform: 'translate(0, 0)' }], MS.shake * f, 'linear');
  };

  /** Ein Geist fliegt in einem Bogen von src nach dst (Rechtecke im Fenster); er hat die Größe des Ziels. */
  async function glide(html, src, dst, f, tint = '') {
    const ghost = Object.assign(document.createElement('div'), { className: `dl-ghost ${tint}`, innerHTML: html });
    const [sx, sy] = [src.left + src.width / 2, src.top + src.height / 2];
    const [dx, dy] = [dst.left + dst.width / 2 - sx, dst.top + dst.height / 2 - sy];
    ghost.style.cssText = `left:${sx - dst.width / 2}px;top:${sy - dst.height / 2}px;width:${dst.width}px;height:${dst.height}px`;
    layer.append(ghost);
    await go(ghost, [{ transform: 'translate(0, 0) scale(1)' }, { transform: `translate(${dx / 2}px, ${dy / 2 - 36}px) scale(1.12)`, offset: 0.5 }, { transform: `translate(${dx}px, ${dy}px) scale(1)` }], MS.fly * f, 'ease-in-out');
    ghost.remove();
  }

  // ---------- die Schritte ----------
  const run = {
    async banner(s, f) {
      const [inMs, holdMs, outMs] = MS.banner.map((ms) => ms * f);
      const el = Object.assign(document.createElement('div'), { className: 'dl-banner', textContent: s.text });
      const stage = root.querySelector('.dl-stage')?.getBoundingClientRect(); // mittig über dem Spielfeld, nicht über dem Fenster
      if (stage) el.style.cssText = `left:${stage.left + stage.width / 2}px;top:${stage.top + stage.height / 2}px`;
      layer.append(el);
      const total = inMs + holdMs + outMs;
      await go(el, [{ opacity: 0 }, { opacity: 1, offset: inMs / total }, { opacity: 1, offset: (inMs + holdMs) / total }, { opacity: 0 }], total);
      el.remove();
    },

    async lp(s, f) {
      const el = ring(s.side);
      if (!el) return;
      const from = Number(el.querySelector('strong').textContent);
      const box = el.getBoundingClientRect();
      const pop = Object.assign(document.createElement('div'), { className: 'dl-pop', textContent: `${s.change === 'heal' ? '+' : '−'}${s.amount}` });
      pop.style.cssText = `left:${box.left - 8}px;top:${box.top + box.height / 2 - 16}px;color:${POP_COLOR[s.change]}`; // links neben dem Kreis, die Zahl im Kreis bleibt lesbar
      layer.append(pop);
      const float = go(pop, [{ transform: 'translate(-100%, 0)', opacity: 1 }, { transform: 'translate(-100%, -36px)', opacity: 1, offset: 0.6 }, { transform: 'translate(-100%, -48px)', opacity: 0 }], MS.pop * f);
      if (s.change === 'damage') shake(f, 0.6);
      await tween(MS.lp * f, (t) => setRing(s.side, from + (s.lp - from) * t));
      await float;
      pop.remove();
    },

    async fly(s, f, c) {
      const [fromKey, toKey] = [zoneKey(s.from, c.me, c.bot), zoneKey(s.to, c.me, c.bot)];
      if (!fromKey || !toKey || fromKey === toKey) return;
      const [src, dst] = [rectOf(fromKey, s.from.side), rectOf(toKey, s.to.side)];
      if (!src || !dst) return;
      const real = cardIn(at(toKey));
      await glide(ghostOf(real, s.name, c), src, dst, f, { gy: 'to-gy', banished: 'to-removed' }[s.to.zone]);
      reveal(real);
    },

    async draw(s, f, c) {
      const p = s.side === 'me' ? c.me : c.bot;
      const [src, dst] = [rectOf(`${p}:deck`, s.side), rectOf(`${p}:2:99`, s.side)]; // die neue Karte hat im Brett davor noch keinen Platz: Mitte der Hand
      if (!src || !dst) return;
      for (let i = 0; i < s.count; i += 1) await glide(ghostOf(null, null, c), src, dst, f); // gezogen wird verdeckt
    },

    /** Beschwörungs-Show (Vorlage summon_show.gd): Blende, Kartenbild, Name, rundes ATK/DEF-Wappen mit Stufe. */
    async show(s, f, c) {
      const m = c.meta(s.name);
      const el = Object.assign(document.createElement('div'), { className: 'dl-show' });
      const art = Object.assign(document.createElement('div'), { className: 'art' });
      if (m.img) art.style.backgroundImage = `url(assets/cards-small/${Number(m.code)}.jpg)`;
      const def = s.pos === 'def';
      const badge = Object.assign(document.createElement('div'), { className: `badge ${def ? 'def' : 'atk'}` });
      badge.innerHTML = `<small>${def ? 'DEF' : 'ATK'}</small><strong>${Number(def ? s.def : s.atk)}</strong>${m.level ? `<small>LV ${Number(m.level)}</small>` : ''}`;
      el.append(art, Object.assign(document.createElement('h2'), { textContent: s.name }), badge);
      layer.append(el);
      const [inMs, holdMs, outMs] = MS.show.map((ms) => ms * f);
      const total = inMs + holdMs + outMs;
      go(art, [{ transform: 'scale(0.6)' }, { transform: 'scale(1)' }], 300 * f, 'cubic-bezier(.34, 1.56, .64, 1)');
      go(badge, [{ transform: 'translateX(-90px)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }], 300 * f);
      await go(el, [{ opacity: 0 }, { opacity: 1, offset: inMs / total }, { opacity: 1, offset: (inMs + holdMs) / total }, { opacity: 0 }], total, 'linear');
      el.remove();
    },

    /** Effekt-Aktivierung: die Karte wird groß in der Mitte gezeigt (Handkarten und gesetzte Karten drehen sich auf), mit Kettennummer; Monster bekommen einen Ring. */
    async chain(s, f, c) {
      const stage = root.querySelector('.dl-stage')?.getBoundingClientRect();
      if (!stage) return;
      const key = zoneKey(s, c.me, c.bot);
      const src = key && rectOf(key, s.side);
      const [W, H] = [168, 245];
      const [cx, cy] = [stage.left + stage.width / 2, stage.top + stage.height / 2];
      const hero = Object.assign(document.createElement('div'), { className: 'dl-hero' });
      hero.style.cssText = `left:${cx - W / 2}px;top:${cy - H / 2}px;width:${W}px;height:${H}px`;
      hero.innerHTML = `<div class="face"><div class="dl-card">${c.cardFace(s.name)}</div></div><div class="face back"><div class="dl-card down"></div></div><span class="dl-link">${Number(s.link)}</span>`;
      layer.append(hero);
      const flip = s.zone !== 'mz';
      if (!flip && src) {
        const ringFx = Object.assign(document.createElement('div'), { className: 'dl-ringfx' });
        ringFx.style.cssText = `left:${src.left + src.width / 2 - 30}px;top:${src.top + src.height / 2 - 30}px`;
        layer.append(ringFx);
        go(ringFx, [{ transform: 'scale(0.6)', opacity: 0.9 }, { transform: 'scale(2.6)', opacity: 0 }], 700 * f).then(() => ringFx.remove());
      }
      const from = src ? `translate(${src.left + src.width / 2 - cx}px, ${src.top + src.height / 2 - cy}px) scale(${Math.max(0.2, src.width / W)})` : 'scale(0.4)';
      await go(hero, [{ transform: `perspective(900px) ${from} rotateY(${flip ? 180 : 0}deg)` }, { transform: 'perspective(900px) translate(0, 0) scale(1) rotateY(0deg)' }], MS.chain[0] * f, 'cubic-bezier(.2, .8, .2, 1)');
      await pause(MS.chain[1] * f);
      await go(hero, [{ opacity: 1 }, { opacity: 0 }], MS.chain[2] * f, 'ease-in');
      hero.remove();
    },

    /** Angriff: ein Geist des Angreifers stößt zum Ziel vor (Monster, bei einem direkten Angriff die Hand des Gegners), das Feld wackelt, er kehrt zurück. */
    async attack(s, f, c) {
      const attacker = cardIn(at(zoneKey(s.from, c.me, c.bot)));
      const aim = s.to ? at(zoneKey(s.to, c.me, c.bot)) : root.querySelector(s.from.side === 'me' ? '.dl-handrow' : '.dl-hand');
      if (!attacker || !aim) return;
      const [src, dst] = [attacker.getBoundingClientRect(), aim.getBoundingClientRect()];
      const [dx, dy] = [(dst.left + dst.width / 2 - src.left - src.width / 2) * 0.85, (dst.top + dst.height / 2 - src.top - src.height / 2) * 0.85];
      const ghost = Object.assign(document.createElement('div'), { className: 'dl-ghost', innerHTML: ghostOf(attacker, null, c) });
      ghost.style.cssText = `left:${src.left}px;top:${src.top}px;width:${src.width}px;height:${src.height}px`;
      hide(attacker);
      layer.append(ghost);
      const hit = `translate(${dx}px, ${dy}px) scale(1.15)`;
      await go(ghost, [{ transform: 'translate(0, 0) scale(1)' }, { transform: hit }], MS.attack[0] * f, 'ease-in');
      await shake(f);
      await go(ghost, [{ transform: hit }, { transform: 'translate(0, 0) scale(1)' }], MS.attack[1] * f);
      ghost.remove();
      reveal(attacker);
    }
  };

  return {
    busy: () => running,
    /** Beginn einer ganzen Abfolge (mehrere Abschnitte): ab jetzt gilt ein Überspringen für alle Abschnitte. */
    start() { skipped = false; },
    skipped: () => skipped,
    skip() { skipped = true; [...stops].forEach((stop) => stop()); },
    /** Pause zwischen zwei Bot-Aktionen (ms bei vollem Tempo). */
    wait: (ms) => pause(ms * speed()),
    /**
     * Spielt die Schritte eines Abschnitts nacheinander auf dem gerade gezeigten Brett.
     * c: { lpBefore, lpAfter: { me, bot }, me, bot (Spielerindizes), cardFace(name), meta(name) → { code, level, img } }.
     * Ein Fehler in einem Schritt bricht nur diesen Schritt ab, das Spiel bleibt bedienbar.
     */
    async play(steps, c) {
      const f = speed();
      if (!f || !steps.length) return;
      running = true;
      setRing('me', c.lpBefore.me); setRing('bot', c.lpBefore.bot); // erst der alte Stand, der Kreis zählt dann herunter
      try {
        for (const s of steps) {
          if (skipped) break;
          try { await run[s.kind](s, f, c); } catch (error) { console.warn('Animation:', error); }
        }
      } finally {
        setRing('me', c.lpAfter.me); setRing('bot', c.lpAfter.bot);
        hidden.forEach((el) => { el.style.visibility = ''; }); hidden.clear();
        layer.replaceChildren(); stops.clear(); running = false;
      }
    }
  };
}
