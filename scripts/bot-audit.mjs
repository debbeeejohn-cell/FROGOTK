#!/usr/bin/env node
// Prüft Code und Bot und schreibt einen Bericht mit Ampeln. Misst nur, vergibt keine Gesamtnote.
//   node --no-warnings scripts/bot-audit.mjs [--quick|--full]   → docs/AUDIT_REPORT.md
// Schwellen: data/audit-thresholds.json. Grenzen: derselbe Autor wie der Bot, Gegner spielt zufällig.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { server } from './duel-server.mjs';
import { PAIRS, play } from './bot-eval.mjs';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const file = (p) => path.join(rootDir, p);
const limits = JSON.parse(fs.readFileSync(file('data/audit-thresholds.json'), 'utf8'));

export const OK = 'grün', WARN = 'gelb', BAD = 'rot';
const rows = [];
const add = (area, name, status, detail) => rows.push({ area, name, status, detail });

// --- Statistik ---------------------------------------------------------------------------------------------
/** Wilson-Intervall (95 %) für k von n. */
export function wilson(k, n) {
  if (!n) return [0, 1];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
/** Zweiseitiger exakter Vorzeichentest: wie wahrscheinlich ist ein Abstand b:c bei gleicher Stärke? */
export function signTest(b, c) {
  const n = b + c;
  if (!n) return 1;
  const choose = (m, k) => { let r = 1; for (let i = 1; i <= k; i += 1) r = (r * (m - k + i)) / i; return r; };
  const k = Math.min(b, c);
  let tail = 0;
  for (let i = 0; i <= k; i += 1) tail += choose(n, i);
  return Math.min(1, (2 * tail) / 2 ** n);
}
const pct = (x) => `${(x * 100).toFixed(0)} %`;
const sorted = (a) => [...a].sort((x, y) => x - y);
const median = (a) => sorted(a)[Math.floor(a.length / 2)] ?? 0;
const quantile = (a, q) => sorted(a)[Math.min(a.length - 1, Math.floor(a.length * q))] ?? 0;

// --- A. Code ----------------------------------------------------------------------------------------------
function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(file(dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (!['node_modules', '.git', 'vendor', '.godot'].includes(e.name)) walk(p, ext, out); } else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

export function runTests() {
  for (const t of [...walk('js', '.test.mjs'), ...walk('scripts', '.test.mjs')]) {
    if (t.endsWith('bot-audit.test.mjs')) continue; // sonst ruft sich das Werkzeug selbst auf
    const t0 = Date.now();
    const r = spawnSync('node', ['--no-warnings', t], { cwd: rootDir, encoding: 'utf8', timeout: 600000 });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const ok = r.status === 0 && /all checks passed/.test(r.stdout);
    add('Code', `Test ${t}`, ok ? OK : BAD, ok ? `${secs} s` : `Abbruch nach ${secs} s: ${(r.stderr || r.stdout).trim().split('\n').slice(-2).join(' | ')}`);
  }
}

export function staticChecks() {
  const spaced = walk('godot', '.gd').flatMap((f) => fs.readFileSync(file(f), 'utf8').split('\n').map((l, i) => (/^ +\S/.test(l) ? `${f}:${i + 1}` : null)).filter(Boolean));
  add('Code', 'GDScript nur mit Tabs eingerückt', spaced.length ? BAD : OK, spaced.length ? `${spaced.length} Zeilen, z. B. ${spaced.slice(0, 3).join(', ')}` : 'keine Leerzeichen-Einrückung');
  const dead = [];
  for (const f of ['CLAUDE.md', ...walk('docs', '.md')]) {
    const dir = path.dirname(f);
    for (const m of fs.readFileSync(file(f), 'utf8').matchAll(/\]\(([^)#\s]+)\)/g)) if (!/^(https?:|mailto:)/.test(m[1]) && !fs.existsSync(file(path.join(dir, m[1])))) dead.push(`${f} → ${m[1]}`);
  }
  add('Code', 'Links in Dokumenten', dead.length ? WARN : OK, dead.length ? dead.join('; ') : 'alle Ziele vorhanden');
  const big = [...walk('js', '.js'), ...walk('scripts', '.mjs')].filter((f) => fs.readFileSync(file(f), 'utf8').split('\n').length > limits.maxFileLines);
  add('Code', `Dateien über ${limits.maxFileLines} Zeilen`, big.length ? WARN : OK, big.join(', ') || 'keine');
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: rootDir, encoding: 'utf8' }).stdout.trim();
  add('Code', 'Nicht eingecheckte Änderungen', dirty ? WARN : OK, dirty ? `${dirty.split('\n').length} Dateien` : 'sauber');
}

// --- B. Bot ------------------------------------------------------------------------------------------------
/** Eine Partie mit Aufzeichnung: Ergebnis, Dauer, Fingerabdruck (für Determinismus). */
async function record(base, deck, opp, seed, variant) {
  const prints = [];
  let active = null;
  const t0 = Date.now();
  const res = await play(base, deck, opp, seed, (st) => { active = st.active; prints.push(`${st.turn}|${st.phase}|${st.prompt?.choices?.map((c) => c.label).join(',') ?? ''}`); }, variant);
  return { ...res, active, ms: Date.now() - t0, print: prints.join('\n') };
}

export async function botChecks(mode) {
  const games = limits.games[mode];
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const seeds = Array.from({ length: games }, (_, i) => 1000 + i * 7);
  const runs = { '': [], advisor: [] };
  for (const variant of Object.keys(runs)) {
    for (const [deck, opp] of PAIRS) for (const seed of seeds) runs[variant].push({ deck, opp, seed, ...(await record(base, deck, opp, seed, variant)) });
  }
  for (const [variant, list] of Object.entries(runs)) {
    const name = variant || 'alter Bot';
    // Offene Partie: hängt der Bot (aktiv = bot) → rot. Dreht sich der Zufallsspieler im Kreis (er beendet nie freiwillig den Zug) → gelb, Messartefakt.
    const open = list.filter((r) => r.winner === null);
    const botStuck = open.filter((r) => r.active !== 'me'), mineStuck = open.filter((r) => r.active === 'me');
    const where = (l) => l.slice(0, 3).map((r) => `Bot ${r.opp} gegen ${r.deck}, Seed ${r.seed}`).join('; ');
    add('Bot', `Legalität, ${name}: Partien zu Ende gespielt`, botStuck.length > limits.unfinishedMax ? BAD : OK, `${list.length - open.length}/${list.length}${botStuck.length ? `; Bot hängt: ${where(botStuck)}` : ''}`);
    if (mineStuck.length) add('Bot', `Messartefakt, ${name}: Zufallsspieler beendet den Zug nie`, WARN, `${mineStuck.length} Partien nach 600 Antworten abgebrochen: ${where(mineStuck)}. Der Zufallsspieler wählt nie „Zug beenden“.`);
    const ms = list.map((r) => r.ms);
    add('Bot', `Laufzeit je Partie, ${name}`, quantile(ms, 0.95) / 1000 > limits.maxSecondsPerGame ? WARN : OK, `Median ${(median(ms) / 1000).toFixed(1)} s, p95 ${(quantile(ms, 0.95) / 1000).toFixed(1)} s`);
    const again = list.slice(0, 3); // Determinismus: drei Partien nochmal spielen
    let same = 0;
    for (const r of again) same += (await record(base, r.deck, r.opp, r.seed, variant)).print === r.print ? 1 : 0;
    add('Bot', `Determinismus, ${name}: gleicher Seed, gleiche Partie`, same === again.length ? OK : BAD, `${same}/${again.length}`);
  }
  // Stärke je Paarung, gepaart über gleiche Seeds. „Besser“ nur bei klarem Abstand.
  for (const [deck, opp] of PAIRS) {
    const pick = (v) => runs[v].filter((r) => r.deck === deck && r.opp === opp);
    const [o, a] = [pick(''), pick('advisor')];
    const wins = (l) => l.filter((r) => r.winner === 'bot').length;
    const b = a.filter((r, i) => r.winner === 'bot' && o[i].winner !== 'bot').length, c = a.filter((r, i) => r.winner !== 'bot' && o[i].winner === 'bot').length;
    const p = signTest(b, c), [lo, hi] = wilson(wins(a), a.length);
    const verdict = p < 0.05 ? (b > c ? 'Advisor klar besser' : 'Advisor klar schlechter') : 'nicht unterscheidbar';
    add('Bot', `Stärke ${opp} (Bot) gegen ${deck} (Zufall)`, verdict === 'Advisor klar schlechter' ? BAD : OK,
      `alt ${wins(o)}/${o.length}, Advisor ${wins(a)}/${a.length} (${pct(lo)}–${pct(hi)}); nur Advisor ${b}, nur alt ${c}, p=${p.toFixed(3)}: ${verdict}`);
  }
  server.close();
}

// --- Bericht ------------------------------------------------------------------------------------------------
export function report(mode) {
  const icon = { [OK]: '🟢', [WARN]: '🟡', [BAD]: '🔴' };
  const count = (s) => rows.filter((r) => r.status === s).length;
  const lines = [`# Audit-Bericht (${mode})`, '',
    `Gemessen von \`scripts/bot-audit.mjs\`. ${icon[OK]} ${count(OK)}  ${icon[WARN]} ${count(WARN)}  ${icon[BAD]} ${count(BAD)}.`, '',
    '**Grenzen:** Das Werkzeug stammt vom selben Autor wie der Bot (blinde Flecken möglich). Der Gegner spielt zufällig und ersetzt keinen Menschen.',
    'Es misst Stellvertreter, keine „menschliche“ Spielweise. Schwellen stehen in `data/audit-thresholds.json`.', ''];
  for (const area of ['Code', 'Bot']) {
    lines.push(`## ${area}`, '', '| | Prüfung | Ergebnis |', '|---|---|---|');
    for (const r of rows.filter((x) => x.area === area)) lines.push(`| ${icon[r.status]} | ${r.name} | ${r.detail.replaceAll('|', '/')} |`);
    lines.push('');
  }
  return lines.join('\n');
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/bot-audit.mjs')) {
  const mode = process.argv.includes('--full') ? 'full' : 'quick';
  runTests();
  staticChecks();
  await botChecks(mode);
  const md = report(mode);
  fs.writeFileSync(file('docs/AUDIT_REPORT.md'), md);
  console.log(md);
}
