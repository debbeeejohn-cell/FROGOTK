# Handoff: Deck Tester

Projekt: FROGOTK (Frog OTK Lab), eine statische Web-App ohne Build.
Vanilla-JS-Module in `js/`, Daten in `data/`, Kartenbilder in `assets/cards-small/`. Alle Texte sind auf Deutsch.

Branch: `claude/ecstatic-pasteur-nr2jox`
Pull Request: https://github.com/debbeeejohn-cell/FROGOTK/pull/6 (offen, Ziel: `main`)

## Starten und testen

Die App läuft nur über einen Webserver, nicht per `file://`.

```bash
python3 -m http.server 8000      # dann http://localhost:8000/#tester öffnen
for f in js/*.test.mjs; do node $f; done
```

## Was der Tester kann

Tab "Tester", wie DuelingBook solo, ohne Regeln und ohne Automatik.

- Deck mischen und beliebig viele Karten ziehen.
- Karten per Klick spielen: Normalbeschwören, Monster setzen, Spezialbeschwören in ATK oder DEF, Aktivieren, Setzen.
- Karten auf Hand, Friedhof, Verbannt, oben oder unten aufs Deck bewegen. Extra-Deck-Monster gehen zurück ins Extra Deck.
- Auf dem Feld: Position wechseln und Zone wechseln.
- Spielfeld: Feldzone, 5 Monsterzonen, 5 Zauber-/Fallenzonen, 2 Linkzonen.
- Deck, Friedhof, Verbannt und Extra Deck öffnen sich mit Kartensuche. Das Deck wird alphabetisch sortiert angezeigt.
- Tokens, Rückgängig und Verlauf.

## Dateien

- `js/tester.js` (neu): Zustandslogik plus UI.
- `js/tester.test.mjs` (neu): Tests.
- Angebunden in `js/app.js`, `index.html` und `css/style.css`.
- Die Darstellung nutzt die vorhandenen `dl-*`-Styles des Bot Duels.

## Bekannte Lücken

- Wenn eine Karte im Deck liegt, gibt es die Aktion "Oben aufs Deck" nicht.
- Es gibt keine Auswahl mehrerer Karten gleichzeitig.
- Kein Speichern des Spielstands.

## Konventionen

- Wenig Code, keine neuen Abhängigkeiten.
- Tests laufen mit `node js/<name>.test.mjs`.
- Commit-Nachrichten auf Deutsch.
- PRs nur auf ausdrücklichen Wunsch.
