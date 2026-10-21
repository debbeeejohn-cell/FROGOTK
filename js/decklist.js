// Parses a pasted decklist or the text of a .ydk file into { main, extra, side },
// each [{ card, count }]. Understands:
//   .ydk   "#main" / "#extra" / "!side" headers with one passcode per line
//   text   "3 Des Frog", "3x Des Frog", "Des Frog x3", a bare name (= 1 copy)
// options.idToName: Map(passcode -> name) to turn .ydk ids into names
// options.known:    Set(lowercase names) so "7 Colored Fish" is not read as 7x "Colored Fish"

const HEADERS = [
  [/^(#main|main(?: deck)?\s*:?\s*\(?\d*\)?)$/i, 'main'],
  [/^(#extra|extra(?: deck)?\s*:?\s*\(?\d*\)?)$/i, 'extra'],
  [/^(!side|side(?: deck)?\s*:?\s*\(?\d*\)?)$/i, 'side']
];

const MAX_LINE = 120; // longer lines are not card names; also keeps the regexes cheap

export function parseDecklist(text, { idToName = new Map(), known = new Set() } = {}) {
  const sections = { main: new Map(), extra: new Map(), side: new Map() };
  const unknownIds = new Set();
  let section = 'main';

  const add = (name, count) => {
    const map = sections[section];
    const key = name.toLowerCase();
    const prev = map.get(key);
    map.set(key, { card: prev?.card ?? name, count: (prev?.count ?? 0) + count });
  };

  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.length > MAX_LINE || line.startsWith('//')) continue;

    const header = HEADERS.find(([re]) => re.test(line));
    if (header) { section = header[1]; continue; }
    if (line.startsWith('#') || line.startsWith('!')) continue; // other ydk comments

    if (/^\d{4,}$/.test(line)) { // a passcode
      const name = idToName.get(Number(line)) ?? idToName.get(line);
      if (!name) unknownIds.add(line);
      add(name ?? `Karte #${line}`, 1);
      continue;
    }

    let m;
    if (known.has(line.toLowerCase())) add(line, 1);
    else if ((m = line.match(/^(\d+)\s*[x×]?\s+(.+)$/i))) add(m[2].trim(), Number(m[1]));
    else if ((m = line.match(/^(.+?)\s*[x×]\s*(\d+)$/i))) add(m[1].trim(), Number(m[2]));
    else add(line, 1);
  }

  const list = (map) => [...map.values()];
  return { main: list(sections.main), extra: list(sections.extra), side: list(sections.side), unknownIds: [...unknownIds] };
}
