# Godot-Duell: was für den Anime-Look noch fehlt

Stand: jede Kartenbewegung fliegt (Hand, Deck, Friedhof, Verbannt, Extra), Gewonnen/Verloren mit „Neues Duell“,
beschworene Karte oben rechts, Tempo-Taste T. Feld, Hand, LP-Ringe, Schadenszahlen, Einblendung für Zauber und Fallen, Kartenbilder, Friedhof-Ansicht,
Karten-Detail und Zieh-Animation sind gebaut. Vorbild sind die Szenen aus Yu-Gi-Oh! 5D's (Monster schwebt groß
über dem Feld, runde ATK/DEF-Plakette, Sternenhimmel bei der Beschwörung, Duellant mit Duel Disk).

Reihenfolge nach Wirkung. Jeder Punkt ist einzeln baubar.

1. **(gebaut, in Godot noch zu prüfen) Werte-Plakette wie im Anime.** Runde Scheibe mit Ring, „ATK 2500“ groß, Stufe mit Stern darunter; bei
   Verteidigung „DEF“. Ersetzt den gelben Text neben der Figur. Gezeichnet mit `_draw`, keine Bilddatei.
2. **(gebaut, in Godot noch zu prüfen) Beschwörungs-Einblendung** (`duel3d/summon_show.gd`). Bei jeder Beschwörung kurz: Hintergrund wird zum Sternenhimmel, das Monster steht
   groß in der Mitte, Plakette fährt ein. Synchro: Stufen-Sterne und Ringe davor. Dauer unter 1,5 Sekunden, abschaltbar.
3. **Monster als Hologramm über der Karte.** Solange es keine 3D-Modelle gibt: das Kartenbild als stehende,
   leicht leuchtende Fläche über der Karte statt der Kapsel-Figur. Eigene Modelle ersetzen es (`art/models`).
4. **Karte aktivieren wie im Anime.** Die Karte richtet sich auf, wird groß und leuchtet, bevor der Effekt kommt
   (statt der flachen Einblendung in der Bildmitte).
5. **Duellant mit Duel Disk.** CC0-Figur statt Kapsel, Arm-Bewegung beim Ziehen und Ausspielen.
6. **Umgebung.** CC0-Stadt oder Stadion statt grauer Quader, Nachthimmel mit Sternen, Bodenspiegelung der Zonen.
7. **Angriff.** Spur hinter dem Angreifer, Treffer-Blitz am Ziel, zerstörtes Monster zerspringt in Splitter.
8. **Kamera.** Schwenk zum Gegner in seinem Zug, Nahaufnahme bei direktem Angriff, ruhige Übersicht sonst.
9. **Ton.** Ziehen, Setzen, Beschwören, Treffer, LP-Zählen. Nur eigene oder CC0-Klänge.
10. **Bedienung.** Phasen-Leiste (Draw, Standby, Main 1, Battle, Main 2, End) statt Text, Kettenanzeige mit
    Nummern, Lehrer-Hinweise als eigenes Feld, Deckwahl und Starthand vor dem Duell, Rückgängig-Knopf.

## Rechtliches

Die Kartenbilder kommen zur Laufzeit von der Brücke (`GET /image`, dieselben Dateien wie auf der Webseite) und
liegen nicht im Godot-Projekt. Sie sind geschützt: für den eigenen Gebrauch geladen, nicht zum Weitergeben.
Eigene Bilder in `art/cards` haben Vorrang. Keine Spieldateien, Grafiken, Sounds oder Rips von Konami oder aus
Fan-Spielen übernehmen (siehe `HANDOFF.md`).
