# HANDOFF: Yu-Gi-Oh-Duell-Prototyp (Godot, 2D)

Stand: 2026-11-06. Sprache mit dem User: Deutsch. Code und Kommentare: Deutsch/Englisch gemischt, kurz halten.
Der User hat nur wenige Tokens. Arbeite knapp, liefere lauffähige Schritte, keine langen Erklärungen.

## Ziel
Ein spielbarer Vertical Slice eines Yu-Gi-Oh-Duells im Anime-Stil, zuerst rein 2D, Edison-Format (April-2010-Banlist-Ära).
- 1v1, Hot-Seat oder einfache KI, ca. 30-40 Karten, zwei feste Decks (z. B. Frogs gegen ein Gegner-Deck).
- Angriffs-Cinematic: Kamera-Zoom, Hit-Stop, Shake, Treffer-Blitz, Zerstörung.
- Nicht im Umfang: Online-Multiplayer, vollständige Regeln, Verkauf.

## Stand (alles OHNE Ausführung geschrieben, Godot war im Schreib-Sandkasten nicht installiert)
Erster Schritt im neuen Setup: `godot --headless -s tests/test_duel.gd` und danach F5. Kleine GDScript-Fehler sind möglich, zuerst beheben.

```
project.godot            Godot >= 4.3, Hauptszene main.tscn
main.tscn / main.gd      Node2D. Demo-Knopf "Weiter" spielt 4 Schritte, HUD per Signal
core/duel.gd             Regelkern ohne Grafik: summon, attack, LP, Sieg. Erzeugt Ereignisse
core/card_db.gd          Kartendaten (PLATZHALTER-Werte)
presentation/director.gd Spielt Ereignisse ab: Kamera-Zoom, Hit-Stop, Trauma-Shake, Blitz
tests/test_duel.gd       Headless-Tests für den Regelkern (Exit-Code 0 = grün)
```

## Architektur-Entscheidungen (beibehalten)
1. Regelkern und Darstellung strikt getrennt. `duel.gd` kennt keine Nodes und gibt nur Ereignisse aus:
   `summon`, `attack`, `destroy`, `damage`, `win`. Jede Karte hat eine eindeutige `uid`.
2. Der Director spielt die Ereignisliste nacheinander per `await` ab. Neue Ereignistypen bekommen dort einen Handler.
3. Feste Feld-Slots (5 pro Spieler, `null` = leer), kein Index-Verschieben.
4. Aktionen validieren zuerst, ändern danach den Zustand (atomar), geben `bool` zurück.
5. Feedback nach Wichtigkeit gestaffelt (Beschwörung klein, Angriff groß). Shake nur als Kamera-Offset, abschaltbar.
6. `preload` statt `class_name`, damit kein Class-Cache-Import nötig ist.

## Bekannte Lücken im Code
- Nur Angriffsposition, keine Verteidigung, kein Setzen, kein Aufdecken.
- Keine Hand, kein Deck, keine Züge oder Phasen, keine Normalbeschwörungs-Grenze, keine Tribute.
- Keine Effekte, keine Ketten, keine Fallen/Zauber, keine KI.
- Director ignoriert Fensterskalierung (feste Koordinaten für 1152x648).
- Kartenwerte in `card_db.gd` sind Platzhalter und nicht geprüft.

## Nächste Schritte (Reihenfolge)
1. Tests und Demo ausführen, Fehler beheben.
2. Deck, Hand, Ziehen, Züge und Phasen (Draw, Standby, Main 1, Battle, Main 2, End) als Zustandsautomat im Regelkern.
   Normalbeschwörung 1x pro Zug, Tribute, Setzen, Verteidigungsposition, Aufdecken. Pro Regel einen Test.
3. Karten als Daten (JSON oder Godot-Resources) laden, Effekte als Daten plus kleiner Interpreter statt Code pro Karte.
4. Effekt-Queue und Ketten (Chain Links), Fallen/Zauber.
5. Einfache KI (`gamedev:game-ai`): greife an, wenn ATK höher, sonst setze.
6. Eigene oder freie 2D-Grafik statt Rechtecken, Sound.

## Edison-Kartenpool (wichtig)
Eine Banlist begrenzt nur Kopien. Das Format braucht zusätzlich einen Kartenpool-Filter (nur Karten, die zum Edison-Zeitraum
existierten, etwa Anfang 2010). Ein späterer Pool wie der von 2011 enthält Karten, die nicht ins Format gehören.
Pool und Banlist deshalb als eigene Datei führen (Karten-IDs mit Limit 0/1/2/3) und beim Deck-Bau prüfen.
Genaue Set-Grenze und Banlist-Einträge vor dem Einbau mit einer öffentlichen Quelle gegenprüfen, nicht aus dem Gedächtnis übernehmen.

## Rechtliches (Vorgabe, nicht verhandeln)
- Keine Konami-Spieldateien, -Grafiken, -Sounds oder -Codes übernehmen. Das gilt auch für Dateien aus Spielen, die der User besitzt (z. B. Over the Nexus), und auch für Rips.
- Eigene Bilder (z. B. Kartenbilder in `godot/art/cards/`) liegen nur lokal auf dem eigenen Rechner und gehören nicht ins Repo; `.gitignore` schließt den Ordner aus.
- Kartendaten (Name, ATK, DEF, Text) aus öffentlichen Datenbanken sind möglich. Kartenbilder sind urheberrechtlich geschützt.
- Projekt bleibt privat und nicht kommerziell. Eigene oder freie Platzhalter-Grafik verwenden.

## Verwandtes Projekt: "Edison Combo tool"
- Projektdatei: `Forgs Lines - Google Sheets.pdf` (Frogs-Kombolinien auf 8k Schaden, mit Material-Anzahl, Beelze/ohne Beelze, Replay-Links).
- Der User wollte ein lokales Combo-Tool unter `localhost:8000` testen. Es war vom Browser aus nicht erreichbar (Server vermutlich nicht gestartet).
  Test steht aus: ob das Tool zu einem gegnerischen Feld die richtige Linie wählt, Materialzahlen und Schaden stimmen, die (+)-Varianten und Moray/Avarice-Bedingungen beachtet werden.

## Nützliche Skills (falls vorhanden)
`gamedev:card-game`, `gamedev:camera-systems`, `gamedev:game-feel`, `gamedev:game-ui-ux`, `gamedev:game-ai`,
`gamedev:godot-gdscript`, `gamedev:godot-ui-control`, `gamedev:godot-resources`, `gamedev:save-systems` (seeded Replays).

## Umgebungs-Hinweise
- Im Schreib-Sandkasten: kein Godot, kein Netzwerk für Installationen. Auf dem eigenen Rechner testen.
- Hooks (GateGuard) verlangten vor dem ersten Bash/Write kurze Fakten (Aufrufer, Datenformat, Zitat der Anweisung).

## Stand 2026-11-07 (v3, ungetestet geschrieben)
- Demo v2 lief beim User (F5).
- Neu im Regelkern: start(deck0, deck1, seed), seeded Mischen, Hand, Ziehen, Phasen-Automat (next_phase),
  Zugbesitz, 1 Normalbeschwörung/Zug, Tribute nach Level, Setzen, Positionswechsel/Flip, Verteidigung,
  1 Angriff/Monster/Zug, keine Battle Phase in Zug 1, Deck-out = Niederlage. place() = Testaufbau ohne Regeln.
- Offen: Handlimit 6, Hand-UI, Spezialbeschwörung/Extra Deck (Goyo ist eigentlich Synchro), Effekt-Stack + Ketten,
  danach Effekt-Interpreter (Daten + ~10 Grundbausteine + "script"-Ausweg für Sonderkarten).
