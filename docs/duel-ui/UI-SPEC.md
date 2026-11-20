# UI-Spezifikation: Duell im 5D's-Stil

Alle Zahlen stammen aus `reference/duel-preview.html`. Bei Zweifeln gilt die Datei.

## 1. Bühne und Ebenen

Feste Bühne **1152 × 648 px**, auf Containerbreite skaliert (16:9). Ebenen von hinten nach vorn:

1. **Stadion** (`#arena`): Himmel, Ränge, Glasbarriere, Flutlichter. Parallaxe: bewegt sich mit 12 % der Kamera.
2. **Kamera** (`#shake` > `#cam` > `#field`): Wackeln liegt außen, Kamera-Transform innen.
3. **Feld**: Ebene 940 × 660 px, `left 106, top 34`, `rotateX(55deg)`. Perspektive 1000 px, Ursprung 50 % / 30 %.
4. **HUD** (flach, nicht von der Kamera bewegt): Speedlines/Partikel, Ziellinien, Phasenleiste, LP-Ringe, Hände, Banner, Projektion, Sprechblase, Cut-in, Blitz-Overlay.

## 2. Feld-Geometrie (Pixel in der Feld-Ebene)

- Karten/Zonen **84 × 118**. Spalte `x(i) = 428 + (i − 2) · 104`, Hauptzonen i = 0–4.
- Reihen: Blau Monster `y 352`, Zauber/Falle `y 488`. Rot Monster `y 190`, Zauber/Falle `y 54`. Mittellinie `y 330`.
- Seitenzonen (Rot gespiegelt):

| | Blau | Rot |
|---|---|---|
| Feldzone | Spalte −1, Monsterreihe | Spalte 5, Monsterreihe |
| Extra Deck | −1, Zauber/Falle | 5, Zauber/Falle |
| Friedhof | 5, Monsterreihe | −1, Monsterreihe |
| Deck | 5, Zauber/Falle | −1, Zauber/Falle |
| Verbannt | 6, Monsterreihe | −2, Monsterreihe |

- Stapel: bis zu 4 Lagen mit je 2 px Abstand in Z, Anzahl-Badge unten rechts. Friedhof zeigt die oberste Karte offen.
- Feld-Emblem: Kreis 300 px in der Feldmitte, innerer Strichelring dreht sich in 60 s.
- **Figuren sind aufrechte 2D-Billboards**: `rotateX(-55deg)`, Drehpunkt unten Mitte, Fußpunkt 12 px unterhalb der Kartenoberkante (in der Feld-Ebene), mittig.
  Monster 120 × 165, Duellanten 180 × 240 bei Skalierung 0,74. Duellant Blau bei (886, 615), gespiegelt, Rot bei (40, −20).
- Verteidigung: Karte um 90° gedreht, Figur `scaleY(.85)` und entsättigt, Etikett „DEF x“ statt „ATK x“.

## 3. Design-Tokens

| Token | Wert |
|---|---|
| Blau / Rot | `#3f8cff` / `#ff5a4d` |
| Falle | `#b46cff` (Kartenrahmen `#8d4fc4`) |
| Gold (Akzent) / Monsterkarte | `#d9b45a` / `#c9a24c` |
| Synchro-Grün | Ring `#8dffbe`, Glühen `#3dff8a` |
| Hintergrund / Panel | `#0a0d16` / `#131828` |
| Display-Schrift | Anton (Fallback Impact) |
| Text-Schrift | Barlow 400/600/700 |
| Easing raus / rein / Überschwung | `cubic-bezier(.2,.8,.2,1)` / `(.7,0,.84,0)` / `(.34,1.56,.64,1)` |

## 4. Kamera

Kamera = `translate + scale` auf dem Kamera-Container. `focus(punkt, zoom, dauer)` bringt einen
Bildschirmpunkt in die Mitte und **misst bis zu 6-mal nach**, weil die Perspektive nahe Objekte stärker verschiebt.

| Moment | Zoom | Dauer |
|---|---|---|
| Ruhe | 1,0 | 420 ms |
| Beschwörung | 1,35 | 280 ms |
| Synchro (beide Materialien im Bild) | 1,1 | 300 ms |
| Falle setzen | 1,3 | 260 ms |
| Ansage (Duellant) | 1,5 | 300 ms |
| Angriff (Mitte Angreifer/Ziel) | 1,25–1,3 | 260 ms |
| Falle klappt auf | 1,5 | 260 ms |
| Schaden (Kopf des Duellanten) | 1,9 | 320 ms |

## 5. Feedback-Stufen

| Ereignis | Wackeln (Trauma) | Publikum | Sonst |
|---|---|---|---|
| Falle setzen | 0,2 | – | – |
| Beschwörung | 0,25 | 0,3 | Lichtsäule |
| Ansage | 0,12 | – | – |
| Zerstörung | 0,35 | – | 12 Splitter |
| Synchro | 0,35 | 1,0 | Blitz 0,5, Säule |
| Einschlag | 0,7 | 1,0 | Hit-Stop 110 ms auf 5 % Tempo, Blitz 0,85, Stern-Explosion |

- Wackeln: `trauma` addiert sich, fällt um 1,5/s, Versatz = `trauma² · 22 px · sin(t·51 | t·69)`. Nur Kamera, nie Logik.
- Hit-Stop: alle laufenden Animationen auf 5 % Tempo, nach **110 ms Echtzeit** zurück; nur der neueste Hit-Stop setzt zurück.
- Publikum: pro Frame `2 + 45 · hype` Blitzlichter in den Rängen, `hype` fällt um 0,9/s.

## 6. Abläufe (Choreografien)

**Ansage (`say`)**: Projektion an (gegenüber der Blase), Kamera auf Duellant, Arm auf −62° hoch und 3° vorlehnen,
Blase springt auf (220 ms, Überschwung), Text tippt mit 24 ms/Zeichen, `[Name]` fett `#8a5a00` in „…“, 850 ms halten, Blase aus, Arm runter.

**Beschwörung**: Kamera → Handkarte hebt ab und verblasst (260 ms) → Karte landet aus 90 px Höhe (320 ms, Überschwung) + Lichtsäule (760 ms)
→ Figur wächst aus `scaleY(0)` (380 ms, Überschwung) → schwebt (1,6 s, ±10 px) → ATK-Etikett.
Aus dem Friedhof: Friedhof −1, Karte fliegt vom Friedhof auf die Zone (600 ms).

**Synchrobeschwörung** (Herzstück, genau so umsetzen):
1. Extra Deck −1, Kamera auf beide Materialien.
2. Beide Figuren werden weiß: Filter zu `saturate(0) brightness(3)` mit weißem Glühen, Karten blenden aus (800 ms, linear).
3. Empfänger schrumpft und verschwindet, **Stufe-viele grüne Ringe** (150 × 42, 5 px Rand) fliegen von ihm in eine senkrechte Säule über der Zielzone.
   Nicht-Empfänger blähen sich auf und verschwinden, **Stufe-viele Sterne** fliegen in dieselbe Säule, gleichmäßig **zwischen** dem untersten und obersten Ring (Säulenhöhe 230 px). Dauer 760–1100 ms, gestaffelt.
4. Materialien → Friedhof (erst Nicht-Empfänger, dann Empfänger).
5. Ringe pulsieren einmal (460 ms) → Blitz, Lichtsäule 110 px breit (760 ms), Ringe weiten sich auf 2,3× und vergehen.
6. Synchro-Monster erscheint wie eine Beschwörung, danach Cut-in „Name · Stufe X · ATK Y“.

**Falle setzen**: Handkarte weg, Karte fällt verdeckt aus 140 px Höhe (300 ms).

**Falle aktivieren**: Die Karte liegt verdeckt als `rotateX(180deg)`. Aufklappen = Drehung um die **hintere Kante**:
`translateY(-59px) rotateX(0→125deg) translateY(59px) rotateX(180deg)`, 620 ms, Überschwung. Danach pulsierendes Lila-Glühen,
Cut-in „Falle aktiviert: Name“ in Lila.

**Angriff**: Speedlines an → Cut-in „Name greift an!“ (190 / 560 / 190 ms) → Zoom auf Angreifer und Ziel → Sprint (200–220 ms, Ease-in)
→ Einschlag oder Unterbrechung (z. B. Falle bei 40 % des Weges) → zurück (320 ms).

**Zerstörung**: 12 Rauten-Splitter fliegen 720 ms, Karte blitzt auf und verblasst, dann → Friedhof.

**Schaden**: Zoom 1,9 auf den Kopf des Duellanten, Rückstoß mit Rotglühen (520 ms), Schadenszahl 88 px Rot (Pop 260 ms, 550 ms halten),
LP-Ring pulsiert und zählt in 800 ms linear runter.

**Zug/Phase**: Zug-Banner „Zug n“ mit „Spieler x“ darüber (260 rein / 560 halten / 220 raus, schräg −12°).
Phasen-Chips DP SP M1 BP M2 EP, kleine Phasen 300 ms, großes Banner nur für Main Phase 1 und Battle Phase.

**Ziehen**: Karte hebt vom Deck ab und fliegt Richtung Hand (520 ms), dann erscheint sie in der Hand (300 ms, Überschwung).

## 7. HUD

- Phasenleiste oben Mitte: Zeile „ZUG n · SPIELER x“, darunter Chips; aktiver Chip in Spielerfarbe mit Glühen.
- LP-Ringe 108 px: Rot oben rechts, Blau unten links. Kreis r = 42, Strich 9, Zahl Anton 27 px.
- Hände offen: Blau unten Mitte (56 × 78), Rot oben rechts neben dem LP-Ring (48 × 67).
- Cut-in-Band: 110 px hoch, Bildmitte, Streifen in Spielerfarbe oben und unten, Text Anton 52 px, schräg.
- Sprechblase: weiß, 3 px schwarzer Rand, Radius 18, harter Schatten 5 px, 22 px fett, max. 430 px breit, Spitze zum Kopf.
- Hologramm-Projektion: Duellant-Silhouette 400 × 560 mit 4-px-Scanlines, Deckkraft 0,42, Bildschirm-Mischmodus, flackert beim Einblenden.

## 8. Stadion (5D's-Ambiente)

Himmel mit Verlauf `#0a0f2e → #151b48 → #05070d`, drei Nebel (Violett, Blau, Pink), ca. 240 Sterne.
Ränge als Bogen über dem Feld mit ca. 1100 farbigen Publikumspunkten, davor eine blaue Glasbarriere mit Rautengitter
und Lichterkante. Zwei Flutlichter schwenken in 9 s um ±20°. 46 Lichtpartikel steigen langsam auf.

## 9. Barrierefreiheit

Schalter „Blitze“ und „Wackeln“; bei `prefers-reduced-motion` beide aus und Dauer-Animationen (Schweben,
Flutlicht, Emblem, Fallen-Glühen) gestoppt.

## 10. Umsetzung je Engine

- **Web**: Referenz direkt übernehmen (CSS 3D + Web Animations API). Eine Ereignis-Queue nach `EVENTS.md`
  ersetzt das feste `steps`-Array.
- **Godot 4**: 3D-Szene. Feld als `MeshInstance3D`-Ebene mit Kamera im 55°-Winkel, Figuren als
  `Sprite3D` mit `billboard = BILLBOARD_FIXED_Y`, Karten als flache `MeshInstance3D`. Kamera-Fahrten mit `Tween`,
  Wackeln über `Camera3D.h_offset/v_offset`, Hit-Stop über `Engine.time_scale` + Timer mit `ignore_time_scale`.
  HUD, Banner, Blase, Ringe und Sterne auf einer `CanvasLayer` (Ringe/Sterne per `unproject_position` positionieren).
- **Unity**: analog mit `SpriteRenderer`-Billboards, Cinemachine für Kamera und Impulse, UI Toolkit/uGUI für das HUD.
