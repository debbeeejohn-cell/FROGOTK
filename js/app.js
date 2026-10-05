const familyList = document.getElementById('familyList');
const lineDetail = document.getElementById('lineDetail');
const lineSummary = document.getElementById('lineSummary');
const boardPreview = document.getElementById('boardPreview');
const lineSteps = document.getElementById('lineSteps');

const navButtons = document.querySelectorAll('.nav-item');
const screens = document.querySelectorAll('.screen');
const themeToggle = document.getElementById('themeToggle');
const animMode = document.getElementById('animMode');

let lines = [];
let selectedFamily = null;

function setActiveView(viewName) {
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
  const families = [...new Set(lines.map((line) => line.family))];
  familyList.innerHTML = '';

  families.forEach((family) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'family-button';
    if (family === selectedFamily) button.classList.add('active');

    const familyLines = lines.filter((line) => line.family === family);
    button.innerHTML = `
      <span class="family-name">${family}</span>
      <span class="family-meta">${familyLines.length} Varianten</span>
    `;

    button.addEventListener('click', () => {
      selectedFamily = family;
      renderFamilyList();
      renderSelectedLine();
    });

    familyList.appendChild(button);
  });
}

function renderSelectedLine() {
  const current = lines.find((line) => line.family === selectedFamily) || lines[0];
  if (!current) return;

  lineSummary.innerHTML = `
    <div>
      <h3>${current.family}</h3>
      <p>${current.useCase}</p>
    </div>
    <span class="badge">${current.desFrogs} Des</span>
  `;

  const slots = [
    { label: 'Endboard', name: current.endBoard || '—' },
    { label: 'Damage', name: current.damage ? `${current.damage} LP` : '—' },
    { label: 'Materials', name: current.materials?.noBeelze ?? '—' },
    { label: 'Notes', name: current.notes || '—' }
  ];

  boardPreview.innerHTML = slots.map((slot) => `
    <div class="card-slot">
      <span class="type-label">${slot.label}</span>
      <span class="card-name">${slot.name}</span>
    </div>
  `).join('');

  lineSteps.innerHTML = `
    <h4>Schritte</h4>
    <ol class="steps-list">
      ${(current.steps || []).map((step) => `<li>${step}</li>`).join('')}
    </ol>
  `;
}

async function loadData() {
  const [lineResponse, materialsResponse] = await Promise.all([
    fetch('data/lines.json'),
    fetch('data/materials.json')
  ]);

  const lineData = await lineResponse.json();
  lines = Array.isArray(lineData) ? lineData : [];

  if (lines.length) {
    selectedFamily = lines[0].family;
    renderFamilyList();
    renderSelectedLine();
  }
}

function initShell() {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  const settings = {
    theme: document.documentElement.getAttribute('data-theme') || 'light',
    animMode: 'full',
    ...stored
  };

  applyTheme(settings.theme);
  applyAnimMode(settings.animMode);
  animMode.value = settings.animMode;

  navButtons.forEach((button) => {
    button.addEventListener('click', () => setActiveView(button.dataset.view));
  });

  themeToggle.addEventListener('click', () => {
    const nextTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(nextTheme);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, theme: nextTheme }));
  });

  animMode.addEventListener('change', (event) => {
    const mode = event.target.value;
    applyAnimMode(mode);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, animMode: mode }));
  });

  setActiveView('learn');
}

initShell();
loadData();
