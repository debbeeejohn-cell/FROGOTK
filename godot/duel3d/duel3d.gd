extends Node3D
# Hauptszene: Kamera, Spielfeld, Regie, Bedienung. Verbindet alles mit der Duell-Brücke (duel_client.gd).
# Klick auf eine Karte = Auswahl; wählbare Karten leuchten grün. Die Leiste unten zeigt die Antworten
# der Engine (Beschwören, Setzen, Angreifen, Phase weiter …). Ohne Eingabe läuft nichts, während die Regie spielt.

const Board = preload("res://duel3d/board.gd")
const Director = preload("res://duel3d/director.gd")
const DuelClient = preload("res://bridge/duel_client.gd")

const CAM_HOME := Transform3D(Basis.IDENTITY, Vector3(0.0, 11.5, 14.8))   # Übersicht, siehe Kamerarechnung

var board: Node3D
var director: Node
var cam: Camera3D
var client: Node
var ui: CanvasLayer
var status: Label
var hint: Label
var buttons: HBoxContainer
var log_label: Label
var prompt: Dictionary = {}
var picked: Array = []        # Auswahl-Indizes bei Mehrfachauswahl
var busy := false
var _state: Dictionary = {}


func _ready() -> void:
	cam = Camera3D.new()
	cam.fov = 50.0
	add_child(cam)
	cam.transform = CAM_HOME
	cam.look_at(Vector3(3.0, 0.0, 0.5), Vector3.UP)
	cam.make_current()

	board = Board.new()
	add_child(board)

	director = Director.new()
	add_child(director)
	director.setup(board, cam)
	director.finished.connect(_on_played)

	client = DuelClient.new()
	add_child(client)
	client.state_changed.connect(_on_state)
	client.failed.connect(func(message: String) -> void: hint.text = message)

	_build_ui()
	client.new_duel("frogOtk", "blackwing", [], true, "aktiv")


func _build_ui() -> void:
	ui = CanvasLayer.new()
	add_child(ui)
	var root := VBoxContainer.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_theme_constant_override("separation", 8)
	for edge in ["left", "right", "top", "bottom"]:
		root.add_theme_constant_override("margin_" + edge, 16)
	ui.add_child(root)

	status = Label.new()
	status.add_theme_font_size_override("font_size", 22)
	root.add_child(status)
	log_label = Label.new()
	log_label.modulate = Color(1, 1, 1, 0.75)
	log_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	root.add_child(log_label)

	var spacer := Control.new()
	spacer.size_flags_vertical = Control.SIZE_EXPAND_FILL
	root.add_child(spacer)

	hint = Label.new()
	hint.add_theme_font_size_override("font_size", 20)
	root.add_child(hint)
	buttons = HBoxContainer.new()
	buttons.alignment = BoxContainer.ALIGNMENT_CENTER
	buttons.add_theme_constant_override("separation", 8)
	buttons.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	root.add_child(buttons)


func _on_state(state: Dictionary) -> void:
	_state = state
	for name in state.get("cards", {}):
		board.cards[name] = state.cards[name]
	if busy:
		return
	busy = true
	await director.play(state.events, state.field)
	busy = false


func _on_played() -> void:
	_refresh()


# Nach der Animation: Anzeige, Markierung und Knöpfe aus dem Zustand.
func _refresh() -> void:
	var s := _state
	if s.is_empty() or not s.get("duel", false):
		return
	status.text = "Zug %d · %s · %s        Du %d LP   Bot %d LP" % [int(s.turn), "Du" if s.active == "me" else "Bot", s.phase, int(s.lp.me), int(s.lp.bot)]
	var lines: Array = s.log.slice(0, 4)
	if s.review != null:
		var notes: Array = s.review.notes
		lines.push_front("Lehrer: " + ("Nichts auszusetzen." if notes.is_empty() else " | ".join(notes)))
	log_label.text = "\n".join(lines)
	prompt = s.prompt if s.prompt != null else {}
	picked = []
	_show_prompt()
	if s.winner != null:
		hint.text = "Du gewinnst!" if s.winner == "me" else "Der Bot gewinnt."


# Wählbare Karten leuchten; jede Auswahl ist eine Knopfliste, Mehrfachauswahl wird bestätigt.
func _show_prompt() -> void:
	for child in buttons.get_children():
		child.queue_free()
	var marks := {}
	var multi: bool = prompt.get("multi", false)
	if prompt.is_empty():
		hint.text = ""
		board.set_marks(marks)
		return
	hint.text = prompt.title + ("   " + prompt.hint if prompt.get("hint", "") != "" else "")
	for choice in prompt.choices:
		if choice.has("card"):
			var c: Dictionary = choice.card
			marks["%s:%s:%d" % [c.side, c.zone, int(c.index)]] = "pick"
		var label: String = choice.label
		if choice.has("card"):
			label = "%s: %s" % [choice.card.name, label]
		_button(label, _on_choice.bind(int(choice.id)), multi)
	if multi:
		_button("Bestätigen", _on_confirm, false)
	board.set_marks(marks)


func _button(text: String, action: Callable, toggle: bool) -> void:
	var button := Button.new()
	button.text = text
	button.toggle_mode = toggle
	button.custom_minimum_size = Vector2(0, 44)
	button.add_theme_font_size_override("font_size", 18)
	button.pressed.connect(action)
	buttons.add_child(button)


func _on_choice(id: int) -> void:
	if not prompt.get("multi", false):
		client.choose(id)
		return
	if picked.has(id):
		picked.erase(id)
	else:
		picked.append(id)


func _on_confirm() -> void:
	client.pick(picked)


# Klick aufs Feld: die Karte unter dem Mauszeiger wählt die Brücke aus, wenn sie in der Frage steht.
func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT):
		return
	if busy or prompt.is_empty():
		return
	var hit: Dictionary = board.pick(cam, event.position)
	if not hit.has("view"):
		return
	var view = hit.view
	var key := "%s:%s:%d" % [view.side, view.zone, view.index]
	for choice in prompt.choices:
		if choice.has("card") and "%s:%s:%d" % [choice.card.side, choice.card.zone, int(choice.card.index)] == key:
			_on_choice(int(choice.id))
			return
