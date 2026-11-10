extends Control
# Demo: ein ganzes Duell gegen den Bot, nur mit Text und Knöpfen. Zeigt, wie ein Godot-Client die
# Brücke benutzt. Später ersetzt du _show_field() durch dein Spielfeld und fütterst mit
# state.events deinen Director (summon, attack, move, damage, win).
# Layout nur mit Containern (skaliert mit dem Fenster), Bedienung per Maus, Tastatur und Gamepad.
const DuelClient = preload("res://bridge/duel_client.gd")

@export var my_deck := "frogOtk"
@export var bot_deck := "blackwing"

var client: Node
var field_label: Label
var status_label: Label
var prompt_label: Label
var choices_box: VBoxContainer
var confirm_button: Button
var log_label: Label
var picked: Array = []
var prompt: Dictionary = {}


func _ready() -> void:
	theme = Theme.new()
	theme.default_font_size = 20   # lesbar auch auf dem Fernseher
	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for edge in ["left", "top", "right", "bottom"]:
		margin.add_theme_constant_override("margin_" + edge, 24)
	add_child(margin)
	var columns := HBoxContainer.new()
	columns.add_theme_constant_override("separation", 24)
	margin.add_child(columns)

	var left := VBoxContainer.new()
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	columns.add_child(left)
	status_label = _label(left)
	field_label = _label(left)
	log_label = _label(left)
	log_label.modulate = Color(1, 1, 1, 0.7)

	var right := VBoxContainer.new()
	right.custom_minimum_size.x = 420
	columns.add_child(right)
	prompt_label = _label(right)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	right.add_child(scroll)
	choices_box = VBoxContainer.new()
	choices_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(choices_box)
	confirm_button = _button(right, "Bestätigen", _on_confirm)
	_button(right, "Rückgängig", func() -> void: client.undo())
	_button(right, "Neues Duell", _new_duel)

	client = DuelClient.new()
	add_child(client)
	client.state_changed.connect(_on_state)
	client.failed.connect(func(message: String) -> void: prompt_label.text = message)
	_new_duel()


func _new_duel() -> void:
	client.new_duel(my_deck, bot_deck)


func _on_state(state: Dictionary) -> void:
	for e in state.events:
		print(e)   # hier den Director füttern, z. B. director.play(e)
	status_label.text = "Zug %d · %s · %s\nDu %d LP   Bot %d LP" % [int(state.turn), "Du" if state.active == "me" else "Bot", state.phase, int(state.lp.me), int(state.lp.bot)]
	_show_field(state.field)
	var lines: Array = state.log.slice(0, 6)
	if state.review != null:
		var notes: Array = state.review.notes
		lines.push_front("Lehrer: " + ("Nichts auszusetzen." if notes.is_empty() else " | ".join(notes)))
	log_label.text = "\n".join(lines)
	if state.winner != null:
		prompt_label.text = "Du gewinnst!" if state.winner == "me" else "Der Bot gewinnt."
		prompt = {}
	else:
		prompt = state.prompt if state.prompt != null else {}
	_show_prompt()


func _show_field(f: Dictionary) -> void:
	var row := func(cards: Array) -> String: return "  ".join(cards.map(_card))
	field_label.text = "\n".join([
		"Bot  Hand %d  Deck %d  Friedhof %d" % [int(f.bot.hand), int(f.bot.deck), f.bot.gy.size()],
		"Z/F  " + row.call(f.bot.st), "Mon  " + row.call(f.bot.mz), "",
		"Mon  " + row.call(f.me.mz), "Z/F  " + row.call(f.me.st),
		"Du   Deck %d  Friedhof %d  Extra %d" % [int(f.me.deck), f.me.gy.size(), f.me.extra.size()],
		"Hand " + ", ".join(f.me.hand)])


func _card(c) -> String:
	if c == null:
		return "[ ]"
	if not c.has("name"):
		return "[verdeckt]"
	return "[%s%s%s]" % [c.name, " DEF" if c.pos == "def" else "", " verdeckt" if c.down else ""]


# Jede Frage der Engine wird zu einer Knopfliste. Mehrfachauswahl: Knöpfe einrasten, dann bestätigen.
func _show_prompt() -> void:
	for child in choices_box.get_children():
		child.queue_free()
	picked = []
	var multi: bool = prompt.get("multi", false)
	confirm_button.visible = multi
	if prompt.is_empty():
		return
	prompt_label.text = prompt.title + ("\n" + prompt.hint if prompt.hint != "" else "")
	var first: Button = null
	for choice in prompt.choices:
		var id := int(choice.id)
		var text: String = choice.label
		if choice.has("card"):
			text = "%s: %s" % [choice.card.name, choice.label]
		var button := _button(choices_box, text, _on_choice.bind(id))
		button.toggle_mode = multi
		if first == null:
			first = button
	if first != null:
		first.grab_focus()   # ohne Fokus ist das Menü mit Gamepad/Tastatur nicht bedienbar
	_update_confirm()


func _on_choice(id: int) -> void:
	if not prompt.get("multi", false):
		client.choose(id)
		return
	if picked.has(id):
		picked.erase(id)
	else:
		picked.append(id)
	_update_confirm()


func _update_confirm() -> void:
	var enough: bool = picked.size() >= int(prompt.get("min", 1)) and picked.size() <= int(prompt.get("max", 99))
	confirm_button.disabled = not enough


func _on_confirm() -> void:
	client.pick(picked)


func _label(parent: Node) -> Label:
	var label := Label.new()
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	parent.add_child(label)
	return label


func _button(parent: Node, text: String, action: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size.y = 44
	button.alignment = HORIZONTAL_ALIGNMENT_LEFT
	button.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	button.pressed.connect(action)
	parent.add_child(button)
	return button
