# Architektur des Edison-Duell-Projekts (Ist-Stand, Phase 0)

Stand: Analyse des Repositories. Keine Änderung am Spielverhalten. Alle Angaben sind aus dem Code gelesen;
was nicht geprüft wurde, steht unter „Nicht geprüft“.

## Überblick

Das Projekt besteht aus drei getrennten Teilen:

| Teil | Sprache | Verantwortung | Startpfad |
|---|---|---|---|
| Lernseite | JavaScript (ES-Module), statisch | Lernen, Rechner, Quiz, Lexikon, Bot-Duell-Oberfläche (2D) | `index.html`, `js/app.js` |
| Duell-Kern | JavaScript (Node) + WebAssembly-Engine | Regeln, legale Aktionen, Chains, Bot, Lehrer | `scripts/duel-server.mjs` → `js/duel-core.js` |
| 3D-Client | GDScript (Godot 4) | Darstellung, Kamera, Eingabe, Animation | `godot/project.godot` → `godot/duel3d/duel3d.tscn` |

Der 3D-Client und der Duell-Kern sind über HTTP verbunden (`127.0.0.1:8131`, JSON). Die Brücke ist
`scripts/duel-server.mjs`; ihre Routen stehen im Dateikopf.

## Die zehn Fragen aus dem Projektauftrag

### 1. Welche Datei steuert das aktive Duell?

- Godot: `godot/duel3d/duel3d.gd` (Hauptskript von `duel3d/duel3d.tscn`, siehe `godot/project.godot`, Zeile 10).
  Es verbindet alles: Kamera, Feld, Regie, Oberfläche, Brücke.
- Engine-Seite: `js/duel-core.js` (`newGame`, `run`, `respond`). Die Brücke `scripts/duel-server.mjs` hält genau
  ein Duell (`let s`, Route `POST /new`).

### 2. Wo wird der Spielzustand erzeugt?

- `js/duel-core.js`, `newGame()`: legt das Engine-Duell an, verarbeitet Nachrichten in `onMessage()` und
  `run()`, und hält `g.prompt` (genau eine offene Frage).
- `scripts/duel-server.mjs`, `state()`: übersetzt den Kern-Zustand in JSON für Godot (Felder, Prompt, Ereignisse,
  Karten-Fakten).

### 3. Wo werden legale Aktionen bestimmt?

- Die Engine. Die Brücke übernimmt die Angebote der Engine: `describe(p)` in `scripts/duel-server.mjs` macht aus jeder
  Engine-Frage `choices`, ohne eigene Regelprüfung. Das ist die einzige Quelle für legale Aktionen (Regel 4 des Auftrags
  wird damit eingehalten).
- Automatische Antworten ohne Spielerentscheidung: `autoAnswer()` in `js/duel-core.js`.

### 4. Wo werden Aktionen ausgeführt?

- Engine: `lib.duelSetResponse(h, response)` in `js/duel-core.js` (in `g.respond` und `run`).
- Godot sendet nur Auswahl-IDs: `bridge/duel_client.gd` → `choose(id)`, `pick(ids)`; die Brücke ruft `answer()`.

### 5. Wo werden Chains verarbeitet?

- Regeln: vollständig in der Engine (ocgcore). Die JS-Schicht entscheidet nur, ob ein Kettenfenster angeboten wird:
  `wantsChain` in `js/duel-core.js`.
- Darstellung: `godot/duel3d/director.gd`, `_chain()`, `_activation()`: Umklappen, Leuchten oder Strahlen je nach Herkunft
  der Karte. Eine Chain-Übersicht (Link-Nummern, Auflösungsreihenfolge) gibt es noch nicht.

### 6. Wie werden Ereignisse an Godot übergeben?

- `js/duel-core.js`: `EVENT`-Tabelle und `g.events` (Typen: `turn, phase, draw, summon, set, chain, negate, move,
  attack, damage, pay, heal, win`).
- Brücke: `state()` liefert `events` seit dem letzten Zustand (`s.sent`).
- Godot: `duel_client.gd` sendet `state_changed`; `duel3d.gd` legt Zustände in eine Warteschlange (`_queue`,
  `_drain`); `director.gd` spielt die Ereignisse nacheinander (`play`, `_event`).

### 7. Wie werden Karten in 3D dargestellt?

- `godot/duel3d/card_view.gd`: eine Karte auf dem Feld (Fläche, Rückseite, Bild aus `res://art/cards/<name>.png`
  oder aus der Brücke, Platzhalter-Figur, runde ATK/DEF-Plakette).
- `godot/duel3d/board.gd`: Arena (Straße, Zonen, Stapel, Duellanten), Zonenpositionen (`zone_pos`), Hand (`sync_hand`),
  Treffer-Erkennung (`pick`).
- Bilder: `GET /image` der Brücke, Dateien aus `assets/cards-small/` (siehe Schwachstellen).

### 8. Wie werden Spieleraktionen verarbeitet?

- `godot/duel3d/duel3d.gd`: `_unhandled_input` / `_input` (Klick auf Karte, Mausbewegung für die Detailansicht,
  Taste T für das Tempo). Eine angeklickte Karte mit mehreren Aktionen öffnet eine kleine Leiste (`action_popup`),
  sonst wird die Aktion sofort gewählt (`_on_choice`).
- Knöpfe für Aktionen ohne Karte (Phase, Ja/Nein, Bestätigen) in `buttons`.

### 9. Wo befindet sich die aktuelle Bot-Logik?

- Aktiver Bot (Heuristik): `js/decide.js` (`botPlay`, `bestMainAction`, `mainCandidates`, `features`, `score`,
  `pickSoftmax` ohne Aufruf).
- Lookahead: `js/lookahead.js` (`lookahead`, `rollout`, `snapshot`, `value`); wird über `opts.botHook` eingehängt,
  Standard aus.
- Verdeckte Karten: `js/guess.js` (Restpool, Setz-Tendenz, Zonenfilter); Setz-Tendenzen in `data/set-tendencies.json`.
- Passiver Bot: `botAnswer()` in `js/duel-core.js`.
- Der Godot-Client enthält keine Bot-Logik.

### 10. Welche Komponenten sind veraltet oder werden nicht mehr verwendet?

Im Startpfad von Godot nicht verwendet (siehe `godot/project.godot`, `duel3d/duel3d.gd`, `bridge/duel_client.gd`):

| Datei | Befund |
|---|---|
| `godot/core/duel.gd` | Zweite Regel-Engine in GDScript (Platzhalter-Kartenwerte). Doppelte Regeln, widerspricht Regel 3 des Auftrags. Nicht importiert. |
| `godot/core/card_db.gd` | Platzhalter-Kartenwerte („Kartenwerte sind PLATZHALTER“). Nicht importiert. |
| `godot/presentation/director.gd` | 2D-Regie für `core/duel.gd`, nicht importiert. |
| `godot/presentation/director3d.gd` | 3D-Regie für `core/duel.gd`, nicht importiert. |
| `godot/main.gd`, `godot/main.tscn` | Hot-Seat-Prototyp, nicht Hauptszene (Hauptszene ist `duel3d/duel3d.tscn`). |
| `godot/tests/*` | Testszene für `core/duel.gd`; keine Verbindung zum aktiven Pfad. |
| `godot/bridge/bridge_demo.*` | Textversion des Duells als Demo für die Brücke; startet nicht automatisch. |

Im Repo, aber ohne aktive Verwendung:
- `godot/duel3d/summon_show.gd` wird verwendet (Beschwörungs-Einblendung). Kein Problem.
- `js/decide.js`, `pickSoftmax`: definiert und getestet, im Bot nicht aufgerufen (Temperatur 0).
- `js/duel.js` (2D-Bot-Duell der Webseite) ist eine zweite Oberfläche auf demselben Kern, nicht veraltet.

## Verantwortlichkeiten (Soll-Zuordnung zum Auftrag)

| Auftragsteil | Heute vorhanden | Fehlt |
|---|---|---|
| Regel-Engine (einzige Autorität) | ocgcore in `vendor/` über `js/duel-core.js` | Keine Lücken bekannt; Edison-Abweichungen in `data/edison-*.json` |
| Beobachtungsmodell | Teilweise in `js/guess.js`, `js/duel-core.js` (öffentliche Karten) | Kein eigenes Modul |
| Bewertung | `js/decide.js` (Board, Schaden, Hand, Risiko; die Auftrags-Merkmale Ressourcen und Zukunft fehlen) | Fünf Merkmale nach Auftrag, Profile |
| Gegner-Modell, Duell-Gedächtnis | Nicht vorhanden | Ganz |
| Logging | `g.botLog`, `decisions` in der Brücke | Keine Auswahlwahrscheinlichkeiten |
| Chain-Übersicht | Nicht vorhanden | Ganz |
| Duellprotokoll und Replay | Ereignisse in `g.events`, Protokoll-Zeilen in `g.log` | Kein Protokoll in Godot, kein Replay |
| Phasenanzeige | Banner in `banner.gd` (nur bei Wechsel) | Dauerhafte Anzeige |

## Datenfluss (Kurzfassung)

```
Spieler (Maus) ──► duel3d.gd ──► duel_client.gd ──HTTP──► duel-server.mjs
                                                              │
                                                       duel-core.js
                                                       (ocgcore, Bot, Lehrer)
                                                              │
state (Felder, Prompt, events, cards) ◄──────────────────────┘
      │
      ▼
duel3d.gd (Warteschlange) ──► director.gd (Ereignisse nacheinander) ──► board.gd / card_view.gd (3D)
```

## Nicht geprüft

- Laufzeit der Godot-Szene (nie gestartet; nur `gdparse`).
- Vollständigkeit der Edison-Banlist gegen das Original.
- Browser-Oberfläche der Webseite (nur Quelltext gelesen).
