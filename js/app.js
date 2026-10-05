const lineCatalog = await fetch('./data/line-catalog.json').then((res) => res.json());

const navButtons = document.querySelectorAll('.nav-item');
const screens = document.querySelectorAll('.screen');
const themeToggle = document.getElementById('themeToggle');
const animMode = document.getElementById('animMode');
const familyList = document.getElementById('familyList');
const lineSummary = document.getElementById('lineSummary');
const boardPreview = document.getElementById('boardPreview');
const lineSteps = document.getElementById('lineSteps');
const prevLineBtn = document.getElementById('prevLineBtn');
const nextLineBtn = document.getElementById('nextLineBtn');
const revealStepBtn = document.getElementById('revealStepBtn');
const markMemorizedBtn = document.getElementById('markMemorizedBtn');

const quizContainer = document.getElementById('quizContainer');
const quizQuestion = document.getElementById('quizQuestion');
const quizAnswers = document.getElementById('quizAnswers');
const quizFeedback = document.getElementById('quizFeedback');
const quizProgress = document.getElementById('quizProgress');
const quizActions = document.getElementById('quizActions');

let activeLineId = lineCatalog.lines[0]?.id || null;
let revealedSteps = 0;
const learnedLines = new Set();

let currentQuizIndex = 0;
let quizAnswered = false;
let quizQuestions = [];
let quizStats = { correct: 0, total: 0 };

function setView(viewName) {
  navButtons.forEach((button) => {
    const active = button.dataset.view === viewName;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });

  screens.forEach((screen) => {
    const active = screen.id === `screen-${viewName}`;
    screen.classList.toggle('active', active);
  });

  if (viewName === 'quiz') {
    initializeQuiz();
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function applyAnimMode(mode) {
  document.documentElement.dataset.animMode = mode;
}

function getActiveLine() {
  return lineCatalog.lines.find((line) => line.id === activeLineId) || lineCatalog.lines[0];
}

function renderFamilyList() {
  const uniqueFamilies = [...new Set(lineCatalog.lines.map((line) => line.family))];
  familyList.innerHTML = '';

  uniqueFamilies.forEach((family) => {
    const familyLines = lineCatalog.lines.filter((line) => line.family === family);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'family-button';

    const active = familyLines.some((line) => line.id === activeLineId);
    if (active) button.classList.add('active');

    button.innerHTML = `
      <span class="family-name">${family}</span>
      <span class="family-meta">${familyLines.length} Line${familyLines.length > 1 ? 's' : ''}</span>
    `;

    button.addEventListener('click', () => {
      const firstLine = familyLines[0];
      if (firstLine) {
        activeLineId = firstLine.id;
        revealedSteps = 0;
        renderFamilyList();
        renderActiveLine();
      }
    });

    familyList.appendChild(button);
  });
}

function renderActiveLine() {
  const activeLine = getActiveLine();
  if (!activeLine) return;

  lineSummary.innerHTML = `
    <div>
      <h3>${activeLine.title}</h3>
      <p>${activeLine.summary}</p>
    </div>
    <span class="badge">${activeLine.family}</span>
  `;

  const endBoard = activeLine.endBoard || [];
  boardPreview.innerHTML = endBoard.map((card) => `
    <div class="card-slot">
      <span class="type-label">Endboard</span>
      <span class="card-name">${card}</span>
    </div>
  `).join('');

  const chips = (activeLine.tags || []).map((tag) => `<span class="chip">${tag}</span>`).join('');
  const visibleSteps = (activeLine.steps || []).slice(0, revealedSteps);

  lineSteps.innerHTML = `
    <h4>Wichtige Schritte</h4>
    <div class="tag-row">${chips}</div>
    <div class="meta-block">
      <strong>Material:</strong>
      <span>${activeLine.materials}</span>
    </div>
    <div class="progress-box">
      <span>Fortschritt:</span>
      <strong>${visibleSteps.length}/${activeLine.steps.length}</strong>
    </div>
    <ol class="steps-list">
      ${(visibleSteps.length ? visibleSteps : []).map((step) => `<li>${step}</li>`).join('') || '<li>Schritt noch nicht sichtbar.</li>'}
    </ol>
  `;
}

function cycleLine(direction) {
  const index = lineCatalog.lines.findIndex((line) => line.id === activeLineId);
  const nextIndex = (index + direction + lineCatalog.lines.length) % lineCatalog.lines.length;
  activeLineId = lineCatalog.lines[nextIndex].id;
  revealedSteps = 0;
  renderFamilyList();
  renderActiveLine();
}

function revealNextStep() {
  const activeLine = getActiveLine();
  if (!activeLine) return;

  if (revealedSteps < activeLine.steps.length) {
    revealedSteps += 1;
  }
  renderActiveLine();
}

function markAsLearned() {
  const activeLine = getActiveLine();
  if (!activeLine) return;

  learnedLines.add(activeLine.id);
  revealedSteps = activeLine.steps.length;
  renderActiveLine();
}

function generateQuizQuestions() {
  const questions = [];

  lineCatalog.lines.forEach((line) => {
    if (line.steps && line.steps.length > 0) {
      const randomStepIndex = Math.floor(Math.random() * line.steps.length);
      const nextStepIndex = (randomStepIndex + 1) % line.steps.length;

      questions.push({
        type: 'next-step',
        lineId: line.id,
        lineTitle: line.title,
        currentStep: line.steps[randomStepIndex],
        correctAnswer: line.steps[nextStepIndex],
        allSteps: line.steps,
        endBoard: line.endBoard
      });
    }

    if (line.endBoard && line.endBoard.length > 0) {
      questions.push({
        type: 'endboard',
        lineId: line.id,
        lineTitle: line.title,
        correctCards: line.endBoard,
        materials: line.materials
      });
    }
  });

  return questions.sort(() => Math.random() - 0.5);
}

function getWrongAnswers(correctAnswer, allSteps) {
  return allSteps.filter((step) => step !== correctAnswer).slice(0, 2);
}

function renderQuizQuestion() {
  if (quizQuestions.length === 0) {
    quizQuestion.innerHTML = '<p>Keine Fragen verfügbar. Bitte wechsle zum Lernen-Modus und füge mehr Lines hinzu.</p>';
    quizAnswers.innerHTML = '';
    quizFeedback.innerHTML = '';
    quizActions.innerHTML = '';
    return;
  }

  const question = quizQuestions[currentQuizIndex];
  quizAnswered = false;
  quizFeedback.innerHTML = '';

  if (question.type === 'next-step') {
    quizQuestion.innerHTML = `
      <div class="quiz-q">
        <p class="quiz-title">${question.lineTitle}</p>
        <p><strong>Aktueller Schritt:</strong></p>
        <p class="quiz-highlight">${question.currentStep}</p>
        <p><strong>Was kommt als Nächstes?</strong></p>
      </div>
    `;

    const wrongAnswers = getWrongAnswers(question.correctAnswer, question.allSteps);
    const options = [question.correctAnswer, ...wrongAnswers].sort(() => Math.random() - 0.5);

    quizAnswers.innerHTML = options.map((option, idx) => `
      <button class="quiz-option" data-correct="${option === question.correctAnswer}" data-index="${idx}">
        ${option}
      </button>
    `).join('');

    document.querySelectorAll('.quiz-option').forEach((btn) => {
      btn.addEventListener('click', () => handleQuizAnswer(btn));
    });
  } else if (question.type === 'endboard') {
    quizQuestion.innerHTML = `
      <div class="quiz-q">
        <p class="quiz-title">${question.lineTitle}</p>
        <p><strong>Welche Karten sind im Endboard?</strong></p>
        <p class="quiz-meta">Material: ${question.materials}</p>
      </div>
    `;

    quizAnswers.innerHTML = `
      <div class="quiz-endboard-answer">
        ${question.correctCards.map((card) => `<span class="endboard-card">${card}</span>`).join('')}
      </div>
      <button class="primary-button" id="confirmEndboardBtn">Endboard bestätigt</button>
    `;

    document.getElementById('confirmEndboardBtn').addEventListener('click', () => {
      quizAnswered = true;
      quizFeedback.innerHTML = `<p class="feedback-correct">✓ Richtig! Das war das Endboard.</p>`;
      renderQuizActions();
    });
  }

  renderQuizProgress();
}

function handleQuizAnswer(btn) {
  if (quizAnswered) return;

  const isCorrect = btn.dataset.correct === 'true';
  quizAnswered = true;

  document.querySelectorAll('.quiz-option').forEach((b) => {
    b.disabled = true;
    if (b.dataset.correct === 'true') {
      b.classList.add('correct');
    } else if (b === btn && !isCorrect) {
      b.classList.add('incorrect');
    }
  });

  if (isCorrect) {
    quizStats.correct += 1;
    quizFeedback.innerHTML = '<p class="feedback-correct">✓ Richtig!</p>';
  } else {
    quizFeedback.innerHTML = `<p class="feedback-incorrect">✗ Falsch. Die richtige Antwort ist: <strong>${document.querySelector('[data-correct="true"]').textContent}</strong></p>`;
  }

  quizStats.total += 1;
  renderQuizActions();
}

function renderQuizProgress() {
  const current = currentQuizIndex + 1;
  const total = quizQuestions.length;
  const percentage = Math.round((current / total) * 100);

  quizProgress.innerHTML = `
    <div class="progress-bar">
      <div class="progress-fill" style="width: ${percentage}%"></div>
    </div>
    <p class="progress-text">Frage ${current} von ${total}</p>
  `;
}

function renderQuizActions() {
  if (!quizAnswered) {
    quizActions.innerHTML = '';
    return;
  }

  const isLast = currentQuizIndex === quizQuestions.length - 1;

  quizActions.innerHTML = `
    <button class="primary-button" id="nextQuizBtn">${isLast ? 'Fertig' : 'Nächste Frage'}</button>
  `;

  document.getElementById('nextQuizBtn').addEventListener('click', () => {
    if (isLast) {
      renderQuizEnd();
    } else {
      currentQuizIndex += 1;
      renderQuizQuestion();
    }
  });
}

function renderQuizEnd() {
  const percentage = Math.round((quizStats.correct / quizStats.total) * 100);

  quizQuestion.innerHTML = `
    <div class="quiz-end">
      <h3>Quiz beendet!</h3>
      <p>Du hast <strong>${quizStats.correct} von ${quizStats.total}</strong> Fragen richtig beantwortet.</p>
      <p class="score">${percentage}%</p>
    </div>
  `;

  quizAnswers.innerHTML = '';
  quizFeedback.innerHTML = '';
  quizProgress.innerHTML = '';

  quizActions.innerHTML = `
    <button class="primary-button" id="restartQuizBtn">Quiz erneut starten</button>
    <button class="secondary-button" id="backToLearnBtn">Zurück zum Lernen</button>
  `;

  document.getElementById('restartQuizBtn').addEventListener('click', initializeQuiz);
  document.getElementById('backToLearnBtn').addEventListener('click', () => setView('learn'));
}

function initializeQuiz() {
  currentQuizIndex = 0;
  quizStats = { correct: 0, total: 0 };
  quizQuestions = generateQuizQuestions();
  renderQuizQuestion();
}

function initTheme() {
  const saved = JSON.parse(localStorage.getItem('frogOtk.v1') || '{}');
  const theme = saved.theme || 'light';
  const mode = saved.animMode || 'full';

  applyTheme(theme);
  applyAnimMode(mode);
  animMode.value = mode;

  themeToggle.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
    localStorage.setItem('frogOtk.v1', JSON.stringify({ ...saved, theme: next }));
  });

  animMode.addEventListener('change', (event) => {
    const value = event.target.value;
    applyAnimMode(value);
    localStorage.setItem('frogOtk.v1', JSON.stringify({ ...saved, animMode: value }));
  });
}

prevLineBtn.addEventListener('click', () => cycleLine(-1));
nextLineBtn.addEventListener('click', () => cycleLine(1));
revealStepBtn.addEventListener('click', revealNextStep);
markMemorizedBtn.addEventListener('click', markAsLearned);

navButtons.forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view));
});

initTheme();
setView('learn');
renderFamilyList();
renderActiveLine();
