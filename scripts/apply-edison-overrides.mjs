// Wendet data/edison-scripts.json auf die Engine-Skripte an (Edison-Regeln statt Konami-Stand, wo nötig).
//   node --no-warnings scripts/apply-edison-overrides.mjs   # schreibt data/core-scripts.json neu (ohne Netz)
// fetch-core.mjs ruft applyOverrides() beim Erzeugen auf, dann bleibt die Änderung auch nach einem Neu-Laden.
import fs from 'node:fs';
import path from 'node:path';

export function applyOverrides(scripts, overrides) {
  for (const [name, pairs] of Object.entries(overrides.replace)) {
    if (!scripts[name]) throw new Error(`Skript fehlt: ${name}`);
    for (const [from, to] of pairs) {
      if (!scripts[name].includes(from)) throw new Error(`Stelle nicht gefunden in ${name}: ${from}`);
      scripts[name] = scripts[name].replace(from, to);
    }
  }
  return scripts;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/apply-edison-overrides.mjs')) {
  const data = path.join(process.cwd(), 'data');
  const file = path.join(data, 'core-scripts.json');
  const core = JSON.parse(fs.readFileSync(file, 'utf8'));
  const overrides = JSON.parse(fs.readFileSync(path.join(data, 'edison-scripts.json'), 'utf8'));
  core.scripts = applyOverrides(core.scripts, overrides);
  fs.writeFileSync(file, JSON.stringify(core));
  console.log(`Overrides angewandt: ${Object.keys(overrides.replace).join(', ')}`);
}
