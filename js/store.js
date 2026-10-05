const STORAGE_KEY = 'frogOtk.v1';

export function getDefaultSettings() {
  return {
    theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    animMode: 'full'
  };
}

export function getStoredSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveSettings(next) {
  const current = getStoredSettings();
  const merged = { ...current, ...next };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
}
