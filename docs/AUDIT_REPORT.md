# Audit-Bericht (quick)

Gemessen von `scripts/bot-audit.mjs`. 🟢 28  🟡 3  🔴 0.

**Grenzen:** Das Werkzeug stammt vom selben Autor wie der Bot (blinde Flecken möglich). Der Gegner spielt zufällig und ersetzt keinen Menschen.
Es misst Stellvertreter, keine „menschliche“ Spielweise. Schwellen stehen in `data/audit-thresholds.json`.

## Code

| | Prüfung | Ergebnis |
|---|---|---|
| 🟢 | Test js/advisor/chain.test.mjs | 1.3 s |
| 🟢 | Test js/advisor/dimensions.test.mjs | 0.0 s |
| 🟢 | Test js/advisor/index.test.mjs | 1.3 s |
| 🟢 | Test js/advisor/potential.test.mjs | 0.8 s |
| 🟢 | Test js/advisor/probe.test.mjs | 2.7 s |
| 🟢 | Test js/advisor/resources.test.mjs | 0.0 s |
| 🟢 | Test js/calc.test.mjs | 0.0 s |
| 🟢 | Test js/decklist.test.mjs | 0.0 s |
| 🟢 | Test js/duel-core.test.mjs | 1.3 s |
| 🟢 | Test js/guess.test.mjs | 0.0 s |
| 🟢 | Test js/opponent-lists.test.mjs | 0.0 s |
| 🟢 | Test js/sandbox.test.mjs | 0.0 s |
| 🟢 | Test js/ydk.test.mjs | 0.0 s |
| 🟢 | Test scripts/duel-server.test.mjs | 0.3 s |
| 🟢 | Test scripts/edison-db.test.mjs | 0.0 s |
| 🟢 | Test scripts/selfplay.test.mjs | 0.9 s |
| 🟢 | GDScript nur mit Tabs eingerückt | keine Leerzeichen-Einrückung |
| 🟢 | Links in Dokumenten | alle Ziele vorhanden |
| 🟢 | Dateien über 1200 Zeilen | keine |
| 🟡 | Nicht eingecheckte Änderungen | 4 Dateien |

## Bot

| | Prüfung | Ergebnis |
|---|---|---|
| 🟢 | Legalität, alter Bot: Partien zu Ende gespielt | 27/30 |
| 🟡 | Messartefakt, alter Bot: Zufallsspieler beendet den Zug nie | 3 Partien nach 600 Antworten abgebrochen: Bot gigavise gegen jinzoOtk, Seed 1000; Bot gigavise gegen jinzoOtk, Seed 1049; Bot gigavise gegen jinzoOtk, Seed 1063. Der Zufallsspieler wählt nie „Zug beenden“. |
| 🟢 | Laufzeit je Partie, alter Bot | Median 0.2 s, p95 0.6 s |
| 🟢 | Determinismus, alter Bot: gleicher Seed, gleiche Partie | 3/3 |
| 🟢 | Legalität, advisor: Partien zu Ende gespielt | 27/30 |
| 🟡 | Messartefakt, advisor: Zufallsspieler beendet den Zug nie | 3 Partien nach 600 Antworten abgebrochen: Bot gigavise gegen jinzoOtk, Seed 1042; Bot gigavise gegen jinzoOtk, Seed 1049; Bot gigavise gegen jinzoOtk, Seed 1063. Der Zufallsspieler wählt nie „Zug beenden“. |
| 🟢 | Laufzeit je Partie, advisor | Median 7.3 s, p95 28.1 s |
| 🟢 | Determinismus, advisor: gleicher Seed, gleiche Partie | 3/3 |
| 🟢 | Stärke frogOtk (Bot) gegen blackwing (Zufall) | alt 2/10, Advisor 5/10 (24 %–76 %); nur Advisor 4, nur alt 1, p=0.375: nicht unterscheidbar |
| 🟢 | Stärke blackwing (Bot) gegen frogOtk (Zufall) | alt 10/10, Advisor 10/10 (72 %–100 %); nur Advisor 0, nur alt 0, p=1.000: nicht unterscheidbar |
| 🟢 | Stärke gigavise (Bot) gegen jinzoOtk (Zufall) | alt 0/10, Advisor 5/10 (24 %–76 %); nur Advisor 5, nur alt 0, p=0.063: nicht unterscheidbar |
