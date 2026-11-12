# Entwicklungs-Roadmap (Phase 0)

Grundlage: `docs/PROJECT_ARCHITECTURE.md`. Prioritäten aus dem Projektauftrag, Abhängigkeiten und vorhandene Bausteine.
Diese Datei ändert keine Spielmechanik.

## Größte technische Schwachstellen

1. **Doppelte Regel-Engine in Godot.** `godot/core/duel.gd` mit Platzhalter-Kartenwerten (`core/card_db.gd`) ist nicht
   angebunden, verstößt aber gegen die Regel „keine doppelte Implementierung derselben Spielregeln“. Entfernen.
2. **Veraltete Godot-Dateien** im Projekt: `presentation/`, `main.gd`/`main.tscn`, `tests/`, `bridge/bridge_demo.*`
   (Demo, startet nicht automatisch). Verwirrung beim Lesen; zu entfernen oder zu markieren.
3. **Godot-Code nie gestartet.** Alles nur mit `gdparse` geprüft. Die Parser-Prüfung meldet gemischte Einrückung nicht
   (aufgetreten bei `board.gd`). Es braucht einen Lauf in Godot und eine Prüfung per Skript.
4. **Konami-Bilder öffentlich im Repo** (`assets/cards-small/`, 123 Dateien). Verstößt gegen die eigene Regel in
   `godot/HANDOFF.md`. Entscheidung offen.
5. **Keine Chain-Übersicht und kein Duellprotokoll** in Godot; die Chain-Ereignisse existieren (`chain`, `negate`),
   werden aber nur als Einzelanimation gezeigt.
6. **Bot ohne Beobachtungsmodell und Gedächtnis:** `js/decide.js` bewertet nur Board, Schaden, Hand und Risiko. Die
   Auftrags-Merkmale Ressourcen und Zukunft fehlen; Profile fehlen; `pickSoftmax` ist ungenutzt.
7. **Ungeklärte Regelabweichung:** Goyo Guardian mit Fishborg Blaster und Des Frog wird nicht als Synchro angeboten,
   obwohl die Stufen passen. Ursache nicht gefunden (Materialregel von Fishborg Blaster ist eine Vermutung).
8. **Edison-Texte:** `data/edison-texts.json` überschreibt nur die Anzeige; die Engine führt aktuelle Skripte aus.
   Bekannte Abweichungen stehen in `CLAUDE.md`. `data/edison-scripts.json` ist der erste Schritt zu eigenen Edison-Skripten.
9. **Zwei Oberflächen auf demselben Kern** (Webseite `js/duel.js` und Godot). Kein Fehler, aber jede Regelhilfe
   (Lehrer, Protokoll) muss zweimal gebaut werden, sobald sie nicht im Kern liegt.

## Gut gelöst

- **Eine Regel-Quelle:** Die Engine (ocgcore) entscheidet über Legalität; die Brücke und Godot zeigen nur Angebote
  (`describe` in `scripts/duel-server.mjs`).
- **Verdeckte Information:** Die Brücke nennt keine verdeckten Karten (Test `bot sets are unnamed`); der Bot schätzt
  verdeckte Karten nur aus öffentlichen Daten (`js/guess.js`, Messung `scripts/guess-eval.mjs`).
- **Reproduzierbarkeit:** Seeds, Replays, Undo, Combo-Abspielen, Lookahead mit gleicher Partie gleich
  (Test in `js/duel-core.test.mjs`).
- **Messbarkeit des Bots:** `scripts/bot-eval.mjs` (Siegquote, Zuganzahl), `scripts/selfplay.mjs` (Aufzeichnung).
- **Trennung Daten und Code:** Kartenbank (`data/edison-db.json`), Banlist, Edison-Texte und Skript-Anpassungen liegen in
  `data/`, mit Tests (`scripts/edison-db.test.mjs`).
- **Testabdeckung im Kern:** `js/*.test.mjs` und `scripts/*.test.mjs`, alle als `assert`-Skripte.

## Prioritäten (Auftrag, Reihenfolge)

| # | Thema | Vorhanden | Abhängig von | Nächster Schritt |
|---|---|---|---|---|
| 1 | Analyse, Architektur, Schwachstellen | Diese Dokumente | – | Freigabe abwarten |
| 2 | 3D-Straßenarena verbessern (Asphalt, Licht, Schatten, Kamera) | Arena in `board.gd` (`_build_arena`), Kamera in `duel3d.gd` | Lauf in Godot (Schwachstelle 3) | Erst Laufzeit prüfen, dann Licht und Material |
| 3 | UI und Bedienbarkeit (LP, Phasen, Handkarten, Karteninfo, Aktionsleiste) | LP-Ring, Phasen-Banner, Karten-Detail, Aktionsleiste (`duel3d.gd`) | 2 | Dauerhafte Phasenanzeige, Handfächer |
| 4 | Chain-System darstellen (Link-Nummern, Reihenfolge, Modi) | Einzelne Aktivierung (`director.gd`), Ereignisse `chain`/`negate` | 3 | Chain-Übersicht aus `g.events` (kein Regelcode in Godot) |
| 5 | Duellprotokoll und Replay | `g.events`, `g.log`, Selfplay-Format | 4 | Protokoll in Godot aus den Ereignissen; Replay über Seed und Antworten |
| 6 | Bot-Entscheidungsmodul (Beobachtung, Bewertung, Profile, Gedächtnis, Log) | `js/decide.js`, `js/guess.js`, `js/lookahead.js`, `botLog`; neu: `js/advisor/` (Kartenvorteil, Dimensionen, Probewelten, Kettenfenster, Log, siehe `docs/ADVISOR.md`) | Schwachstelle 6 | Profile als Daten, Duell-Gedächtnis, Gegner-Modell; mehr Auslöser in Ketten |
| 7 | Edison-Regeltests (Gorz/Caius, Battle Fader, Kalut, Ryko/Dupe Frog, …) | Testfälle in `js/duel-core.test.mjs` | Schwachstelle 7 | Jede Interaktion als Testfall, Quelle je Fall |
| 8 | Atmosphäre, Duellanten, Animationen | Platzhalter-Figuren, Strahlen, Umklappen | 2 | Nach Priorität 2–4 |

Deckeditor und Online-Mehrspieler: keine hohe Priorität (laut Auftrag).

## Reihenfolge der nächsten Schritte

1. **Freigabe** dieser Phase.
2. **Godot-Lauf** (du): Projekt starten, Fehler melden. Ohne diesen Lauf ist jede Änderung an Priorität 2–4 unsicher.
3. **Aufräumen** der veralteten Godot-Dateien (Schwachstelle 1 und 2), nach deiner Bestätigung.
4. **Entscheidung** Konami-Bilder (Schwachstelle 4) und Goyo-Synchro (Schwachstelle 7).
5. Priorität 2 → 3 → 4 → 5, jeweils mit Test oder Lauf vor dem nächsten Schritt.

## Abhängigkeiten (Kurzfassung)

```
Godot-Lauf ──► Arena (2) ──► UI (3) ──► Chain (4) ──► Protokoll/Replay (5)
                    └──────────► Atmosphäre (8)
Bot-Modul (6) ◄── Beobachtung/Gegner-Modell (aus öffentlichen Ereignissen)
Regeltests (7) ── unabhängig, bestehen aus Engine-Tests
```

## Verifikation der Phase 0

- Alle Tests bleiben grün (keine Code-Änderung): `node --no-warnings js/duel-core.test.mjs`,
  `scripts/duel-server.test.mjs`, `scripts/selfplay.test.mjs`, `js/calc.test.mjs`, `js/guess.test.mjs`,
  `scripts/edison-db.test.mjs`.
- Die in den Dokumenten genannten Dateipfade existieren (nachgeprüft beim Schreiben).
