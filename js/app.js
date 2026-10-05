const lineCatalog = await fetch('./data/line-catalog.json').then((res) => res.json());

const navButtons = document.querySelectorAll('.nav-item');
const screens = document.querySelectorAll('.screen');
const themeToggle = document.getElementById('themeToggle');
const animMode = document.getElementById('animMode');
const familyList = document.getElementById('familyList');
const lineSummary = document.getElementById('lineSummary');
const boardPreview = document.getElementById('boardPreview');
const lineSteps = document.getElementById('lineSteps');

let activeLineId = lineCatalog.lines[0]?.id || null;

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
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function applyAnimMode(mode) {
  document.documentElement.dataset.animMode = mode;
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
        renderFamilyList();
        renderActiveLine();
      }
    });

    familyList.appendChild(button);
  });
}

function renderActiveLine() {
  const activeLine = lineCatalog.lines.find((line) => line.id === activeLineId) || lineCatalog.lines[0];
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

  lineSteps.innerHTML = `
    <h4>Wichtige Schritte</h4>
    <div class="tag-row">${chips}</div>
    <div class="meta-block">
      <strong>Material:</strong>
      <span>${activeLine.materials}</span>
    </div>
    <ol class="steps-list">
      ${(activeLine.steps || []).map((step) => `<li>${step}</li>`).join('')}
    </ol>
  `;
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

navButtons.forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view));
});

initTheme();
setView('learn');
renderFamilyList();
renderActiveLine();
