# Frog OTK Lab (Edison-Lernseite)

Deutschsprachige Lern- und Übungsseite für das Yu-Gi-Oh!-Edison-Format (Banlist März 2010):
Frog OTK, Gigavise, Jinzo OTK, Blackwing. Statische Seite, Vanilla-ES-Module, kein Build-Schritt.
GitHub Pages veröffentlicht den Branch `main`.

## Lokal starten

```
python -m http.server 8130      # dann http://localhost:8130/ öffnen
```

`index.html` per Doppelklick funktioniert nicht (ES-Module und `fetch` brauchen http).

## Tests

```
node --no-warnings js/duel-core.test.mjs    # Bot Duel auf der echten Engine (Node >= 22.5)
node js/calc.test.mjs && node js/decklist.test.mjs && node js/sandbox.test.mjs && node js/ydk.test.mjs
```

Kein Test-Framework: jede Datei ist ein `assert`-Skript und endet mit „all checks passed“.

## Aufbau

- `index.html`, `css/style.css`, `js/app.js`: Tabs Lernen, Quiz, Rechner, Sandbox, Bot Duel, Lexikon, Fortschritt.
  Globaler Deck-Schalter (`[data-deck-switch]`), Einstellungen in localStorage `frogOtk.v1` (`js/store.js`).
- `js/calc.js`: exakter hypergeometrischer Rechner (BigInt), Deck-Import über `js/decklist.js`.
- `js/sandbox.js`: aufgezeichnete Frog-OTK-Line nachspielen (`data/open-8k-3des.json`).
- **Bot Duel**
  - `vendor/ocgcore/`: EDOPro-Engine als WebAssembly (ocgcore-wasm 0.1.6, MIT; ygopro-core AGPL-3.0).
  - `js/duel-core.js`: Engine-Nachrichten → Spielzustand mit EINER offenen Frage (`g.prompt`).
    Enthält: seeded Deck-Mischen (die Engine mischt nicht), automatische Antworten (Zonen, leere
    Kettenfenster), passiven Bot (`botAnswer`), aktiven Bot nach Faustregeln (`botPlay`),
    Lehrer (`teach`, `compareCombo`). Regelmodus `MODE_MR1` = Regeln von 2010.
  - `js/duel.js`: Oberfläche. Zeigt nur Aktionen, die die Engine anbietet; Dialoge für Ketten,
    Kartenwahl, Summen, Position, Ansagen. Rückgängig = Duell mit gleichem Seed neu abspielen.
    Combos (Setup + Seed + Antworten) liegen in localStorage `duelLines`.
- Daten: `data/decks.json` (7 Decks), `data/cards.json` + `assets/cards-small/` (YGOPRODeck),
  `data/core-cards.json` + `data/core-scripts.json` (BabelCDB + ProjectIgnis CardScripts),
  `data/edison-banlist.json`.
- `scripts/fetch-cards.mjs`, `scripts/fetch-core.mjs`: laden die Daten neu. Nötig nach Änderungen an
  `data/decks.json` (neue Karten brauchen Kartendaten und Lua-Skript). Workflow „Karten laden“ macht beides.

## Regeln für Änderungen

- Schlank bleiben: keine Abhängigkeiten, kein Build, keine Abstraktion ohne zweiten Nutzer.
- Jede Engine-Änderung zuerst als Fall in `js/duel-core.test.mjs`, dann die Oberfläche.
- HTML nur über `esc()` (`js/util.js`) zusammenbauen. CSP steht in `index.html`
  (`script-src 'self' 'wasm-unsafe-eval'`).
- Gestaltung: keine Leuchtschatten, keine dicken farbigen Seitenränder, Innenabstand mindestens 8 px,
  Bedienelemente mindestens 44 px hoch.
- Fallen der Engine: Abfrage-Flag `TYPE` bricht den Parser von `duelQueryLocation`; Handkarten haben
  für die Engine die Position „verdeckt“; Tokens haben eigene Passcodes und kein Skript.

## Stand und offene Punkte

Fertig: Starthand wählen, Combos speichern/abspielen, Lehrer (Regel-Checks und Combo-Vergleich),
aktiver Bot (Zauber, Spezialbeschwörungen, Synchros, Angriff mit kleinster ATK zuerst).

Offen:
1. Eigene Decks im Duell: Skripte für den ganzen Edison-Pool statt nur für die 7 Decks (Grundlage Deckbuilder).
2. Bot: Tributbeschwörungen, Gorz- und Fallen-Vorsicht, Deckpläne für Gladiator Beast und Frog Monarch
   (Decklisten fehlen noch).
3. Lehrer Stufe 3: Engine sucht bessere Züge (erst Laufzeit messen).
4. Deutsche Texte für die Engine-Fragen.
5. Seite privat machen (Vorschlag: Cloudflare Pages + Access) oder Fußzeile mit Quelltext-Link und
   Fan-Projekt-Hinweis.
