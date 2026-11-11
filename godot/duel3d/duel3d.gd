extends Node3D
# Hauptszene: Kamera, Spielfeld, Regie, Bedienung. Verbindet alles mit der Duell-Brücke (duel_client.gd).
# Klick auf eine Karte zeigt ihre Aktionen (bei nur einer Aktion wird sie sofort ausgeführt); wählbare Karten leuchten grün.
# Knöpfe gibt es sonst nur für Aktionen ohne sichtbare Karte (Phasen, Ja/Nein, Karten im Deck). Während die Regie spielt, ist nichts
# klickbar. Eintreffende Zustände warten in einer Schlange und werden der Reihe nach abgespielt.
const Board = preload("res://duel3d/board.gd")
const Director = preload("res://duel3d/director.gd")
const DuelClient = preload("res://bridge/duel_client.gd")
const LpGauge = preload("res://duel3d/lp_gauge.gd")
const CutIn = preload("res://duel3d/cut_in.gd")
const SummonShow = preload("res://duel3d/summon_show.gd")

const BUILD := "Stand 5"   # steht oben in der Statuszeile: zeigt auf einem Screenshot, welche Version läuft
const CAM_HOME := Transform3D(Basis.IDENTITY, Vector3(0.0, 13.0, 13.5))   # mittig über dem Feld: beide Seiten und meine Hand im Bild

var board: Board
var director: Director
var cam: Camera3D
var client: DuelClient
var ui: CanvasLayer
var status: Label
var hint: Label
var buttons: HFlowContainer
var log_label: Label
var prompt: Dictionary = {}
var picked: Array = []        # Auswahl-Indizes bei Mehrfachauswahl
var focus := ""              # angeklickte Karte ("me:hand:2"), deren Aktionen als Knöpfe erscheinen
var busy := false
var gauges := {}              # "me" / "bot" -> LpGauge
var _state: Dictionary = {}
var _queue: Array = []        # Zustände, die noch abgespielt werden
var detail: PanelContainer    # Karten-Detail: Bild, Werte und Text der Karte unter dem Mauszeiger
var detail_art: TextureRect
var detail_text: Label
var pile_view: PanelContainer # Friedhof, Verbannt oder Extra Deck als Liste
var pile_title: Label
var pile_list: HFlowContainer


func _ready() -> void:
	cam = Camera3D.new()
	cam.fov = 55.0
	add_child(cam)
	cam.transform = CAM_HOME
	cam.look_at(Vector3(0.0, 0.0, -0.5), Vector3.UP)
	cam.make_current()

	board = Board.new()
	add_child(board)

	director = Director.new()
	add_child(director)
	director.setup(board, cam)
	director.lp_changed.connect(_on_lp)

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
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE   # Klicks aufs Feld müssen durchkommen
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
	spacer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(spacer)

	hint = Label.new()
	hint.add_theme_font_size_override("font_size", 20)
	root.add_child(hint)
	buttons = HFlowContainer.new()   # bricht um, statt rechts aus dem Bild zu laufen
	buttons.alignment = FlowContainer.ALIGNMENT_CENTER
	buttons.add_theme_constant_override("h_separation", 8)
	buttons.add_theme_constant_override("v_separation", 8)
	buttons.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	root.add_child(buttons)

	var cut: CutIn = CutIn.new()
	ui.add_child(cut)
	director.cut_in = cut
	var summon: SummonShow = SummonShow.new()
	ui.add_child(summon)
	director.summon_show = summon

	for side in ["me", "bot"]:
		var gauge: LpGauge = LpGauge.new()
		gauge.title = "Du" if side == "me" else "Bot"
		gauge.radius = 44.0
		gauge.mouse_filter = Control.MOUSE_FILTER_IGNORE
		ui.add_child(gauge)
		gauges[side] = gauge
	gauges.me.set_anchors_and_offsets_preset(Control.PRESET_CENTER_LEFT, Control.PRESET_MODE_MINSIZE, 16)
	gauges.bot.set_anchors_and_offsets_preset(Control.PRESET_CENTER_RIGHT, Control.PRESET_MODE_MINSIZE, 16)
	gauges.bot.grow_horizontal = Control.GROW_DIRECTION_BEGIN   # wächst nach links, nicht aus dem Bild


	# Karten-Detail oben rechts: erscheint, wenn die Maus über einer offenen Karte steht.
	detail = PanelContainer.new()
	detail.mouse_filter = Control.MOUSE_FILTER_IGNORE
	detail.custom_minimum_size = Vector2(300, 0)
	detail.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT, Control.PRESET_MODE_MINSIZE, 16)
	detail.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	detail.visible = false
	ui.add_child(detail)
	var detail_box := VBoxContainer.new()
	detail_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	detail.add_child(detail_box)
	detail_art = TextureRect.new()
	detail_art.custom_minimum_size = Vector2(168, 246)
	detail_art.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	detail_art.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	detail_art.mouse_filter = Control.MOUSE_FILTER_IGNORE
	detail_box.add_child(detail_art)
	detail_text = Label.new()
	detail_text.custom_minimum_size = Vector2(284, 0)
	detail_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	detail_text.add_theme_font_size_override("font_size", 14)
	detail_box.add_child(detail_text)

	# Stapel-Ansicht in der Mitte: Friedhof, Verbannt, eigenes Extra Deck.
	pile_view = PanelContainer.new()
	pile_view.custom_minimum_size = Vector2(720, 0)
	pile_view.set_anchors_and_offsets_preset(Control.PRESET_CENTER, Control.PRESET_MODE_MINSIZE)
	pile_view.grow_horizontal = Control.GROW_DIRECTION_BOTH
	pile_view.grow_vertical = Control.GROW_DIRECTION_BOTH
	pile_view.visible = false
	ui.add_child(pile_view)
	var pile_box := VBoxContainer.new()
	pile_box.add_theme_constant_override("separation", 8)
	pile_view.add_child(pile_box)
	pile_title = Label.new()
	pile_title.add_theme_font_size_override("font_size", 20)
	pile_box.add_child(pile_title)
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(700, 340)
	pile_box.add_child(scroll)
	pile_list = HFlowContainer.new()
	pile_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pile_list.add_theme_constant_override("h_separation", 8)
	pile_list.add_theme_constant_override("v_separation", 8)
	scroll.add_child(pile_list)
	var close := Button.new()
	close.text = "Schließen"
	close.custom_minimum_size = Vector2(0, 44)
	close.pressed.connect(func() -> void: pile_view.visible = false)
	pile_box.add_child(close)


# Bild einer Karte von der Brücke holen; sobald es da ist, zeigen es alle Karten dieses Namens.
func _load_image(card_name: String) -> void:
	var tex: ImageTexture = await client.fetch_image(card_name)
	if tex != null:
		board.set_texture(card_name, tex)


func _show_detail(card_name: String) -> void:
	var facts: Dictionary = board.cards.get(card_name, {})
	detail.visible = card_name != "" and not facts.is_empty()
	if not detail.visible:
		return
	detail_art.texture = facts.get("tex")
	detail_art.visible = detail_art.texture != null
	var stats := ""
	if facts.get("monster", false):
		stats = "Stufe %d · %s · ATK %d / DEF %d\n" % [int(facts.get("level", 0)), facts.get("attribute", ""), int(facts.get("atk", 0)), int(facts.get("def", 0))]
	detail_text.text = "%s\n%s%s\n\n%s" % [card_name, stats, facts.get("type", ""), facts.get("desc", "")]


# Klick auf einen Stapel: Friedhof und Verbannt beider Seiten, dazu das eigene Extra Deck. Decks bleiben zu.
func _show_pile(pile: String) -> void:
	var side: String = pile.get_slice(":", 0)
	var kind: String = pile.get_slice(":", 1)
	var half: Dictionary = _state.get("field", {}).get(side, {})
	var groups := []
	if kind == "gy":
		groups = [["Friedhof", half.get("gy", [])]]
	elif kind == "banished":
		groups = [["Verbannt", half.get("banished", [])]]
	elif kind == "extra" and half.get("extra") is Array:
		groups = [["Extra Deck", half["extra"]]]
	if groups.is_empty():
		return
	for child in pile_list.get_children():
		child.queue_free()
	var parts := []
	for group in groups:
		var names: Array = group[1]
		parts.append("%s %d" % [group[0], names.size()])
		for i in names.size():
			var card_name: String = names[i]
			var tile := Button.new()   # Knopf: mit Maus und Tastatur erreichbar, zeigt beim Überfahren das Detail
			tile.custom_minimum_size = Vector2(104, 152)
			tile.tooltip_text = "%s (%s)" % [card_name, group[0]]
			var tex = board.cards.get(card_name, {}).get("tex")
			if tex != null:
				tile.icon = tex
				tile.expand_icon = true
			else:
				tile.text = card_name
				tile.clip_text = true
			tile.mouse_entered.connect(_show_detail.bind(card_name))
			tile.focus_entered.connect(_show_detail.bind(card_name))
			if kind == "extra":
				tile.pressed.connect(_on_extra.bind(i, card_name))
			pile_list.add_child(tile)
	pile_title.text = "%s: %s" % ["Du" if side == "me" else "Bot", " · ".join(parts)]
	pile_view.visible = true


# Klick auf ein Monster im eigenen Extra Deck: beschwören, wenn die Engine es gerade erlaubt.
func _on_extra(index: int, card_name: String) -> void:
	for choice in prompt.get("choices", []):
		if choice.has("card") and choice.card.side == "me" and choice.card.zone == "extra" and int(choice.card.index) == index:
			pile_view.visible = false
			_on_choice(int(choice.id))
			return
	hint.text = "%s: gerade nicht beschwörbar." % card_name


func _on_state(state: Dictionary) -> void:
	_queue.append(state)
	if not busy:
		_drain()


# Spielt die wartenden Zustände der Reihe nach ab. Während einer Animation sind keine Knöpfe da.
func _drain() -> void:
	busy = true
	_clear_prompt()
	while not _queue.is_empty():
		var s: Dictionary = _queue.pop_front()
		_state = s
		for card_name in s.get("cards", {}):
			board.cards[card_name] = s.cards[card_name]
			_load_image(card_name)
		await director.play(s.events, s.field)
	busy = false
	_refresh()


func _on_lp(side: String, lp: int) -> void:
	gauges[side].set_lp(float(lp))


# Nach der Animation: Anzeige, Markierung und Knöpfe aus dem letzten Zustand.
func _refresh() -> void:
	var s := _state
	if s.is_empty() or not s.get("duel", false):
		return
	for side in gauges:
		gauges[side].set_lp(float(s.lp[side]), true)
	status.text = "Zug %d · %s · %s   (%s)" % [int(s.turn), "Du" if s.active == "me" else "Bot", s.phase, BUILD]
	var lines: Array = s.log.slice(0, 4)
	if s.review != null:
		var notes: Array = s.review.notes
		lines.push_front("Lehrer: " + ("Nichts auszusetzen." if notes.is_empty() else " | ".join(notes)))
	log_label.text = "\n".join(lines)
	prompt = s.prompt if s.prompt != null else {}
	picked = []
	focus = ""
	_show_prompt()
	if s.winner != null:
		hint.text = "Du gewinnst!" if s.winner == "me" else "Der Bot gewinnt."


func _clear_prompt() -> void:
	prompt = {}
	picked = []
	focus = ""
	for child in buttons.get_children():
		child.queue_free()
	board.set_marks({})


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
		var k := _key(choice)
		var on_board: bool = k != "" and board.views.has(k)
		if on_board:
			marks[k] = "selected" if picked.has(int(choice.id)) or k == focus else "pick"
		if on_board and (multi or (prompt.kind == "actions" and k != focus)):   # Fragen wie Ja/Nein behalten ihre Knöpfe
			continue   # sichtbare Karte: Klick auf die Karte statt Knopf
		if prompt.kind == "actions" and choice.has("card") and choice.card.zone == "extra":
			continue   # kein Vorschlag: Extra-Deck-Monster wählt man selbst im Extra Deck (Klick auf den Stapel)
		var label: String = choice.label
		if choice.has("card"):
			label = "%s: %s" % [choice.card.name, label]
		var button := _button(label, _on_choice.bind(int(choice.id)), multi)
		button.button_pressed = multi and picked.has(int(choice.id))
	if multi:
		_button("Bestätigen", _on_confirm, false)
	board.set_marks(marks)


func _key(choice: Dictionary) -> String:
	return Board.key(choice.card.side, choice.card.zone, int(choice.card.index)) if choice.has("card") else ""


func _button(text: String, action: Callable, toggle: bool) -> Button:
	var button := Button.new()
	button.text = text
	button.toggle_mode = toggle
	button.custom_minimum_size = Vector2(0, 48)
	button.add_theme_font_size_override("font_size", 20)
	button.add_theme_color_override("font_color", Color.WHITE)
	for state in ["normal", "hover", "pressed", "focus"]:   # dunkle Fläche mit hellem Rand: hebt sich vom Feld ab
		var box := StyleBoxFlat.new()
		box.bg_color = {"normal": Color(0.07, 0.10, 0.22, 0.96), "hover": Color(0.14, 0.24, 0.48, 0.98), "pressed": Color(0.85, 0.60, 0.10, 1.0), "focus": Color(0.07, 0.10, 0.22, 0.0)}[state]
		box.border_color = Color(1.0, 0.85, 0.3) if state == "focus" else Color(0.45, 0.80, 1.0)
		box.set_border_width_all(2)
		box.set_corner_radius_all(6)
		box.content_margin_left = 16.0
		box.content_margin_right = 16.0
		box.content_margin_top = 8.0
		box.content_margin_bottom = 8.0
		button.add_theme_stylebox_override(state, box)
	button.pressed.connect(action)
	buttons.add_child(button)
	return button


func _on_choice(id: int) -> void:
	if busy:
		return
	if not prompt.get("multi", false):
		client.choose(id)
		return
	if picked.has(id):
		picked.erase(id)
	else:
		picked.append(id)
	_show_prompt()


func _on_confirm() -> void:
	if not busy:
		client.pick(picked)


# Klick aufs Feld: die Karte unter dem Mauszeiger wählt die Brücke aus, wenn sie in der Frage steht.
# Liegt die Maus auf einem Knopf oder auf der Stapel-Ansicht? Dann gehört der Klick der Oberfläche, nicht dem Feld.
func _over_ui() -> bool:
	var control := get_viewport().gui_get_hovered_control()
	return control != null and (control is BaseButton or control == pile_view or pile_view.is_ancestor_of(control))


# _input statt _unhandled_input: Container der Oberfläche dürfen Klicks aufs Feld nicht verschlucken.
func _input(event: InputEvent) -> void:
	if _over_ui():
		return
	var motion := event as InputEventMouseMotion
	if motion != null:   # Karte unter dem Mauszeiger im Detail zeigen
		var over: Dictionary = board.pick(cam, motion.position)
		_show_detail(str(over.view.data.get("name", "")) if over.has("view") else "")
		return
	var mouse := event as InputEventMouseButton
	if mouse == null or not mouse.pressed or mouse.button_index != MOUSE_BUTTON_LEFT:
		return
	var hit: Dictionary = board.pick(cam, mouse.position)
	if hit.has("pile"):   # Stapel ansehen geht immer, auch wenn gerade nichts zu wählen ist
		_show_pile(hit.pile)
		return
	if busy or prompt.is_empty() or not hit.has("view"):
		return
	var view = hit.view
	var clicked := str(view.data.get("name", "verdeckte Karte"))
	var k: String = Board.key(view.side, view.zone, view.index)
	var mine: Array = prompt.choices.filter(func(choice: Dictionary) -> bool: return _key(choice) == k)
	if mine.is_empty():   # Rückmeldung statt Stille
		hint.text = "%s: gerade keine Aktion möglich." % clicked
		return
	if mine.size() == 1 or prompt.get("multi", false):
		_on_choice(int(mine[0].id))
		return
	focus = "" if focus == k else k   # mehrere Aktionen: als Knöpfe zeigen, zweiter Klick schließt
	_show_prompt()
