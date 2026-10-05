#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
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
    } else if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function readCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return text.split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map(parseCsvLine);
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'variant';
}

function parseNumericValue(value) {
  const match = String(value || '').match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const raw = match[0].replace(',', '.');
  return Number.parseFloat(raw);
}

function inferScenarioPrompt(family, useCase, desFrogs) {
  const safeUseCase = useCase || family || 'dieses Szenario';
  const safeDes = Number.isFinite(desFrogs) ? desFrogs : 0;
  return `Gegner hat ${safeUseCase.toLowerCase()}. Du hast ${safeDes} Des Frogs.`;
}

function deriveTags(useCase, notes) {
  const text = `${useCase || ''} ${notes || ''}`.toLowerCase();
  const tags = {
    gorz: /gorz/.test(text),
    necro: /necro/.test(text),
    trag: /trag/.test(text),
    defense: /defense|def position|defense position/.test(text),
    tyt: /tyt/.test(text),
    foolishFrog: /foolish frog|foolish/.test(text),
    kalut: 0,
    setMonster: /set monster|set monster\(s\)|set monster\(s\)|set/.test(text),
    backrow: /backrow/.test(text),
    dandy: /dandy/.test(text),
    openBoard: /open board/.test(text),
    lowAtk: /<=800|less than or equal to 800|800 atk|800 atk/.test(text),
    highAtk: /1,6k|1.6k|1,9k|1.9k|1\.6k|1\.9k/.test(text),
    fooling: /foolish/i.test(text),
  };

  const kalutMatch = text.match(/(\d+)x?\s*kalut|kalut\s*[- ]?(\d+)/i);
  if (kalutMatch) {
    tags.kalut = Number(kalutMatch[1] || kalutMatch[2] || 0);
  }
  return tags;
}

function parseDamage(value) {
  const text = String(value || '').trim();
  if (!text) return { damage: null, damageNoGorz: null, damageGorz: null };

  const numMatch = text.match(/(\d+(?:[.,]\d+)?)\s*k/i);
  const numeric = numMatch ? Number.parseFloat(numMatch[1].replace(',', '.')) * 1000 : null;

  if (/no gorz/i.test(text) && /gorz/i.test(text)) {
    const noGorz = text.match(/no gorz[:\s]*([\d.,]+)\s*k/i)?.[1] ?? null;
    const gorz = text.match(/gorz\s*[:\s]*([\d.,]+)\s*k/i)?.[1] ?? null;
    return {
      damage: numeric,
      damageNoGorz: noGorz ? Number.parseFloat(noGorz.replace(',', '.')) * 1000 : null,
      damageGorz: gorz ? Number.parseFloat(gorz.replace(',', '.')) * 1000 : null,
    };
  }

  return { damage: numeric, damageNoGorz: null, damageGorz: null };
}

function parseMaterialCell(rawCell) {
  const text = String(rawCell || '').trim();
  if (!text) return { value: null, brioDisc: false };

  const brioDisc = /\(\+\)|\+\s*Brio|Brio disc/i.test(text);
  const cleaned = text
    .replace(/\(\+\)/gi, '')
    .replace(/\+\s*Brio\s*disc/gi, '')
    .replace(/\+\s*Brio/gi, '')
    .replace(/with\s+Moray|with\s+Avarice/gi, '')
    .trim();

  const match = cleaned.match(/-?\d+(?:[.,]\d+)?/);
  return {
    value: match ? Number.parseFloat(match[0].replace(',', '.')) : null,
    brioDisc,
    raw: rawCell,
  };
}

function parseMaterials(noBeelzeRaw, withBeelzeRaw) {
  const noBeelze = parseMaterialCell(noBeelzeRaw);
  const withBeelze = parseMaterialCell(withBeelzeRaw);

  const materialValue = {
    noBeelze: noBeelze.value,
    withBeelze: withBeelze.value,
    brioDisc: noBeelze.brioDisc || withBeelze.brioDisc,
  };

  const hasMultipleOptions = /with\s+Moray|with\s+Avarice|\d+\s*\(\+\)\s*\d+/.test(String(noBeelzeRaw || ''));
  return { materialValue, hasMultipleOptions };
}

function inferRequires(useCase, notes) {
  const text = `${useCase || ''} ${notes || ''}`.trim();
  const results = [];

  const directPatterns = [
    /requires?\s+([^,;]+)/i,
    /needs\s+([^,;]+)/i,
    /\bDandy\b/i,
    /\bMoray\b/i,
    /\bAvarice\b/i,
  ];

  for (const pattern of directPatterns) {
    const match = text.match(pattern);
    if (match) {
      const value = match[1] || match[0];
      if (value && !/requires?|needs?\s+/.test(value)) {
        results.push(value.trim());
      }
    }
  }

  if (/Dandy/i.test(text)) results.push('Dandy');
  if (/Moray/i.test(text) || /Avarice/i.test(text)) results.push('Moray or Avarice');

  return [...new Set(results)].slice(0, 6);
}

function extractSteps(notes) {
  const text = String(notes || '').trim();
  if (!text) return [];

  const numbered = [...text.matchAll(/(?:^|\s|[.;])\d+\.\s*([^.;\n]+)/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);

  if (numbered.length) return numbered;
  return [text];
}

function parseIntroRows(rows) {
  const notes = [];
  const countingRules = [];
  const extraDeckRequirements = [];

  const ruleLines = rows.filter((row) => row[0] && /material|exception|coun|deck|level|beelze/i.test(String(row[0])));
  for (const row of ruleLines) {
    const first = String(row[0] || '').trim();
    if (first) notes.push(first.replace(/\"/g, ''));
  }

  const headerIndex = rows.findIndex((row) => row.some((cell) => /Level/i.test(String(cell || ''))));
  if (headerIndex >= 0) {
    const header = rows[headerIndex];
    const levelColumn = header.findIndex((cell) => /Level/i.test(String(cell || '')));
    const columns = header.slice(levelColumn, levelColumn + 5);
    for (let i = headerIndex + 1; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.length < 5) continue;
      const levelValue = parseNumericValue(row[levelColumn]);
      if (!Number.isFinite(levelValue)) continue;
      extraDeckRequirements.push({
        level: levelValue,
        beelzeOrDes: parseNumericValue(row[levelColumn + 1]),
        justDes: parseNumericValue(row[levelColumn + 2]),
        justBeelze: parseNumericValue(row[levelColumn + 3]),
        none: parseNumericValue(row[levelColumn + 4]),
      });
    }
  }

  return {
    source: 'Forgs_Lines_OTK_Intro.csv',
    notes,
    countingRules: [
      'A card on the field or in hand counts as 1 material.',
      'Salvage/Avarice: 2 cards each.',
      'Dandylion: 3 cards.',
      'Foolish/FuFu send Dandy: 2 cards.',
      'Foolish/FuFu send Fishborg: 0 cards.',
      '141: 0 cards.',
      'Fishborg: 0 cards in hand when swap-pitched into the GY.',
    ],
    extraDeckRequirements,
  };
}

function main() {
  const lineRows = readCsv(path.join(dataDir, 'Forgs_Lines_OTK.csv'));
  const introRows = readCsv(path.join(dataDir, 'Forgs_Lines_OTK_Intro.csv'));

  const entries = [];
  const review = [];
  let currentFamily = null;
  let lastUseCase = null;
  let variantCounter = 0;

  for (const row of lineRows.slice(1)) {
    const family = (row[0] || '').trim();
    const useCase = (row[1] || '').trim() || lastUseCase || '';
    const desFrogs = parseNumericValue(row[2] ?? '');
    const endBoard = (row[3] || '').trim();
    const noBeelzeRaw = row[4] || '';
    const withBeelzeRaw = row[5] || '';
    const notes = (row[6] || '').trim();
    const replayWithBeelze = (row[7] || '').trim() || null;
    const replayNoBeelze = (row[8] || '').trim() || null;

    if (family) {
      currentFamily = family;
      variantCounter = 0;
    }

    if (useCase) {
      lastUseCase = useCase;
    }

    if (!family && !useCase && !endBoard && !notes) continue;

    variantCounter += 1;
    const parsedMaterials = parseMaterials(noBeelzeRaw, withBeelzeRaw);
    const damageInfo = parseDamage(endBoard);
    const requires = inferRequires(useCase, notes);
    const steps = extractSteps(notes);
    const familyName = family || currentFamily || 'Unknown';
    const scenarioPrompt = inferScenarioPrompt(familyName, useCase, desFrogs);
    const tags = deriveTags(useCase, notes);

    const needsReview = Boolean(
      !notes ||
      /same as above|above, but|this line has a bunch|if no|can skip|calc dmg|consider handtraps|kinda|maybe|or something/i.test(notes) ||
      !useCase ||
      parsedMaterials.hasMultipleOptions ||
      /No Gorz:|Gorz 8\.|No Gorz/i.test(endBoard) ||
      /\+\s*Brio|with Moray|with Avarice/i.test(noBeelzeRaw)
    );

    const entry = {
      id: slugify(`${familyName}-${desFrogs ?? 'variant'}-${variantCounter}`),
      family: familyName,
      subfamily: family ? null : lastUseCase || null,
      useCase,
      desFrogs: desFrogs,
      endBoard,
      damage: damageInfo.damage,
      damageNoGorz: damageInfo.damageNoGorz,
      damageGorz: damageInfo.damageGorz,
      materials: {
        noBeelze: parsedMaterials.materialValue.noBeelze,
        withBeelze: parsedMaterials.materialValue.withBeelze,
        brioDisc: parsedMaterials.materialValue.brioDisc,
      },
      requires,
      tags,
      notes,
      steps,
      scenarioPrompt,
      replay: {
        withBeelze: replayWithBeelze === 'n/a' ? null : replayWithBeelze || null,
        noBeelze: replayNoBeelze === 'n/a' ? null : replayNoBeelze || null,
      },
      needsReview,
    };

    if (needsReview) {
      review.push({ id: entry.id, family: entry.family, reason: 'Unclear or partially incomplete data; manual review recommended.' });
    }

    entries.push(entry);
  }

  const materialsDoc = parseIntroRows(introRows);

  fs.writeFileSync(path.join(dataDir, 'lines.json'), JSON.stringify(entries, null, 2) + '\n');
  fs.writeFileSync(path.join(dataDir, 'materials.json'), JSON.stringify(materialsDoc, null, 2) + '\n');

  console.log(`Generated ${entries.length} line variants.`);
  console.log(`Generated material reference document.`);
  console.log('Needs review items:');
  console.log(JSON.stringify(review, null, 2));
}

main();
