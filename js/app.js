import { getStoredSettings, saveSettings, getDefaultSettings } from './store.js';

const navButtons = document.querySelectorAll('.nav-item');
const screens = document.querySelectorAll('.screen');
const themeToggle = document.getElementById('themeToggle');
const animMode = document.getElementById('animMode');

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
  document.documentElement.style.setProperty('--motion-scale', mode === 'off' ? '0' : mode === 'reduced' ? '0.5' : '1');
}

function initApp() {
  const stored = getStoredSettings();
  const settings = { ...getDefaultSettings(), ...stored };

  applyTheme(settings.theme);
  applyAnimMode(settings.animMode);
  animMode.value = settings.animMode;

  navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setActiveView(button.dataset.view);
    });
  });

  themeToggle.addEventListener('click', () => {
    const nextTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(nextTheme);
    saveSettings({ theme: nextTheme });
  });

  animMode.addEventListener('change', (event) => {
    const mode = event.target.value;
    applyAnimMode(mode);
    saveSettings({ animMode: mode });
  });

  setActiveView('learn');
}

initApp();
