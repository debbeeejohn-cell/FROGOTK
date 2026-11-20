# Ereignis-Schnittstelle: Spiellogik → Darstellung

Die Logik gibt pro Aktion eine Liste von Ereignissen aus. Die Darstellung arbeitet sie strikt
nacheinander ab (`await` pro Ereignis) und meldet am Ende „fertig“, damit die nächste Eingabe
angenommen wird. Alle Karten tragen eine eindeutige `uid`.

`p` = Spieler (0 = blau, unten; 1 = rot, oben). `zone` = Spalte 0–4. `card` = Kartendaten:

```json
{ "uid": 7, "name": "Blackwing – Blizzard", "short": "BW Blizzard",
  "atk": 1300, "def": 0, "lvl": 2, "tuner": true, "type": "monster", "wing": true }
```

| Ereignis | Felder | Darstellung (Referenz-Funktion) |
|---|---|---|
| `turn` | `n, p` | Zug-Banner, Phasenleiste zurücksetzen (`startTurn`) |
| `phase` | `k` (DP/SP/M1/BP/M2/EP), `p` | Chip aktiv; großes Banner nur bei M1 und BP (`phase`) |
| `draw` | `p, card` oder `card: null` (verdeckt) | Karte fliegt vom Deck, Deckzahl −1, Hand +1 (`drawCard`) |
| `say` | `p, text` | Kamera auf Duellant, Geste, Hologramm, Sprechblase. `[Name]` = Kartenname (`say`) |
| `summon` | `p, zone, card, pos` (atk/def), `from` (hand/grave/extra) | Landung, Lichtsäule, Figur steigt auf (`summon`) |
| `target` | `src uid`, `dst` (uid oder Stapel wie `grave:0`) | Ziellinie + Fadenkreuz (`aim`) |
| `synchro` | `p, zone, card, tuner uid, materials [uid]` | Weiß werden, Ringe + Sterne, Säule, Erscheinen (`summon` mit `synchro`) |
| `set` | `p, zone, card` | Karte fällt verdeckt in die Zauber/Fallen-Reihe (`setTrap`) |
| `attack` | `attacker uid, target uid` oder `target: null` (direkt) | Cut-in, Zoom, Sprint (`dash`) |
| `activate` | `uid` | Falle klappt auf + Banner (`flipTrap`, `cutIn`) |
| `effect_hit` | `src uid, dst uid` | Blitz vom Effekt zum Ziel + Einschlag (`bolt`, `impact`) |
| `destroy` | `uid` | Figur zerspringt, Karte → Friedhof (`shatter`) |
| `damage` | `p, amount, lp` | Zoom auf Duellant, Rückstoß, Schadenszahl, LP-Ring zählt (siehe UI-SPEC, Abschnitt 6) |
| `to_grave` | `p, card` | Friedhof +1, oberste Karte offen (`toGrave`) |
| `win` | `p` | Banner „Spieler X gewinnt“ |

Beispiel, Zug 1 der Referenz:

```json
[
  {"t":"turn","n":1,"p":0}, {"t":"phase","k":"M1","p":0},
  {"t":"say","p":0,"text":"Ich rufe [Blackwing – Blizzard] im Angriffsmodus!"},
  {"t":"summon","p":0,"zone":0,"card":{"uid":1,"name":"Blackwing – Blizzard","lvl":2,"tuner":true,"atk":1300,"def":0},"pos":"atk","from":"hand"},
  {"t":"target","src":1,"dst":"grave:0"},
  {"t":"summon","p":0,"zone":1,"card":{"uid":2,"name":"Blackwing – Bora","lvl":4,"atk":1700,"def":800},"pos":"def","from":"grave"},
  {"t":"synchro","p":0,"zone":0,"card":{"uid":3,"name":"Goyo Guardian","lvl":6,"atk":2800,"def":2000},"tuner":1,"materials":[2]}
]
```

`say`-Ereignisse kommen aus der Logik (wer handelt, was angesagt wird), damit Ansage und
tatsächliche Aktion nie auseinanderlaufen.

Hinweis: In der Referenz ist der Schadens-Ablauf (`damage`) im aktuellen Szenario nicht verbaut,
weil Spiegelkraft keinen Schaden macht. Die Choreografie steht in `UI-SPEC.md` Abschnitt 6.
