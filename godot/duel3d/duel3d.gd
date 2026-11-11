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
    buttons = HFlowContainer.new()   # bricht um, statt rechts aus dem Bild zu laufen
    buttons.alignment = FlowContainer.ALIGNMENT_CENTER
    buttons.add_theme_constant_override("h_separation", 8)
    buttons.add_theme_constant_override("v_separation", 8)
    buttons.size_flags_horizontal = Control.SIZE_EXPAND_FILL
    root.add_child(buttons)

    var cut: CutIn = CutIn.new()
    ui.add_child(cut)
    director.cut_in = cut

    for side in ["me", "bot"]:
        var gauge: LpGauge = LpGauge.new()
        gauge.title = "Du" if side == "me" else "Bot"
        gauge.radius = 44.0
        ui.add_child(gauge)
        gauges[side] = gauge
    gauges.me.set_anchors_and_offsets_preset(Control.PRESET_CENTER_LEFT, Control.PRESET_MODE_MINSIZE, 16)
    gauges.bot.set_anchors_and_offsets_preset(Control.PRESET_CENTER_RIGHT, Control.PRESET_MODE_MINSIZE, 16)
    gauges.bot.grow_horizontal = Control.GROW_DIRECTION_BEGIN   # wächst nach links, nicht aus dem Bild


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
    status.text = "Zug %d · %s · %s" % [int(s.turn), "Du" if s.active == "me" else "Bot", s.phase]
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
    button.custom_minimum_size = Vector2(0, 44)
    button.add_theme_font_size_override("font_size", 18)
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
func _unhandled_input(event: InputEvent) -> void:
    var mouse := event as InputEventMouseButton
    if mouse == null or not mouse.pressed or mouse.button_index != MOUSE_BUTTON_LEFT:
        return
    if busy or prompt.is_empty():
        return
    var hit: Dictionary = board.pick(cam, mouse.position)
    if not hit.has("view"):
        return
    var view = hit.view
    var k: String = Board.key(view.side, view.zone, view.index)
    var mine: Array = prompt.choices.filter(func(choice: Dictionary) -> bool: return _key(choice) == k)
    if mine.is_empty():
        return
    if mine.size() == 1 or prompt.get("multi", false):
        _on_choice(int(mine[0].id))
        return
    focus = "" if focus == k else k   # mehrere Aktionen: als Knöpfe zeigen, zweiter Klick schließt
    _show_prompt()
