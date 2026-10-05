#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');

function parseCsvLine(line) {
  let current = '';
  let inQuotes = false;
  const cells = [];

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function readCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine);
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'variant';
}

function parseNum(value) {
  const match = String(value || '').match(/\d+(?:[.,]\d+)?/);
  if (!match) return null;
  return Number.parseFloat(match[0].replace(',', '.'));
}

function parseDamage(value) {
  const text = String(value || '').trim();
  if (!text) return { damage: null, damageNoGorz: null, damageGorz: null };

  const num = text.match(/(\d+(?:[.,]\d+)?)\s*k/i)?.[1];
  const damage = num ? Number.parseFloat(num.replace(',', '.')) * 1000 : null;

  if (/no gorz/i.test(text) && /gorz/i.test(text)) {
    const noGorz = text.match(/no gorz[:\s]*([\d.,]+)\s*k/i)?.[1];
    const gorz = text.match(/gorz\s*[:\s]*([\d.,]+)\s*k/i)?.[1];
    return {
      damage,
      damageNoGorz: noGorz ? Number.parseFloat(noGorz.replace(',', '.')) * 1000 : null,
      damageGorz: gorz ? Number.parseFloat(gorz.replace(',', '.')) * 1000 : null,
    };
  }

  return { damage, damageNoGorz: null, damageGorz: null };
}

function parseMaterialString(raw) {
  const text = String(raw || '').trim();
  if (!text) return { noBeelze: null, withBeelze: null, brioDisc: false };

  const brioDisc = /\(\+\)|Brio disc|\+ Brio/i.test(text);
  const cleaned = text
    .replace(/\(\+\)/gi, '')
    .replace(/\+\s*Brio\s*disc/gi, '')
    .replace(/\+\s*Brio/gi, '')
    .replace(/with\s+Moray|with\s+Avarice/gi, '')
    .trim();

  const value = parseNum(cleaned);
  return {
    noBeelze: value,
    withBeelze: null,
    brioDisc,
  };
}

function inferRequires(useCase, notes) {
  const text = `${useCase || ''} ${notes || ''}`.trim();
  const results = new Set();

  if (/Dandy/i.test(text)) results.add('Dandy');
  if (/Moray/i.test(text) || /Avarice/i.test(text)) results.add('Moray or Avarice');
  if (/requires?\s+([^,;]+)/i.test(text)) {
    const m = text.match(/requires?\s+([^,;]+)/i);
    if (m) results.add(m[1].trim());
  }

  return [...results];
}

function extractSteps(notes) {
  const text = String(notes || '').trim();
  if (!text) return [];

  const numbered = [...text.matchAll(/(?:^|\s|[.;])\d+\.\s*([^.;\n]+)/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);

  return numbered.length ? numbered : [text];
}

function inferScenarioPrompt(family, useCase, desFrogs) {
  const safeUseCase = useCase || family || 'dieses Szenario';
  const safeCount = Number.isFinite(desFrogs) ? desFrogs : 0;
  return `Gegner hat ${safeUseCase.toLowerCase()}. Du hast ${safeCount} Des Frogs.`;
}

function deriveTags(useCase, notes) {
  const full = `${useCase || ''} ${notes || ''}`.toLowerCase();
  const foundKalut = full.match(/(\d+)x?\s*kalut|kalut\s*[- ]?(\d+)/i);

  return {
    gorz: /gorz/.test(full),
    necro: /necro/.test(full),
    trag: /trag/.test(full),
    defense: /defense|def position|defense position/.test(full),
    tyt: /tyt/.test(full),
    foolishFrog: /foolish frog|foolish/.test(full),
    kalut: foundKalut ? Number(foundKalut[1] || foundKalut[2] || 0) : 0,
    setMonster: /set monster|set monster\(s\)/.test(full),
    backrow: /backrow/.test(full),
    dandy: /dandy/.test(full),
    openBoard: /open board/.test(full),
    lowAtk: /<=800|800 atk|less than or equal to 800/.test(full),
    highAtk: /1,6k|1\.6k|1,9k|1\.9k/.test(full),
    fooling: /foolish/.test(full),
  };
}

function parseRowsFromCsv(csvRows) {
  const entries = [];
  let currentFamily = null;
  let lastUseCase = null;
  let variantIndex = 0;

  for (const row of csvRows.slice(1)) {
    const family = String(row[0] || '').trim();
    const useCase = String(row[1] || '').trim() || lastUseCase || '';
    const desFrogs = parseNum(row[2]);
    const endBoard = String(row[3] || '').trim();
    const noBeelzeRaw = String(row[4] || '').trim();
    const withBeelzeRaw = String(row[5] || '').trim();
    const notes = String(row[6] || '').trim();
    const replayWithBeelze = String(row[7] || '').trim() || null;
    const replayNoBeelze = String(row[8] || '').trim() || null;

    if (family) {
      currentFamily = family;
      variantIndex = 0;
    }

    if (useCase) {
      lastUseCase = useCase;
    }

    if (!family && !useCase && !endBoard && !notes) continue;

    variantIndex += 1;

    const materialNo = parseMaterialString(noBeelzeRaw);
    const materialWith = parseMaterialString(withBeelzeRaw);
    const damage = parseDamage(endBoard);
    const requires = inferRequires(useCase, notes);
    const steps = extractSteps(notes);
    const familyName = family || currentFamily || 'Unknown';
    const idBase = `${familyName}-${desFrogs ?? 'variant'}-${variantIndex}`;

    const needReview = Boolean(
      !notes ||
      /same as above|above, but|this line has a bunch|if no|can skip|calc dmg|consider handtraps|or something/i.test(notes) ||
      /\d+\s*\(\+\)\s*\d+|with Moray|with Avarice|no gorz:|gorz 8\.|no gorz/i.test(endBoard) ||
      !useCase
    );

    entries.push({
      id: slugify(idBase),
      family: familyName,
      subfamily: family ? null : useCase,
      useCase,
      desFrogs,
      endBoard,
      damage: damage.damage,
      damageNoGorz: damage.damageNoGorz,
      damageGorz: damage.damageGorz,
      materials: {
        noBeelze: materialNo.noBeelze,
        withBeelze: materialWith.noBeelze,
        brioDisc: materialNo.brioDisc || materialWith.brioDisc,
      },
      requires,
      tags: deriveTags(useCase, notes),
      notes,
      steps,
      scenarioPrompt: inferScenarioPrompt(familyName, useCase, desFrogs),
      replay: {
        withBeelze: replayWithBeelze === 'n/a' ? null : replayWithBeelze || null,
        noBeelze: replayNoBeelze === 'n/a' ? null : replayNoBeelze || null,
      },
      needsReview: needReview,
    });
  }

  return entries;
}

function parseIntroCsv(csvRows) {
  const rows = csvRows.slice(1);
  const rules = [];
  const extraDeckRequirements = [];

  for (const row of rows) {
    const combined = row.join(' ');
    if (!combined) continue;
    if (/material|exception|beelze|des|deck|level/i.test(combined)) {
      rules.push(combined.replace(/\s+/g, ' ').trim());
    }
  }

  const dataStartIndex = rows.findIndex((row) => row.some((cell) => /Level/i.test(String(cell || ''))));
  if (dataStartIndex >= 0) {
    const header = rows[dataStartIndex];
    const levelIndex = header.findIndex((cell) => /Level/i.test(String(cell || '')));
    for (let i = dataStartIndex + 1; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.length < 5) continue;
      const level = parseNum(row[levelIndex]);
      if (!Number.isFinite(level)) continue;
      extraDeckRequirements.push({
        level,
        beelzeOrDes: parseNum(row[levelIndex + 1]),
        justDes: parseNum(row[levelIndex + 2]),
        justBeelze: parseNum(row[levelIndex + 3]),
        noBeelzeOrDes: parseNum(row[levelIndex + 4]),
      });
    }
  }

  return {
    source: 'Forgs_Lines_OTK_Intro.csv',
    rules,
    extraDeckRequirements,
    notes: [
      'A card on the field or in hand is worth 1 material, unless listed below.',
      'Salvage/Avarice = 2 cards.',
      'Dandylion = 3 cards.',
      'Foolish/FuFu send Dandy = 2 cards.',
      'Foolish/FuFu send Fishborg = 0 cards.',
      '141 = 0 cards.',
      'Fishborg is 0 in hand if swap-pitched into the GY.',
    ],
  };
}

function main() {
  const introRows = readCsv(path.join(dataDir, 'Forgs_Lines_OTK_Intro.csv'));
  const lineRows = readCsv(path.join(dataDir, 'Forgs_Lines_OTK.csv'));

  const lines = parseRowsFromCsv(lineRows);
  const materials = parseIntroCsv(introRows);

  fs.writeFileSync(path.join(dataDir, 'lines.json'), JSON.stringify(lines, null, 2) + '\n');
  fs.writeFileSync(path.join(dataDir, 'materials.json'), JSON.stringify(materials, null, 2) + '\n');
  console.log(`Wrote ${lines.length} line variants to data/lines.json`);
  console.log(`Wrote materials metadata to data/materials.json`);
}

main();
