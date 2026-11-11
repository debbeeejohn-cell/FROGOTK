extends Node2D
# Hot-Seat-Duell mit Klicksteuerung. Die Regeln leben im Regelkern, hier ist nur Eingabe:
# 1. Karte aus der Hand wählen (bei Level 5+ danach eigene Monster als Tribut anklicken)
# 2. "Beschwören" oder "Setzen". Eigenes Monster anklicken -> "Position" oder gegnerisches Feld = Angriff.
# Ungültiges meldet der Regelkern mit false; die UI zeigt dann "Nicht erlaubt".
const Duel = preload("res://core/duel.gd")
const Director = preload("res://presentation/director3d.gd")   # 2D-Variante: director.gd
const CardDB = preload("res://core/card_db.gd")

var duel := Duel.new()
var director: Director
var hud: Label
var msg: Label
var rows := {}   # "opp", "own", "hand", "act" -> HBoxContainer
var shown := [8000, 8000]
var info := ""
var busy := true   # sperrt Eingaben, solange der Director abspielt
var sel_hand := -1
var sel_slot := -1
var tributes: Array = []


func _ready() -> void:
	director = Director.new()
	add_child(director)
	director.lp_changed.connect(_on_lp)
	director.phase_changed.connect(_on_phase)
	director.won.connect(func(p: int) -> void: msg.text = "Spieler %d gewinnt!" % (p + 1))

	var layer := CanvasLayer.new()
	add_child(layer)
	hud = Label.new()
	layer.add_child(hud)
	hud.set_anchors_and_offsets_preset(Control.PRESET_TOP_WIDE)
	hud.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var box := VBoxContainer.new()
	layer.add_child(box)
	box.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	box.grow_vertical = Control.GROW_DIRECTION_BEGIN   # wächst nach oben, nicht aus dem Fenster
	msg = Label.new()
	msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(msg)
	for k in ["opp", "own", "hand", "act"]:
		var r := HBoxContainer.new()
		r.alignment = BoxContainer.ALIGNMENT_CENTER
		box.add_child(r)
		rows[k] = r
	_act("Beschwören", func() -> bool: return duel.summon(duel.turn, sel_hand, tributes))
	_act("Setzen", func() -> bool: return duel.set_monster(duel.turn, sel_hand, tributes))
	_act("Position / Aufdecken", func() -> bool: return duel.change_position(duel.turn, sel_slot))
	_act("Direktangriff", func() -> bool: return duel.attack(duel.turn, sel_slot, -1))
	_act("Nächste Phase", func() -> bool: return duel.next_phase())

	duel.start(_deck(), _deck(), randi())
	await director.play(duel.take_events())
	busy = false
	_refresh()


# ponytail: Platzhalter-Deck, ersetzen durch echte Decks aus Daten.
func _deck() -> Array:
	var d := []
	for i in 40:
		d.append(["des", "des", "brio", "goyo"][i % 4])
	return d


func _act(label: String, fn: Callable) -> void:
	var b := Button.new()
	b.text = label
	b.pressed.connect(func() -> void: _try(fn))
	rows.act.add_child(b)


func _try(action: Callable) -> void:
	if busy:
		return
	if not action.call():
		if duel.winner == -1:
			msg.text = "Nicht erlaubt"
		return
	msg.text = ""
	sel_hand = -1
	sel_slot = -1
	tributes = []
	busy = true
	await director.play(duel.take_events())
	busy = false
	_refresh()


func _on_hand(i: int) -> void:
	if busy:
		return
	sel_hand = i
	sel_slot = -1
	tributes = []
	_refresh()


func _on_slot(s: int, mine: bool) -> void:
	if busy:
		return
	if not mine:
		_try(func() -> bool: return duel.attack(duel.turn, sel_slot, s))
		return
	if sel_hand >= 0:   # Tribut wählen
		if tributes.has(s):
			tributes.erase(s)
		else:
			tributes.append(s)
	else:
		sel_slot = s
	_refresh()


func _on_lp(p: int, value: int) -> void:
	shown[p] = value
	_hud()


func _on_phase(p: int, phase: String, turn: int) -> void:
	info = "Zug %d: Spieler %d - %s" % [turn, p + 1, phase]
	_hud()


func _hud() -> void:
	hud.text = "Spieler 1: %d   |   Spieler 2: %d\n%s" % [shown[0], shown[1], info]


func _refresh() -> void:
	_hud()
	_field_row(rows.opp, 1 - duel.turn, false)
	_field_row(rows.own, duel.turn, true)
	_clear(rows.hand)
	var h: Array = duel.hand[duel.turn]
	for i in h.size():
		var cd: Dictionary = CardDB.CARDS[h[i]]
		var b := Button.new()
		b.text = ("> " if i == sel_hand else "") + "%s %d/%d L%d" % [cd.name, cd.atk, cd.def, cd.lv]
		b.pressed.connect(_on_hand.bind(i))
		rows.hand.add_child(b)


func _field_row(row: HBoxContainer, p: int, mine: bool) -> void:
	_clear(row)
	for s in Duel.SLOTS:
		var card = duel.field[p][s]
		var b := Button.new()
		b.custom_minimum_size = Vector2(160, 34)
		if card == null:
			b.text = "-"
		elif not card.up and not mine:
			b.text = "verdeckt"
		else:
			b.text = "%s %d/%d" % [card.name, card.atk, card.def]
			if card.pos == "def":
				b.text += " [DEF]"
			if not card.up:
				b.text += " (verdeckt)"
		if mine and tributes.has(s):
			b.text = "TRIBUT " + b.text
		elif mine and s == sel_slot:
			b.text = "> " + b.text
		b.pressed.connect(_on_slot.bind(s, mine))
		row.add_child(b)


func _clear(row: Node) -> void:
	for c in row.get_children():
		row.remove_child(c)
		c.queue_free()
