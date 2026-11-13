# Audit-Bericht (full)

Gemessen von `scripts/bot-audit.mjs`. 🟢 43  🟡 2  🔴 0.

**Grenzen:** Das Werkzeug stammt vom selben Autor wie der Bot (blinde Flecken möglich). Der Gegner spielt zufällig und ersetzt keinen Menschen.
Es misst Stellvertreter, keine „menschliche“ Spielweise. Schwellen stehen in `data/audit-thresholds.json`.

## Code

| | Prüfung | Ergebnis |
|---|---|---|
| 🟢 | Test js/advisor/chain.test.mjs | 1.4 s |
| 🟢 | Test js/advisor/dimensions.test.mjs | 0.0 s |
| 🟢 | Test js/advisor/index.test.mjs | 1.5 s |
| 🟢 | Test js/advisor/potential.test.mjs | 0.8 s |
| 🟢 | Test js/advisor/probe.test.mjs | 2.9 s |
| 🟢 | Test js/advisor/resources.test.mjs | 0.0 s |
| 🟢 | Test js/calc.test.mjs | 0.0 s |
| 🟢 | Test js/decklist.test.mjs | 0.0 s |
| 🟢 | Test js/duel-core.test.mjs | 1.5 s |
| 🟢 | Test js/guess.test.mjs | 0.0 s |
| 🟢 | Test js/opponent-lists.test.mjs | 0.0 s |
| 🟢 | Test js/sandbox.test.mjs | 0.0 s |
| 🟢 | Test js/ydk.test.mjs | 0.0 s |
| 🟢 | Test scripts/duel-server.test.mjs | 0.4 s |
| 🟢 | Test scripts/edison-db.test.mjs | 0.0 s |
| 🟢 | Test scripts/selfplay.test.mjs | 1.9 s |
| 🟢 | GDScript nur mit Tabs eingerückt | keine Leerzeichen-Einrückung |
| 🟢 | Links in Dokumenten | alle Ziele vorhanden |
| 🟢 | Dateien über 1200 Zeilen | keine |
| 🟢 | Nicht eingecheckte Änderungen | sauber |

## Schiedsrichter

| | Prüfung | Ergebnis |
|---|---|---|
| 🟢 | Engine-Fehler, alter Bot | keine in 120 Partien |
| 🟢 | Tödlicher Schaden nicht genutzt, alter Bot | keiner in 596 Bot-Zügen |
| 🟢 | freier Angriff, alter Bot (Hinweis) | 0 in 596 Bot-Zügen = 0 % (Schwelle 5 %) |
| 🟢 | Normalbeschwörung, alter Bot (Hinweis) | 0 in 596 Bot-Zügen = 0 % (Schwelle 25 %) |
| 🟢 | leerer Zug, alter Bot (Hinweis) | 0 in 596 Bot-Zügen = 0 % (Schwelle 10 %) |
| 🟢 | Engine-Fehler, advisor | keine in 120 Partien |
| 🟢 | Tödlicher Schaden nicht genutzt, advisor | keiner in 608 Bot-Zügen |
| 🟢 | freier Angriff, advisor (Hinweis) | 0 in 608 Bot-Zügen = 0 % (Schwelle 5 %) |
| 🟢 | Normalbeschwörung, advisor (Hinweis) | 0 in 608 Bot-Zügen = 0 % (Schwelle 25 %) |
| 🟢 | leerer Zug, advisor (Hinweis) | 0 in 608 Bot-Zügen = 0 % (Schwelle 10 %) |
| 🟢 | Arena: Bot gegen Gegner mit den Regeln des alten Bots | alt 39/120, Advisor 47/120 (31 %–48 %); nur Advisor 8, nur alt 0, p=0.008: Advisor klar besser |

## Bot

| | Prüfung | Ergebnis |
|---|---|---|
| 🟢 | Verdeckte Information, alter Bot | 40/40 Stellungen gleich entschieden |
| 🟢 | Verdeckte Information, advisor | 40/40 Stellungen gleich entschieden |
| 🟢 | Gegenprobe (liest die Gegnerhand) | 40/40 Stellungen unterschiedlich: Prüfung erkennt Lecks |
| 🟢 | Legalität, alter Bot: Partien zu Ende gespielt | 134/150 |
| 🟡 | Messartefakt, alter Bot: Zufallsspieler beendet den Zug nie | 16 Partien nach 600 Antworten abgebrochen: Bot gigavise gegen jinzoOtk, Seed 1000; Bot gigavise gegen jinzoOtk, Seed 1049; Bot gigavise gegen jinzoOtk, Seed 1063. Der Zufallsspieler wählt nie „Zug beenden“. |
| 🟢 | Laufzeit je Partie, alter Bot | Median 0.2 s, p95 0.5 s |
| 🟢 | Determinismus, alter Bot: gleicher Seed, gleiche Partie | 3/3 |
| 🟢 | Legalität, advisor: Partien zu Ende gespielt | 136/150 |
| 🟡 | Messartefakt, advisor: Zufallsspieler beendet den Zug nie | 14 Partien nach 600 Antworten abgebrochen: Bot gigavise gegen jinzoOtk, Seed 1042; Bot gigavise gegen jinzoOtk, Seed 1049; Bot gigavise gegen jinzoOtk, Seed 1063. Der Zufallsspieler wählt nie „Zug beenden“. |
| 🟢 | Laufzeit je Partie, advisor | Median 5.4 s, p95 20.4 s |
| 🟢 | Determinismus, advisor: gleicher Seed, gleiche Partie | 3/3 |
| 🟢 | Stärke frogOtk (Bot) gegen blackwing (Zufall) | alt 25/50, Advisor 23/50 (33 %–60 %); nur Advisor 11, nur alt 13, p=0.839: nicht unterscheidbar |
| 🟢 | Stärke blackwing (Bot) gegen frogOtk (Zufall) | alt 50/50, Advisor 50/50 (93 %–100 %); nur Advisor 0, nur alt 0, p=1.000: nicht unterscheidbar |
| 🟢 | Stärke gigavise (Bot) gegen jinzoOtk (Zufall) | alt 6/50, Advisor 29/50 (44 %–71 %); nur Advisor 26, nur alt 3, p=0.000: Advisor klar besser |
