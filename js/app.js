import { getDefaultSettings, getStoredSettings, saveSettings } from './store.js';
import { initCalc } from './calc.js';
import { buildYdk } from './ydk.js';

const $ = (id) => document.getElementById(id);
const navButtons = document.querySelectorAll('.nav-item');
const screens = document.querySelectorAll('.screen');
const themeToggle = $('themeToggle');
const animMode = $('animMode');
const familyList = $('familyList');
const lineSummary = $('lineSummary');
const boardPreview = $('boardPreview');
const lineSteps = $('lineSteps');
const prevLineBtn = $('prevLineBtn');
const nextLineBtn = $('nextLineBtn');
const revealStepBtn = $('revealStepBtn');
const markMemorizedBtn = $('markMemorizedBtn');
const quizQuestion = $('quizQuestion');
const quizAnswers = $('quizAnswers');
const quizFeedback = $('quizFeedback');
const quizProgress = $('quizProgress');
const quizActions = $('quizActions');
const dashboardBody = $('dashboardBody');
const lexiconBody = $('lexiconBody');
const lexiconSearch = $('lexiconSearch');

const esc = (value) => String(value).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Fisher-Yates; sort(() => random - 0.5) is biased.
function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

let calcReady = false;
let lines = [];
let activeLineId = null;
let revealedSteps = 0;
let learned = new Set();

let quizQuestions = [];
let currentQuizIndex = 0;
let quizAnswered = false;
let quizStats = { correct: 0, total: 0 };

/* ---------- Views ---------- */

function setView(viewName) {
  navButtons.forEach((button) => {
    if (button.dataset.view === viewName) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  screens.forEach((screen) => { screen.hidden = screen.id !== `screen-${viewName}`; });

  if (viewName === 'quiz') initializeQuiz();
  if (viewName === 'dashboard') renderDashboard();
  if (viewName === 'lexicon') loadLexicon();
  if (viewName === 'calc' && !calcReady) { calcReady = true; initCalc($('calcRoot')); }
  history.replaceState(null, '', `#${viewName}`);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

function applyAnimMode(mode) {
  document.documentElement.dataset.animMode = mode;
}

/* ---------- Learn ---------- */

const getActiveLine = () => lines.find((line) => line.id === activeLineId) || lines[0];

function selectLine(id) {
  activeLineId = id;
  revealedSteps = learned.has(id) ? getActiveLine().steps.length : 0;
  renderFamilyList();
  renderActiveLine();
}

function renderFamilyList() {
  const families = [...new Set(lines.map((line) => line.family))];
  const activeFamily = getActiveLine().family;

  familyList.innerHTML = families.map((family) => {
    const familyLines = lines.filter((line) => line.family === family);
    const done = familyLines.filter((line) => learned.has(line.id)).length;
    return `
      <button type="button" class="family-button" data-family="${esc(family)}"${family === activeFamily ? ' aria-current="true"' : ''}>
        <span class="family-name">${esc(family)}</span>
        <span class="family-meta">${familyLines.length} Line${familyLines.length > 1 ? 's' : ''} · ${done} gelernt</span>
      </button>`;
  }).join('');
}

function renderActiveLine() {
  const line = getActiveLine();
  const total = line.steps.length;
  const finished = revealedSteps >= total;
  const isLearned = learned.has(line.id);
  const index = lines.indexOf(line);

  lineSummary.innerHTML = `
    <div>
      <h3>${esc(line.title)}</h3>
      <p>${esc(line.summary)}</p>
    </div>
    <span class="badge">${esc(line.family)} · ${index + 1}/${lines.length}</span>`;

  // Memory-first: the end board stays hidden until every step is revealed.
  boardPreview.innerHTML = (line.endBoard || []).map((card, i) => finished
    ? `<div class="card-slot"><span class="type-label">Endboard ${i + 1}</span><span class="card-name">${esc(card)}</span></div>`
    : `<div class="card-slot hidden-card" aria-label="Verdeckte Karte ${i + 1}"><span class="type-label">Endboard ${i + 1}</span><span class="card-name" aria-hidden="true">?</span></div>`
  ).join('');

  const chips = (line.tags || []).map((tag) => `<span class="chip">${esc(tag)}</span>`).join('');
  const stepItems = line.steps.map((step, i) => (i < revealedSteps
    ? `<li${i === revealedSteps - 1 ? ' class="latest"' : ''}>${esc(step)}</li>`
    : '<li class="locked">Noch verdeckt</li>')).join('');

  lineSteps.innerHTML = `
    <div class="steps-head">
      <h4>Schritte</h4>
      <span>${revealedSteps}/${total} aufgedeckt</span>
    </div>
    <div class="tag-row">${chips}</div>
    <p class="meta-block"><strong>Material:</strong> ${esc(line.materials)}</p>
    <ol class="steps-list">${stepItems}</ol>`;

  revealStepBtn.disabled = finished;
  revealStepBtn.textContent = finished ? 'Alle Schritte aufgedeckt' : `Schritt ${revealedSteps + 1} aufdecken`;
  markMemorizedBtn.setAttribute('aria-pressed', String(isLearned));
  markMemorizedBtn.textContent = isLearned ? '✓ Gelernt' : 'Als gelernt markieren';
}

function cycleLine(direction) {
  const index = lines.findIndex((line) => line.id === activeLineId);
  selectLine(lines[(index + direction + lines.length) % lines.length].id);
}

function revealNextStep() {
  const line = getActiveLine();
  if (revealedSteps < line.steps.length) {
    revealedSteps += 1;
    renderActiveLine();
  }
}

function toggleLearned() {
  const line = getActiveLine();
  if (learned.has(line.id)) {
    learned.delete(line.id);
  } else {
    learned.add(line.id);
    revealedSteps = line.steps.length;
  }
  saveSettings({ learned: [...learned] });
  renderFamilyList();
  renderActiveLine();
}

/* ---------- Quiz ---------- */

function generateQuizQuestions() {
  const questions = [];

  lines.forEach((line) => {
    // Needs a current step AND a real successor; the last step has none.
    if (line.steps.length >= 2) {
      const i = Math.floor(Math.random() * (line.steps.length - 1));
      questions.push({
        type: 'next-step',
        lineTitle: line.title,
        currentStep: line.steps[i],
        correctAnswer: line.steps[i + 1],
        distractors: shuffle(line.steps.filter((_, k) => k !== i && k !== i + 1)).slice(0, 2)
      });
    }
    if (line.endBoard?.length) {
      questions.push({
        type: 'endboard',
        lineTitle: line.title,
        correctCards: line.endBoard,
        materials: line.materials
      });
    }
  });

  return shuffle(questions);
}

function renderQuizQuestion() {
  quizAnswered = false;
  quizFeedback.innerHTML = '';
  quizActions.innerHTML = '';

  if (quizQuestions.length === 0) {
    quizProgress.innerHTML = '';
    quizQuestion.innerHTML = '<p>Keine Fragen verfügbar.</p>';
    quizAnswers.innerHTML = '';
    return;
  }

  const question = quizQuestions[currentQuizIndex];

  if (question.type === 'next-step') {
    quizQuestion.innerHTML = `
      <div class="quiz-q">
        <p class="quiz-title">${esc(question.lineTitle)}</p>
        <p>Aktueller Schritt:</p>
        <p class="quiz-highlight">${esc(question.currentStep)}</p>
        <p><strong>Was kommt als Nächstes?</strong></p>
      </div>`;

    const options = shuffle([question.correctAnswer, ...question.distractors]);
    quizAnswers.innerHTML = options.map((option) => `
      <button type="button" class="quiz-option" data-correct="${option === question.correctAnswer}">${esc(option)}</button>
    `).join('');
    quizAnswers.querySelectorAll('.quiz-option').forEach((btn) => {
      btn.addEventListener('click', () => handleQuizAnswer(btn));
    });
  } else {
    quizQuestion.innerHTML = `
      <div class="quiz-q">
        <p class="quiz-title">${esc(question.lineTitle)}</p>
        <p><strong>Welche Karten stehen im Endboard?</strong> Überlege erst, dann decke auf.</p>
        <p class="quiz-meta">Material: ${esc(question.materials)}</p>
      </div>`;
    quizAnswers.innerHTML = '<button type="button" class="primary-button" id="revealEndboardBtn">Endboard aufdecken</button>';
    $('revealEndboardBtn').addEventListener('click', revealEndboard);
  }

  renderQuizProgress();
  quizQuestion.focus({ preventScroll: true });
}

function revealEndboard() {
  const question = quizQuestions[currentQuizIndex];
  quizAnswers.innerHTML = `
    <div class="quiz-endboard-answer">
      ${question.correctCards.map((card) => `<span class="endboard-card">${esc(card)}</span>`).join('')}
    </div>
    <div class="quiz-actions">
      <button type="button" class="primary-button" data-known="true">Gewusst</button>
      <button type="button" class="secondary-button" data-known="false">Nicht gewusst</button>
    </div>`;
  quizAnswers.querySelectorAll('[data-known]').forEach((btn) => {
    btn.addEventListener('click', () => {
      quizAnswers.querySelector('.quiz-actions').remove();
      finishAnswer(btn.dataset.known === 'true', 'Gut gemerkt!', 'Kein Problem – schau dir das Endboard noch einmal an.');
    });
  });
  quizAnswers.querySelector('[data-known]').focus();
}

function handleQuizAnswer(btn) {
  if (quizAnswered) return;
  const isCorrect = btn.dataset.correct === 'true';

  quizAnswers.querySelectorAll('.quiz-option').forEach((b) => {
    b.disabled = true;
    if (b.dataset.correct === 'true') b.classList.add('correct');
    else if (b === btn) b.classList.add('incorrect');
  });

  const answer = quizQuestions[currentQuizIndex].correctAnswer;
  finishAnswer(isCorrect, 'Richtig!', `Leider falsch. Richtig ist: ${esc(answer)}`);
}

function finishAnswer(isCorrect, okText, failText) {
  quizAnswered = true;
  quizStats.total += 1;
  if (isCorrect) quizStats.correct += 1;
  quizFeedback.innerHTML = `<p class="${isCorrect ? 'feedback-correct' : 'feedback-incorrect'}">${isCorrect ? '✓ ' : '✗ '}${isCorrect ? okText : failText}</p>`;

  const isLast = currentQuizIndex === quizQuestions.length - 1;
  quizActions.innerHTML = `<button type="button" class="primary-button" id="nextQuizBtn">${isLast ? 'Ergebnis anzeigen' : 'Nächste Frage'}</button>`;
  const next = $('nextQuizBtn');
  next.addEventListener('click', () => {
    if (isLast) {
      renderQuizEnd();
    } else {
      currentQuizIndex += 1;
      renderQuizQuestion();
    }
  });
  next.focus();
}

function renderQuizProgress() {
  const current = currentQuizIndex + 1;
  const total = quizQuestions.length;
  quizProgress.innerHTML = `
    <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${current}" aria-label="Quizfortschritt">
      <div class="progress-fill" style="width: ${Math.round((current / total) * 100)}%"></div>
    </div>
    <p class="progress-text">Frage ${current} von ${total}</p>`;
}

function renderQuizEnd() {
  const percentage = quizStats.total ? Math.round((quizStats.correct / quizStats.total) * 100) : 0;
  const best = getStoredSettings().bestQuiz ?? 0;
  if (percentage > best) saveSettings({ bestQuiz: percentage });

  quizProgress.innerHTML = '';
  quizAnswers.innerHTML = '';
  quizFeedback.innerHTML = '';
  quizQuestion.innerHTML = `
    <div class="quiz-end">
      <h3>Quiz beendet</h3>
      <p class="score">${percentage}%</p>
      <p><strong>${quizStats.correct} von ${quizStats.total}</strong> richtig${percentage > best && best > 0 ? ' – neuer Bestwert!' : ''}</p>
    </div>`;
  quizActions.innerHTML = `
    <button type="button" class="primary-button" id="restartQuizBtn">Nochmal</button>
    <button type="button" class="secondary-button" id="backToLearnBtn">Zurück zum Lernen</button>`;
  $('restartQuizBtn').addEventListener('click', initializeQuiz);
  $('backToLearnBtn').addEventListener('click', () => setView('learn'));
  quizQuestion.focus({ preventScroll: true });
}

function initializeQuiz() {
  currentQuizIndex = 0;
  quizStats = { correct: 0, total: 0 };
  quizQuestions = generateQuizQuestions();
  renderQuizQuestion();
}

/* ---------- Dashboard ---------- */

function renderDashboard() {
  const best = getStoredSettings().bestQuiz;
  const families = [...new Set(lines.map((line) => line.family))];
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

  const bars = families.map((family) => {
    const familyLines = lines.filter((line) => line.family === family);
    const done = familyLines.filter((line) => learned.has(line.id)).length;
    const value = pct(done, familyLines.length);
    return `
      <div>
        <h3>${esc(family)} <span class="progress-text">· ${done}/${familyLines.length} gelernt</span></h3>
        <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}" aria-label="${esc(family)} Lernstand">
          <div class="progress-fill" style="width: ${value}%"></div>
        </div>
      </div>`;
  }).join('');

  dashboardBody.innerHTML = `
    <div class="stat-row">
      <div class="stat"><strong>${learned.size}/${lines.length}</strong><span>Lines gelernt</span></div>
      <div class="stat"><strong>${best == null ? '–' : `${best}%`}</strong><span>Bestes Quiz-Ergebnis</span></div>
    </div>
    <div class="family-progress">${bars}</div>`;
}

/* ---------- Lexikon ---------- */

let lexicon = null;
const SECTIONS = [['main', 'Main Deck'], ['extra', 'Extra Deck'], ['side', 'Side Deck']];
const TABLE_HEAD = ['Level', 'Beelze oder Des', 'Nur Des', 'Nur Beelze', 'Keins von beiden'];

async function loadLexicon() {
  if (!lexicon) {
    lexiconBody.textContent = 'Lade …';
    try {
      const [decks, materials, banlist] = await Promise.all(
        ['decks', 'materials', 'edison-banlist'].map((name) => fetch(`./data/${name}.json`).then((res) => {
          if (!res.ok) throw new Error(`${name}.json: HTTP ${res.status}`);
          return res.json();
        }))
      );
      const limits = new Map([
        ...banlist.forbidden.map((n) => [n, { max: 0, label: 'Verboten' }]),
        ...banlist.limited.map((n) => [n, { max: 1, label: 'Limitiert' }]),
        ...banlist.semiLimited.map((n) => [n, { max: 2, label: 'Semi-Limitiert' }])
      ]);
      // Edison counts copies across Main + Extra + Side together.
      const copies = new Map();
      Object.values(decks.frogOtk).flat().forEach(({ card, count }) => copies.set(card, (copies.get(card) || 0) + count));
      const illegal = [...copies].filter(([card, n]) => limits.has(card) && n > limits.get(card).max).map(([card]) => card);
      // Optional: only exists after the "Karten laden" workflow / scripts/fetch-cards.mjs ran.
      const cardData = await fetch('./data/cards.json').then((res) => (res.ok ? res.json() : null)).catch(() => null);
      const pool = cardData?.cards ?? null;
      lexicon = {
        deck: decks.frogOtk, materials, limits, illegal, copies, banlistName: banlist.banlist,
        pool, poolName: cardData ? `${cardData.pool}, Stand ${cardData.generated}` : '',
        byName: new Map((pool || []).map((c) => [c.name.toLowerCase(), c]))
      };
    } catch (error) {
      lexiconBody.innerHTML = `<p class="notice notice-error">Lexikon konnte nicht geladen werden (${esc(error.message)}).</p>`;
      return;
    }
  }
  renderLexicon();
}

// ponytail: substring match on line text; "Treeborn" won't match "Treeborn Frog" style shorthand, add aliases.json if needed
function linesUsing(card) {
  const needle = card.toLowerCase();
  return lines.filter((line) => [line.materials, ...line.steps, ...(line.endBoard || [])]
    .some((text) => text.toLowerCase().includes(needle)));
}

const MAX_RESULTS = 50;

const cardStats = (c) => [
  c.type, c.race, c.attribute,
  c.level != null ? `Level ${c.level}` : null,
  c.atk != null ? `ATK ${c.atk} / DEF ${c.def ?? '?'}` : null
].filter(Boolean).join(' · ');

// One list entry; expands (native <details>) when the card database knows the card.
function cardRow(name, count) {
  const used = linesUsing(name);
  const limit = lexicon.limits.get(name);
  const badge = limit ? `<span class="ban-badge ban-${limit.max}">${limit.label}</span>` : '';
  const head = `
    <span class="lex-count"${count ? ` aria-label="${count} Kopie${count > 1 ? 'n' : ''}"` : ''}>${count ? `${count}×` : ''}</span>
    <span class="lex-name">${esc(name)} ${badge}</span>
    <span class="lex-used">${used.length ? `in ${used.map((l) => esc(l.title)).join(', ')}` : ''}</span>`;

  const info = lexicon.byName.get(name.toLowerCase());
  if (!info) return `<li class="lex-card"><div class="lex-sum">${head}</div></li>`;

  const img = info.img ? `<img class="lex-img" src="assets/cards-small/${info.id}.jpg" alt="" loading="lazy" width="100" height="146" />` : '';
  return `
    <li class="lex-card">
      <details>
        <summary class="lex-sum">${head}</summary>
        <div class="lex-detail">${img}<div><p class="lex-stats">${esc(cardStats(info))}</p><p class="lex-text">${esc(info.desc)}</p></div></div>
      </details>
    </li>`;
}

function renderLexicon() {
  const query = lexiconSearch.value.trim().toLowerCase();
  const section = (title, items) => `<section class="lex-section"><h3>${title}</h3><ul class="lex-list">${items}</ul></section>`;

  let sections;
  if (query && lexicon.pool) {
    // With the card database, search the whole Edison pool, not just the deck.
    const hits = lexicon.pool.filter((c) => c.name.toLowerCase().includes(query));
    const shown = hits.slice(0, MAX_RESULTS);
    sections = hits.length
      ? section(`Edison-Kartenpool: ${hits.length} Treffer${hits.length > shown.length ? ` (erste ${shown.length})` : ''}`,
        shown.map((c) => cardRow(c.name, lexicon.copies.get(c.name) || 0)).join(''))
      : '';
  } else {
    sections = SECTIONS.map(([key, label]) => {
      const cards = (lexicon.deck[key] || []).filter((c) => c.card.toLowerCase().includes(query));
      return cards.length ? section(label, cards.map(({ card, count }) => cardRow(card, count)).join('')) : '';
    }).join('');
  }

  const { intro, table } = lexicon.materials;
  const rows = table.map((r) => `<tr><th scope="row">${r.level}</th><td>${r.beelzeOrDes}</td><td>${r.justDes}</td><td>${r.justBeelze}</td><td>${r.neither}</td></tr>`).join('');
  const rules = query ? '' : `
    <section class="lex-section">
      <h3>Material-Regeln</h3>
      <p class="meta-block">${esc(intro.materials.general)}</p>
      <div class="table-wrap">
        <table class="lex-table">
          <thead><tr>${TABLE_HEAD.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;

  const check = lexicon.illegal.length
    ? `<p class="notice notice-error">Nicht legal im Edison-Format (${esc(lexicon.banlistName)}): ${lexicon.illegal.map(esc).join(', ')}</p>`
    : `<p class="notice">✓ Deck ist legal im Edison-Format (Banliste ${esc(lexicon.banlistName)}).</p>`;

  const dbNote = lexicon.pool
    ? `<p class="calc-note">Tippe auf eine Karte für Text und Bild. Kartenpool: ${esc(lexicon.poolName)}. Einzelne Karten dieser Zeit sind trotzdem nicht erlaubt.</p>`
    : '<p class="calc-note">Kartendatenbank noch nicht geladen: Starte auf GitHub den Workflow „Karten laden", dann gibt es Kartentext, Bilder und die Suche über alle Edison-Karten.</p>';

  const exportBar = `
    <div class="lex-export">
      <button type="button" class="secondary-button" data-ydk${lexicon.pool ? '' : ' disabled'}>Deck als .ydk exportieren</button>
      <span id="ydkStatus" role="status"></span>
    </div>`;

  lexiconBody.innerHTML = check + exportBar + dbNote + (sections || '<p class="empty-state">Keine Karte gefunden.</p>') + rules;
}

/* ---------- Init ---------- */

function initSettings() {
  const stored = { ...getDefaultSettings(), ...getStoredSettings() };
  applyTheme(stored.theme);
  applyAnimMode(stored.animMode);
  animMode.value = stored.animMode;
  learned = new Set(Array.isArray(stored.learned) ? stored.learned : []);

  themeToggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    saveSettings({ theme: next });
  });
  animMode.addEventListener('change', () => {
    applyAnimMode(animMode.value);
    saveSettings({ animMode: animMode.value });
  });
}

function bindEvents() {
  prevLineBtn.addEventListener('click', () => cycleLine(-1));
  nextLineBtn.addEventListener('click', () => cycleLine(1));
  revealStepBtn.addEventListener('click', revealNextStep);
  markMemorizedBtn.addEventListener('click', toggleLearned);
  lexiconSearch.addEventListener('input', () => lexicon && renderLexicon());
  lexiconBody.addEventListener('click', (event) => {
    if (!event.target.closest('[data-ydk]')) return;
    const status = $('ydkStatus');
    const { text, missing } = buildYdk(lexicon.deck, lexicon.byName);
    if (missing.length) {
      status.textContent = `Nicht exportiert, Karten fehlen in der Datenbank: ${missing.join(', ')}`;
      return;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    link.download = 'frog-otk-edison.ydk';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    status.textContent = 'Exportiert: frog-otk-edison.ydk';
  });
  navButtons.forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  familyList.addEventListener('click', (event) => {
    const button = event.target.closest('.family-button');
    if (!button) return;
    const first = lines.find((line) => line.family === button.dataset.family);
    if (first) selectLine(first.id);
  });
}

async function loadCatalog() {
  const response = await fetch('./data/line-catalog.json');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const catalog = await response.json();
  return (catalog.lines || []).filter((line) => Array.isArray(line.steps) && line.steps.length > 0);
}

initSettings();
bindEvents();

try {
  lines = await loadCatalog();
  if (lines.length === 0) throw new Error('Keine Lines im Katalog');
  learned = new Set([...learned].filter((id) => lines.some((line) => line.id === id)));
  activeLineId = lines[0].id;
  renderFamilyList();
  renderActiveLine();
  const hash = location.hash.slice(1);
  setView([...navButtons].some((b) => b.dataset.view === hash) ? hash : 'learn');
} catch (error) {
  const box = $('loadError');
  box.hidden = false;
  box.textContent = `Line-Katalog konnte nicht geladen werden (${error.message}). Die App muss über einen Webserver geöffnet werden, nicht per file://.`;
}
