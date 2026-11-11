extends RefCounted
# Regelkern OHNE Grafik. Jede Aktion validiert zuerst, ändert dann den Zustand und
# hängt Ereignisse an `events` an (abholen mit take_events()).
# Ereignisse: draw, phase, summon, flip, position, attack, destroy, damage, win.
# Karten auf dem Feld haben eine eindeutige uid und die Felder pos ("atk"/"def"), up (offen),
# attacked, moved (Position gewechselt oder in diesem Zug beschworen).
const CardDB = preload("res://core/card_db.gd")
const SLOTS := 5
const PHASES := ["draw", "standby", "main1", "battle", "main2", "end"]

var lp := [8000, 8000]
var field := [[], []]   # je Spieler SLOTS Plätze, null = leer (feste Slots, kein Verschieben)
var hand := [[], []]    # Karten-IDs
var deck := [[], []]    # Karten-IDs, gezogen wird von hinten
var turn := 0           # wer am Zug ist
var turn_no := 0
var phase := ""
var normal_summoned := false
var winner := -1
var events: Array = []
var rng := RandomNumberGenerator.new()
var _uid := 0


func _init() -> void:
	for p in 2:
		field[p].resize(SLOTS)


# Mischt mit festem Seed (Tests/Replays deterministisch), zieht 5 Karten, beginnt Zug 1.
func start(d0: Array, d1: Array, rng_seed: int = 1, first: int = 0) -> void:
	rng.seed = rng_seed
	deck = [d0.duplicate(), d1.duplicate()]
	for p in 2:
		_shuffle(deck[p])
		for _i in 5:
			_draw(p)
	turn = first
	_begin_turn()


# Gibt die angefallenen Ereignisse zurück und leert die Liste (ein Aufruf = ein Abspielblock).
func take_events() -> Array:
	var e := events
	events = []
	return e


# Nächste Phase. Nach End beginnt der Zug des Gegners.
# ponytail: Draw/Standby laufen automatisch, bis Effekte dort ein Fenster brauchen.
# ponytail: Handlimit 6 im End Phase fehlt noch.
func next_phase() -> bool:
	if winner != -1 or phase == "":
		return false
	var i := PHASES.find(phase) + 1
	if phase == "main1" and turn_no == 1:
		i += 1   # erster Zug des Duells: keine Battle Phase
	if i >= PHASES.size():
		turn = 1 - turn
		_begin_turn()
	else:
		_enter(PHASES[i])
	return true


func summon(p: int, hi: int, tributes: Array = []) -> bool:
	return _normal(p, hi, tributes, true)


func set_monster(p: int, hi: int, tributes: Array = []) -> bool:
	return _normal(p, hi, tributes, false)


# Positionswechsel bzw. Flip-Beschwörung (verdeckt -> offen in ATK). 1x pro Zug und Monster.
func change_position(p: int, slot: int) -> bool:
	if not _can_act(p) or not _main() or slot < 0 or slot >= SLOTS or field[p][slot] == null:
		return false
	var c: Dictionary = field[p][slot]
	if c.moved or c.attacked:
		return false
	c.moved = true
	if not c.up:
		c.up = true
		c.pos = "atk"
		events.append({"t": "flip", "uid": c.uid, "name": c.name, "atk": c.atk})
	else:
		c.pos = "def" if c.pos == "atk" else "atk"
	events.append({"t": "position", "uid": c.uid, "pos": c.pos})
	return true


# tslot = -1: Direktangriff (nur wenn das gegnerische Feld leer ist).
func attack(p: int, slot: int, tslot: int) -> bool:
	if not _can_act(p) or phase != "battle" or slot < 0 or slot >= SLOTS or field[p][slot] == null:
		return false
	var a: Dictionary = field[p][slot]
	if a.pos != "atk" or a.attacked:
		return false
	var o := 1 - p
	var ev := {"t": "attack", "uid": a.uid, "p": p, "slot": slot, "tp": o, "tslot": tslot, "tuid": -1}
	if tslot == -1:
		if field[o].count(null) != SLOTS:
			return false
		a.attacked = true
		events.append(ev)
		_damage(o, a.atk)
		return true
	if tslot < 0 or tslot >= SLOTS or field[o][tslot] == null:
		return false
	var d: Dictionary = field[o][tslot]
	a.attacked = true
	ev.tuid = d.uid
	events.append(ev)
	if not d.up:
		d.up = true
		events.append({"t": "flip", "uid": d.uid, "name": d.name, "atk": d.atk})
	var diff: int = a.atk - (d.atk if d.pos == "atk" else d.def)
	if d.pos == "atk":
		if diff >= 0:
			_destroy(o, tslot)
		if diff <= 0:
			_destroy(p, slot)
		if diff > 0:
			_damage(o, diff)
		elif diff < 0:
			_damage(p, -diff)
	else:   # Verteidigung: kein Schaden an den LP des Verteidigers
		if diff > 0:
			_destroy(o, tslot)
		elif diff < 0:
			_damage(p, -diff)
	return true


# Testaufbau: legt eine Karte ohne Regelprüfung aufs Feld, sofort einsatzbereit.
func place(p: int, id: String, slot: int, up := true, pos := "atk") -> bool:
	if not CardDB.CARDS.has(id) or slot < 0 or slot >= SLOTS or field[p][slot] != null:
		return false
	_place(p, id, up, pos, slot)
	field[p][slot].moved = false
	return true


func _normal(p: int, hi: int, tributes: Array, up: bool) -> bool:
	if not _can_act(p) or not _main() or normal_summoned:
		return false
	if hi < 0 or hi >= hand[p].size():
		return false
	var id: String = hand[p][hi]
	var lv: int = CardDB.CARDS[id].lv
	var need := 0 if lv <= 4 else (1 if lv <= 6 else 2)
	if tributes.size() != need:
		return false
	for i in tributes.size():
		var s = tributes[i]
		if typeof(s) != TYPE_INT or s < 0 or s >= SLOTS or field[p][s] == null or tributes.find(s) != i:
			return false
	if field[p].count(null) + need == 0:
		return false
	for s in tributes:
		_destroy(p, s)
	hand[p].remove_at(hi)
	normal_summoned = true
	_place(p, id, up, "atk" if up else "def")
	return true


func _place(p: int, id: String, up: bool, pos: String, slot := -1) -> int:
	if slot == -1:
		slot = field[p].find(null)
	_uid += 1
	var c: Dictionary = CardDB.CARDS[id].duplicate()
	c.uid = _uid
	c.pos = pos
	c.up = up
	c.attacked = false
	c.moved = true   # im Beschwörungszug kein Positionswechsel
	field[p][slot] = c
	events.append({"t": "summon", "uid": _uid, "p": p, "slot": slot, "name": c.name, "atk": c.atk, "up": up, "pos": pos})
	return slot


func _begin_turn() -> void:
	turn_no += 1
	normal_summoned = false
	for c in field[turn]:
		if c != null:
			c.attacked = false
			c.moved = false
	_enter("draw")
	if turn_no > 1:   # der Startspieler zieht im ersten Zug nicht
		_draw(turn)
	_enter("standby")
	_enter("main1")


func _enter(ph: String) -> void:
	phase = ph
	events.append({"t": "phase", "p": turn, "phase": ph, "turn": turn_no})


func _draw(p: int) -> void:
	if deck[p].is_empty():
		_win(1 - p)
		return
	var id: String = deck[p].pop_back()
	hand[p].append(id)
	events.append({"t": "draw", "p": p, "id": id})


func _shuffle(a: Array) -> void:
	for i in range(a.size() - 1, 0, -1):
		var j := rng.randi_range(0, i)
		var t = a[i]
		a[i] = a[j]
		a[j] = t


func _destroy(p: int, slot: int) -> void:
	var c: Dictionary = field[p][slot]
	field[p][slot] = null
	events.append({"t": "destroy", "uid": c.uid})


func _damage(p: int, n: int) -> void:
	lp[p] = maxi(lp[p] - n, 0)
	events.append({"t": "damage", "p": p, "amount": n, "lp": lp[p]})
	if lp[p] == 0:
		_win(1 - p)


func _win(w: int) -> void:
	if winner == -1:
		winner = w
		events.append({"t": "win", "winner": w})


func _can_act(p: int) -> bool:
	return winner == -1 and p == turn


func _main() -> bool:
	return phase == "main1" or phase == "main2"
