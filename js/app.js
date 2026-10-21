import { getDefaultSettings, getStoredSettings, saveSettings } from './store.js';

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
