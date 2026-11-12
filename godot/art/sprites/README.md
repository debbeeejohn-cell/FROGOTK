# Eigene Monster-Designs (lokal)

Hier liegen deine eigenen Designs. Dieser Ordner wird nicht committed (siehe `.gitignore`). Nur diese README ist im Repo.
Es gehören nur eigene oder frei lizenzierte Bilder hierher, keine Kartenbilder und nichts aus Spielen.

## Vorgaben

- **PNG mit transparentem Hintergrund**, eine Datei pro Monster.
- **Seitenverhältnis frei**, gern 2:3 (zum Beispiel 512 × 768). Figur mittig, **Füße am unteren Rand**, Blick nach vorn.
- **Kein Kartenrahmen, kein Text** im Bild.
- **Dateiname:** Kartenname in Kleinbuchstaben, alles außer Buchstaben und Ziffern wird `_`.
  `Des Frog` → `des_frog.png`, `Blackwing - Gale the Whirlwind` → `blackwing_gale_the_whirlwind.png`.
- Die **Größe auf dem Feld** bestimmt der Code nach der Stufe der Karte, nicht die Bildgröße.

## Namen

Alle Monster der sieben Decks mit ihrem Dateinamen: `node scripts/list-monsters.mjs` im Projektordner.
Schickst du mir Dateien mit dem englischen Kartennamen, benenne ich sie für dich um.

## Was ohne Design passiert

Ein Monster ohne Datei zeigt ein gezeichnetes Wappen in der Farbe seines Attributs mit seiner Stufe.
Legst du eine Datei hier ab und startest Godot neu, steht sie beim nächsten Beschwören aufrecht über der Karte.
