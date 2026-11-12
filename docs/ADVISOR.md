# Bewertungssystem (Advisor): Kartenvorteil und situative Aktionsbewertung

Eigene Bot-Variante in `js/advisor/`, getrennt vom bisherigen Bot (`js/decide.js`). Sie ist standardmäßig aus.
Der bisherige Bot ist die Vergleichsbasis (Git-Tag `bot-baseline` = `c937ecd`, Zahlen in `data/bot-baseline.json`).

## Prinzip

Der Bot rechnet Plus und Minus, ohne Kartenregeln zu kennen. Die **Engine führt jede legale Aktion in Probewelten aus**,
und der Zustand davor und danach wird verglichen. Kosten, Mengen, Obergrenzen, Kettenreaktionen und „der Tribut stirbt
ohnehin“ stecken damit schon im Messwert. Es gibt keine Regel für Heavy Storm, Stratos oder Icarus Attack.

Probewelten entstehen aus dem öffentlichen Stand. Verdeckte Gegnerkarten werden aus dem Restpool seiner Decklist gezogen
(`js/guess.js`), vorher entfernt `sanitize()` alles Verdeckte aus der Ansicht. Test: andere verdeckte Karten ergeben
dieselbe Messung.

## Dimensionen (je Aktion A gegen Nichtstun P)

| Dimension | Was sie misst | Wo |
|---|---|---|
| Raw Card Advantage | Δ Pool eigen − Δ Pool Gegner. Pool = Hand + Feld, Tokens zählen nicht. Hand → Feld und Zonenwechsel ändern nichts, Deck → Hand ist +1. | `resources.js` |
| Card Quality | nur der Überschuss über 1 je bewegter Karte (Extra Deck, ATK, Effekt), aus Kartendaten | `dimensions.js` |
| Tempo | Brettpräsenz (ATK offener Angriffsmonster) | `dimensions.js` |
| Graveyard Value | nutzbarer Friedhofseffekt neu im Friedhof (aus dem Skript gelesen: `SetRange(LOCATION_GRAVE`), zählt nicht als Karte | `dimensions.js` |
| Opportunity Cost | jede Dimension als Differenz Aktion − Nichtstun, gemessen | `probe.js`, `chain.js` |
| Timing | Anteil des Potenzials, den die Aktion jetzt erreicht (Anzeige) | `dimensions.js` |
| Future | Verschwendung: Potenzial minus Ertrag jetzt, als Strafe | `dimensions.js`, `potential.js` |

Raw und Strategie sind strikt getrennt: Der Rohwert steht immer einzeln im Log, die Gewichte für den Rest in
`data/advisor-weights.json`. Das Potenzial einer Karte misst die Engine einmal in einer reichen Teststellung (`potential.js`).

## Wo das System entscheidet

1. **Erste Hauptphasen-Aktion jedes Bot-Zuges** (`probe.js`). Wert ≥ 0, sonst entscheidet der bisherige Bot.
2. **Antwort in einem Kettenfenster** (`chain.js`), wenn der Auslöser nachspielbar ist: Der Gegner aktiviert eine bekannte
   Zauber-/Fallenkarte (Kettenlänge 1), oder der Bot greift an und der Gegner antwortet mit einer bekannten Falle.
   Eine Antwort braucht Wert > 0 gegenüber „nicht antworten“, sonst passt der Bot.

Alles andere entscheidet der bisherige Bot, im Log als „nicht messbar“ vermerkt.

## Log

`g.advisorLog`, in der Brücke `state.advisor`. Je Entscheidung: Zug, Art (`main`/`chain`), Auslöser, Wissensklassen der
Gegnerkarten (bekannt, vermutet, unbekannt), jede legale Aktion mit allen Dimensionen, Streuung und Einzelwerten je Probewelt,
Potenzial, Timing, Verschwendung, Teilwerte, Gesamtwert, gewählte Aktion oder Rückfall.

## Benutzen

```
POST /new { ..., advisor: true }       # Hauptphase und Ketten
POST /new { ..., advisor: "main" }     # nur Hauptphase
node --no-warnings scripts/bot-eval.mjs 100 advisor        # Siege und Züge gegen Zufallsspieler
node --no-warnings scripts/advisor-eval.mjs 100            # alt gegen neu: Siege, Kartenvorteil, Entscheidungen, Zeit
```

Tests: `node js/advisor/resources.test.mjs`, `dimensions.test.mjs`, und mit der Engine
`node --no-warnings js/advisor/probe.test.mjs`, `chain.test.mjs`, `potential.test.mjs`, `index.test.mjs`.

## Grenzen (bekannt)

- **Nur die erste Aktion einer Hauptphase.** Die Probewelt beginnt am Zuganfang und kennt „Normalbeschwörung schon genutzt“ und
  „einmal pro Zug“ nicht. Spätere Aktionen entscheidet der bisherige Bot.
- **Ketten:** nur Länge 1, nur Zauber/Fallen als Auslöser, Auslöser Aktivierung oder Angriff. Monstereffekte und längere Ketten sind
  nicht messbar. Ziele des Gegners wählt die Probewelt nach den Faustregeln des Bots, nicht wie der echte Gegner.
- **Zielwahl und Mengen** (z. B. „bis zu 2 zerstören“) übernimmt die Faustregel des bisherigen Bots. Sie wählt oft die kleinste
  Zahl. Das wirkt auf Messwerte und auf das Potenzial (Icarus Attack zeigt −1).
- **Karten ohne Skript** im Pool (Stratos, Card Trooper) lassen sich nicht messen. Der Mechanismus deckt sie ab, sobald ihr Skript
  geladen ist (`scripts/fetch-core.mjs`); getestet ist er an Machina Gearframe (sucht beim Beschwören, bleibt auf dem Feld: +1).
- **Rohwert nach Kartenzahl:** Der Mirror-Force-Fall mit ohnehin verlorenem Tribut ist gegenüber Nichtstun 0, nicht +1. Das
  stimmt mit der Rechnung „2:2, Nullspiel“ überein. Der strategische Vorteil gegenüber einem blinden Icarus zeigt sich im Tempo
  (kein Monster geht umsonst verloren), nicht in der Kartenzahl.
- **Gewichte** sind Startwerte, keine Regeln.
