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
node --no-warnings js/duel-core.test.mjs    # Bot Duel auf der echten Engine
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
  - `js/decide.js`: Entscheidungen des aktiven Bots (Merkmale, Score, Angriffsregel).
  - `js/guess.js`: Schätzung verdeckter Karten aus Decklist, offen gesehenen Karten, Zone und Setz-Tendenz
    (`data/set-tendencies.json`). Messung gegen die Engine: `node --no-warnings scripts/guess-eval.mjs`.
  - `js/lookahead.js`: Bot rechnet am Zuganfang seine 3 besten Kandidaten in je 4 Probewelten durch (neues Duell
    aus dem öffentlichen Brett, meine verdeckten Karten aus dem Restpool gezogen). Schalter: `opts.botHook = lookahead(opts)`,
    in der Brücke `POST /new { lookahead: true }`. Standard aus. Messung: `node --no-warnings scripts/bot-eval.mjs 100 lookahead`.
    `newGame` kann dafür eine ganze Stellung starten (`opts.start`) und an einem Zug anhalten (`opts.stopTurn`).
  - `js/advisor/`: Bewertungssystem für Kartenvorteil und situative Aktionswahl, als eigene Bot-Variante neben dem bisherigen Bot
    (Schalter `advisor` in `POST /new`, Standard aus). Die Engine misst jede Aktion in Probewelten, Dimensionen und Grenzen
    stehen in `docs/ADVISOR.md`, Gewichte in `data/advisor-weights.json`. Vergleich: `scripts/advisor-eval.mjs`; Vergleichsbasis
    ist der Tag `bot-baseline` (`data/bot-baseline.json`).
  - `scripts/bot-audit.mjs`: Prüfwerkzeug mit Ampeln (`--quick` ca. 6 min, `--full`), schreibt `docs/AUDIT_REPORT.md`.
    Prüft alle Tests, Einrückung, Links, Legalität, Determinismus, Laufzeit und Stärke (alt gegen Advisor, gleiche Seeds,
    Wilson-Intervall, Vorzeichentest), dazu `scripts/audit-leak.mjs` (nutzt der Bot verdeckte Gegnerkarten? Gegenprobe liest
    die Gegnerhand und muss durchfallen) und `scripts/audit-referee.mjs` (Schiedsrichter-Regeln je Bot-Entscheidung: tödlicher
    Schaden ungenutzt = hart; freier Angriff, Normalbeschwörung, leerer Zug = Hinweis; passiver Bot als Gegenprobe). Schwellen: `data/audit-thresholds.json`. Misst Stellvertreter, ersetzt keinen Menschen.
- Daten: `data/decks.json` (7 Decks), `data/cards.json` + `assets/cards-small/` (YGOPRODeck),
  `data/core-cards.json` + `data/core-scripts.json` (BabelCDB + ProjectIgnis CardScripts),
  `data/edison-banlist.json`.
- `data/edison-texts.json`: Edison-Kartentexte, die die aktuellen Texte überschreiben (nur Anzeige).
  Wird beim Erzeugen von `cards.json` angewendet (`scripts/fetch-cards.mjs`).
  Die Engine führt weiter die aktuellen Skripte aus. Bekannte Abweichungen: Brionac erlaubt nur gegnerische
  Ziele (Edison: beliebige Karten), Goyo Guardian ist optional (Edison: Pflicht). Eigene Edison-Skripte
  wären der nächste Schritt, falls das Verhalten stimmen soll.
- `data/edison-scripts.json`: eigene Anpassungen an den Engine-Skripten (z. B. Goyo Guardian ohne ERDE-Bedingung, Edison ist generisch).
  Wird von `scripts/fetch-core.mjs` angewandt; ohne Neu-Laden: `node --no-warnings scripts/apply-edison-overrides.mjs`.
- `scripts/fetch-cards.mjs`, `scripts/fetch-core.mjs`: laden die Daten neu. Nötig nach Änderungen an
  `data/decks.json` (neue Karten brauchen Kartendaten und Lua-Skript). Workflow „Karten laden“ macht beides.

## Godot-Brücke

`scripts/duel-server.mjs` stellt den Duell-Kern lokal als JSON über HTTP bereit (nur 127.0.0.1, Port 8131),
damit ein Godot-Projekt nur die Darstellung bauen muss. Routen und Zustandsformat stehen im Dateikopf.

```
node --no-warnings scripts/duel-server.mjs        # Brücke starten
node --no-warnings scripts/duel-server.test.mjs   # Test
```

`godot/bridge/` in ein Godot-4.3-Projekt kopieren (als `res://bridge/`) und `bridge_demo.tscn` starten:
ein komplettes Duell mit Text und Knöpfen. `state.events` ist der Ereignisstrom für einen Director.
Hauptszene ist `godot/duel3d/duel3d.tscn` (3D-Feld, Hand, LP-Ringe, Kartenbilder über `GET /image`, Friedhof per Klick,
Karten-Detail, Zieh-Animation). Der Nutzer startet sie in Godot; hier lässt sie sich nur mit `gdparse` auf Syntax prüfen.
Offene Design-Punkte für den Anime-Look: `godot/ROADMAP.md`.

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
