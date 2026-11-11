extends RefCounted
# Kartenwerte sind PLATZHALTER. Durch eigene Daten ersetzen (z. B. aus dem Edison-Sheet).
# lv bestimmt die Tribute: 1-4 keine, 5-6 eins, 7+ zwei. Goyo/Brionac laufen hier als normale Monster.
const CARDS := {
	"goyo": {"name": "Goyo Guardian", "atk": 2800, "def": 2000, "lv": 6},
	"brio": {"name": "Brionac", "atk": 2300, "def": 1400, "lv": 6},
	"des": {"name": "Des Frog", "atk": 1900, "def": 0, "lv": 4},
}
