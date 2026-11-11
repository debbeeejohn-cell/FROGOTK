extends RefCounted
# Aufruf: tests/test_duel.gd (Terminal) oder Szene tests/test_scene.tscn (Godot-Editor, F6)
const Duel = preload("res://core/duel.gd")
var fails := 0


func ok(cond: bool, msg: String) -> void:
	if not cond:
		fails += 1
		push_error("FAIL: " + msg)


# Frisches Duell: 12x Des Frog je Deck, Spieler 1 beginnt, Hand = 5x Des Frog.
func fresh() -> RefCounted:
	var d := Duel.new()
	var deck := []
	for _i in 12:
		deck.append("des")
	d.start(deck, deck, 1)
	return d


# Drei Phasenwechsel: Main 1 -> Main 2 -> End -> Zug 2 (Spieler 2, Main 1).
func to_turn2(d) -> void:
	for _i in 3:
		d.next_phase()


func run() -> int:
	# --- Start, Phasen, Zugwechsel ---
	var d := fresh()
	ok(d.hand[0].size() == 5 and d.hand[1].size() == 5, "Starthand 5, Startspieler zieht nicht")
	ok(d.turn == 0 and d.turn_no == 1 and d.phase == "main1", "Start in Main 1")
	ok(not d.summon(1, 0), "nur der Zugspieler beschwört")
	ok(d.summon(0, 0) and d.hand[0].size() == 4 and d.field[0][0].name == "Des Frog", "Normalbeschwörung")
	ok(not d.summon(0, 0), "nur 1 Normalbeschwörung pro Zug")
	ok(not d.change_position(0, 0), "kein Positionswechsel im Beschwörungszug")
	d.next_phase()
	ok(d.phase == "main2", "erster Zug überspringt die Battle Phase")
	d.next_phase()
	d.next_phase()
	ok(d.turn == 1 and d.turn_no == 2 and d.phase == "main1" and d.hand[1].size() == 6, "Zugwechsel, Gegner zieht")

	# --- Tribute ---
	var t := fresh()
	t.hand[0].append("brio")
	var bi: int = t.hand[0].find("brio")
	ok(not t.summon(0, bi), "Level 6 ohne Tribut nicht")
	t.place(0, "des", 0)
	ok(not t.summon(0, bi, [3]), "Tribut muss ein Monster sein")
	ok(t.summon(0, bi, [0]) and t.field[0][0].name == "Brionac", "Level 6 mit 1 Tribut")

	# --- Setzen, Positionswechsel, Aufdecken ---
	var s := fresh()
	ok(s.set_monster(0, 0) and not s.field[0][0].up and s.field[0][0].pos == "def", "Setzen: verdeckt in DEF")
	var m := fresh()
	m.place(0, "des", 0)
	ok(m.change_position(0, 0) and m.field[0][0].pos == "def", "Positionswechsel")
	ok(not m.change_position(0, 0), "nur 1 Positionswechsel pro Zug")
	var f := fresh()
	f.place(0, "des", 0, false, "def")
	ok(f.change_position(0, 0) and f.field[0][0].up and f.field[0][0].pos == "atk", "Flip-Beschwörung")

	# --- Kampf (Spieler 2 greift in Zug 2 an) ---
	var b := fresh()
	to_turn2(b)
	b.place(1, "goyo", 0)
	b.place(0, "brio", 0)
	ok(not b.attack(1, 0, 0), "Angriff nur in der Battle Phase")
	b.next_phase()
	ok(b.phase == "battle", "Main 1 -> Battle")
	ok(not b.attack(0, 0, 0), "nur der Zugspieler greift an")
	ok(not b.attack(1, 0, -1), "Direktangriff blockiert, solange Gegner Monster hat")
	ok(b.attack(1, 0, 0), "Angriff wird aufgelöst")
	ok(b.lp == [7500, 8000], "Kampfschaden 2800-2300")
	ok(b.field[0][0] == null and b.field[1][0] != null, "nur das Ziel zerstört")
	ok(not b.attack(1, 0, -1), "nur 1 Angriff pro Monster und Zug")
	for _i in 3:
		b.field[1][0].attacked = false
		b.attack(1, 0, -1)
	ok(b.lp[0] == 0 and b.winner == 1 and b.events.back().t == "win", "Sieg bei 0 LP")
	b.field[1][0].attacked = false
	ok(not b.attack(1, 0, -1), "nach Sieg keine Aktionen")

	# --- Verteidigungsposition ---
	var df := fresh()
	to_turn2(df)
	df.place(1, "des", 0)
	df.place(0, "goyo", 0, true, "def")
	df.next_phase()
	ok(df.attack(1, 0, 0) and df.lp[1] == 7900 and df.field[0][0] != null and df.field[1][0] != null, "ATK < DEF: Angreifer nimmt die Differenz, keiner stirbt")

	var fl := fresh()
	to_turn2(fl)
	fl.place(1, "des", 0)
	fl.place(0, "brio", 0, false, "def")
	fl.next_phase()
	fl.take_events()
	ok(fl.attack(1, 0, 0) and fl.field[0][0] == null and fl.lp == [8000, 8000], "ATK > DEF: Ziel zerstört, kein LP-Schaden")
	var types := fl.events.map(func(e): return e.t)
	ok(types.has("flip"), "verdecktes Ziel wird aufgedeckt")

	# --- Deck, Seed ---
	var mixed := []
	for i in 12:
		mixed.append(["des", "brio", "goyo"][i % 3])
	var a1 := Duel.new()
	a1.start(mixed, mixed, 7)
	var a2 := Duel.new()
	a2.start(mixed, mixed, 7)
	ok(a1.hand == a2.hand and a1.deck == a2.deck, "gleicher Seed = gleiche Mischung")

	var o := Duel.new()
	var short := []
	for _i in 5:
		short.append("des")
	o.start(short, short, 1)
	to_turn2(o)
	ok(o.winner == 0, "Deck leer beim Ziehen = Niederlage")
	ok(not o.take_events().is_empty() and o.events.is_empty(), "take_events leert die Liste")

	print("Tests fertig, Fehler: ", fails)
	return fails
