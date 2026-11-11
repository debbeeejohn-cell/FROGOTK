extends Node3D
# Das Spielfeld: Arena (Straße bei Nacht), Zonen beider Seiten, Stapel, Duellanten und alle Karten.
# Kennt keine Regeln. sync(field) gleicht alles mit dem Zustand der Brücke ab (das ist die Wahrheit),
# place()/take() benutzt der Director für Animationen zwischen zwei Zuständen.
const CardView = preload("res://duel3d/card_view.gd")

const STEP := 2.1          # Abstand der Zonen nebeneinander
const ROW_MONSTER := 1.7   # Abstand der Monsterreihe von der Mittellinie
const ROW_SPELL := 4.4
const PILE_X := 6.5        # Deck/Friedhof rechts, Feldzauber/Extra Deck links (aus Sicht des Spielers)
const DUELIST := Vector3(4.2, 0.25, 8.8)
const SIDES := ["me", "bot"]
const ON_FIELD := ["mz", "st", "field"]

var cards: Dictionary = {}    # Kartenname -> Fakten; das Hauptskript füllt sie aus state.cards
var views: Dictionary = {}    # "me:mz:2" -> CardView
var _piles: Dictionary = {}   # "me:gy" -> { "node": MeshInstance3D, "label": Label3D }
var _bot_hand: Node3D
var _hand_count := 0         # meine Handkarten liegen offen als Fächer vor mir


func _ready() -> void:
	_build_arena()
	for side in SIDES:
		for i in 5:
			_marker(zone_pos(side, "mz", i))
			_marker(zone_pos(side, "st", i))
		_marker(zone_pos(side, "field", 0))
		_pile(side, "deck", CardView.BACK)
		_pile(side, "extra", CardView.BACK)
		_pile(side, "gy", Color(0.35, 0.38, 0.45))
		_pile(side, "banished", Color(0.30, 0.26, 0.40))
		_duelist(side)
	_bot_hand = Node3D.new()
	_bot_hand.position = Vector3(0.0, 2.0, -7.4)
	add_child(_bot_hand)


static func key(side: String, zone: String, index: int) -> String:
	return "%s:%s:%d" % [side, zone, 0 if zone == "field" else index]


# Mittelpunkt einer Zone auf dem Boden. Die Bot-Seite ist punktgespiegelt (seine Zone 0 liegt bei dir rechts).
func zone_pos(side: String, zone: String, index: int) -> Vector3:
	var s := 1.0 if side == "me" else -1.0
	match zone:
		"mz":
			return Vector3((index - 2) * STEP * s, 0.0, ROW_MONSTER * s)
		"st":
			return Vector3((index - 2) * STEP * s, 0.0, ROW_SPELL * s)
		"field":
			return Vector3(-PILE_X * s, 0.0, ROW_MONSTER * s)
		"gy":
			return Vector3(PILE_X * s, 0.0, ROW_MONSTER * s)
		"banished":
			return Vector3((PILE_X + STEP) * s, 0.0, ROW_MONSTER * s)
		"deck":
			return Vector3(PILE_X * s, 0.0, ROW_SPELL * s)
		"extra":
			return Vector3(-PILE_X * s, 0.0, ROW_SPELL * s)
	if side == "me":   # meine Hand: eine Reihe vor mir, rückt bei vielen Karten zusammen
		var gap := minf(1.6, 11.0 / maxf(_hand_count, 1))
		return Vector3((index - (_hand_count - 1) / 2.0) * gap, 1.0, 7.0)
	return Vector3(0.0, 2.0, -7.4)   # Hand des Bots: Start und Ziel für Flug-Animationen


func duelist_pos(side: String) -> Vector3:
	return DUELIST * (1.0 if side == "me" else -1.0) + Vector3(0.0, DUELIST.y * (0.0 if side == "me" else 2.0), 0.0)


func view_at(side: String, zone: String, index: int) -> CardView:
	return views.get(key(side, zone, index))


# Legt eine Karte in die Zone oder aktualisiert die vorhandene. card wie im Zustand: { name?, atk, def, down, pos }.
func place(side: String, zone: String, index: int, card: Dictionary) -> CardView:
	var k := key(side, zone, index)
	var view: CardView = views.get(k)
	if view == null:
		view = CardView.new()
		view.side = side
		view.zone = zone
		view.index = index
		add_child(view)
		views[k] = view
	view.position = zone_pos(side, zone, index)
	if zone == "hand":   # kleiner und zur Kamera geneigt
		view.scale = Vector3.ONE * 0.8
		view.rotation_degrees.x = 35.0
	view.show_card(card, cards.get(card.get("name", ""), {}))
	return view


# Nimmt die Karte aus der Zone, ohne sie zu löschen (der Director animiert sie noch und gibt sie dann frei).
func take(side: String, zone: String, index: int) -> CardView:
	var k := key(side, zone, index)
	var view: CardView = views.get(k)
	views.erase(k)
	return view


func remove(side: String, zone: String, index: int) -> void:
	var view := take(side, zone, index)
	if view != null:
		view.queue_free()


func clear() -> void:
	for view in views.values():
		view.queue_free()
	views.clear()


# Gleicht das Feld mit dem Zustand der Brücke ab. Danach stimmt alles, auch wenn eine Animation etwas ausgelassen hat.
func sync(field: Dictionary) -> void:
	for side in SIDES:
		var half: Dictionary = field[side]
		for zone in ["mz", "st"]:
			var slots: Array = half[zone]
			for i in slots.size():
				_sync_slot(side, zone, i, slots[i])
		_sync_slot(side, "field", 0, half["field"])
		var gy: Array = half["gy"]
		var banished: Array = half["banished"]
		var extra = half["extra"]
		_set_pile(side, "deck", int(half["deck"]), "Deck")
		_set_pile(side, "extra", extra.size() if extra is Array else int(extra), "Extra")
		# Oben liegt offen die zuletzt dorthin gelegte Karte.
		_set_pile(side, "gy", gy.size(), "Friedhof", gy[-1] if not gy.is_empty() else "")
		_set_pile(side, "banished", banished.size(), "Verbannt", banished[-1] if not banished.is_empty() else "")
	_set_bot_hand(int(field["bot"]["hand"]))
	var hand: Array = field["me"]["hand"]
	for i in range(hand.size(), _hand_count):
		remove("me", "hand", i)
	_hand_count = hand.size()
	for i in hand.size():
		var facts: Dictionary = cards.get(hand[i], {})
		place("me", "hand", i, {"name": hand[i], "down": false, "pos": "atk", "atk": facts.get("atk", 0), "def": facts.get("def", 0)})


# marks: "me:mz:2" -> "pick" oder "selected". Alle anderen Karten verlieren ihre Markierung.
func set_marks(marks: Dictionary) -> void:
	for k in views:
		var view: CardView = views[k]
		view.mark = marks.get(k, "")


# Was liegt unter dem Mauszeiger? { "view": CardView } oder { "pile": "me:gy" } oder {}.
# Eigene Strahl-Rechnung statt Physik: Die Zonen sind Rechtecke, das braucht keine Kollisionskörper.
func pick(cam: Camera3D, screen_pos: Vector2) -> Dictionary:
	var origin := cam.project_ray_origin(screen_pos)
	var dir := cam.project_ray_normal(screen_pos)
	var best := {}
	var best_dist := INF
	for view in views.values():
		var hit = (view as CardView).pick_box().intersects_ray(origin, dir)
		if hit != null and origin.distance_to(hit) < best_dist:
			best_dist = origin.distance_to(hit)
			best = {"view": view}
	for k in _piles:
		var node: MeshInstance3D = _piles[k]["node"]
		if not node.visible:
			continue
		var size := Vector3(CardView.SIZE.x, maxf(node.scale.y, 0.2), CardView.SIZE.z)
		var base := Vector3(node.position.x, 0.0, node.position.z) - Vector3(size.x / 2.0, 0.0, size.z / 2.0)
		var hit = AABB(base, size).intersects_ray(origin, dir)
		if hit != null and origin.distance_to(hit) < best_dist:
			best_dist = origin.distance_to(hit)
			best = {"pile": k}
	return best


func _sync_slot(side: String, zone: String, index: int, card) -> void:
	if card == null:
		remove(side, zone, index)
	else:
		place(side, zone, index, card)


# --- Aufbau ---
func _build_arena() -> void:
	var world := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.04, 0.06, 0.15)   # Nachthimmel
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.40, 0.45, 0.62)
	env.ambient_light_energy = 1.0
	env.glow_enabled = true   # leuchtende Karten wirken wie Hologramme
	world.environment = env
	add_child(world)
	var moon := DirectionalLight3D.new()
	moon.rotation_degrees = Vector3(-55.0, 30.0, 0.0)
	moon.light_color = Color(0.75, 0.80, 1.0)
	moon.shadow_enabled = true
	add_child(moon)
	# Straße: Fahrbahn, gelbe Doppellinie als Mittellinie zwischen den Spielern, Gehwege
	_box(Vector3(60.0, 0.1, 18.0), Vector3(0.0, -0.05, 0.0), Color(0.12, 0.12, 0.14))
	for z in [-0.12, 0.12]:
		_box(Vector3(60.0, 0.02, 0.07), Vector3(0.0, 0.004, z), Color(0.95, 0.75, 0.1))
	for i in 15:
		for z in [-6.6, 6.6]:
			_box(Vector3(1.2, 0.02, 0.12), Vector3(-28.0 + i * 4.0, 0.004, z), Color(0.85, 0.85, 0.85))
	for z in [-10.0, 10.0]:
		_box(Vector3(60.0, 0.3, 2.4), Vector3(0.0, 0.1, z), Color(0.45, 0.45, 0.48))
	# Häuserzeile hinter dem Gegner (nur Kulisse)
	var heights := [7.0, 11.0, 5.0, 9.0, 13.0, 6.0, 10.0, 8.0]
	for i in heights.size():
		var h: float = heights[i]
		_box(Vector3(6.4, h, 5.0), Vector3(-25.0 + i * 7.0, h / 2.0, -15.5), Color(0.16, 0.18, 0.26))


func _box(size: Vector3, pos: Vector3, color: Color) -> MeshInstance3D:
	var mesh := BoxMesh.new()
	mesh.size = size
	var node := MeshInstance3D.new()
	node.mesh = mesh
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	node.material_override = material
	node.position = pos
	add_child(node)
	return node


# Leere Zone: schwach leuchtender Rahmen auf dem Boden
func _marker(pos: Vector3) -> void:
	var node := _box(Vector3(CardView.SIZE.x + 0.14, 0.01, CardView.SIZE.z + 0.14), pos + Vector3(0.0, 0.006, 0.0), Color(0.55, 0.70, 1.0, 0.14))
	(node.material_override as StandardMaterial3D).transparency = BaseMaterial3D.TRANSPARENCY_ALPHA


func _pile(side: String, kind: String, color: Color) -> void:
	var pos := zone_pos(side, kind, 0)
	var node := _box(Vector3(CardView.SIZE.x, 1.0, CardView.SIZE.z), pos, color)
	var label := Label3D.new()
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.no_depth_test = true
	label.font_size = 36
	label.pixel_size = 0.0075
	label.outline_size = 10
	label.position = pos + Vector3(0.0, 1.1, 0.0)
	add_child(label)
	var top_mesh := PlaneMesh.new()   # Bild der obersten Karte (Friedhof, Verbannt)
	top_mesh.size = Vector2(CardView.SIZE.x, CardView.SIZE.z)
	var top := MeshInstance3D.new()
	top.mesh = top_mesh
	top.position = pos
	top.visible = false
	add_child(top)
	_piles["%s:%s" % [side, kind]] = {"node": node, "label": label, "top": top, "top_name": ""}
	_set_pile(side, kind, 0, "")


func _set_pile(side: String, kind: String, count: int, title: String, top_name := "") -> void:
	var pile: Dictionary = _piles["%s:%s" % [side, kind]]
	pile["top_name"] = top_name
	var node: MeshInstance3D = pile["node"]
	var label: Label3D = pile["label"]
	node.visible = count > 0
	node.scale.y = maxf(count * 0.012, 0.04)   # Stapelhöhe wächst mit der Kartenzahl
	node.position.y = node.scale.y / 2.0
	label.visible = count > 0
	label.text = title if "\n" in title else "%s %d" % [title, count]
	_show_top(pile)


# Legt das Bild der obersten Karte auf den Stapel; ohne Bild steht ihr Name im Schild.
func _show_top(pile: Dictionary) -> void:
	var node: MeshInstance3D = pile["node"]
	var top: MeshInstance3D = pile["top"]
	var top_name: String = pile["top_name"]
	var tex = cards.get(top_name, {}).get("tex")
	top.visible = node.visible and tex != null
	if top.visible:
		var material := StandardMaterial3D.new()
		material.albedo_texture = tex
		material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		top.material_override = material
		top.position.y = node.scale.y + 0.01
	elif node.visible and top_name != "":
		(pile["label"] as Label3D).text += "\n" + top_name


func _duelist(side: String) -> void:
	var model_path := "res://art/models/duelist.glb"
	var figure: Node3D = null
	if ResourceLoader.exists(model_path):
		figure = (load(model_path) as PackedScene).instantiate() as Node3D
	if figure == null:
		figure = CardView.placeholder_figure(1.8, Color(0.35, 0.50, 0.85) if side == "me" else Color(0.85, 0.35, 0.35))
	figure.position = duelist_pos(side)
	figure.rotation_degrees.y = 180.0 if side == "me" else 0.0   # schaut zum Gegner
	add_child(figure)


# Die Handkarten des Bots schweben als Kartenrücken vor ihm (nur die Anzahl ist bekannt).
func _set_bot_hand(count: int) -> void:
	if _bot_hand.get_child_count() == count:
		return
	for child in _bot_hand.get_children():
		child.queue_free()
	for i in count:
		var mesh := BoxMesh.new()
		mesh.size = Vector3(0.62, 0.88, 0.02)
		var node := MeshInstance3D.new()
		node.mesh = mesh
		var material := StandardMaterial3D.new()
		material.albedo_color = CardView.BACK
		node.material_override = material
		node.position.x = (i - (count - 1) / 2.0) * 0.7
		_bot_hand.add_child(node)


# Zahl über dem Duellanten (Schaden, Zahlung, Heilung): steigt auf, wird durchsichtig und verschwindet.
func popup(side: String, text: String, color: Color) -> void:
	var label := Label3D.new()
	label.text = text
	label.modulate = color
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.no_depth_test = true
	label.font_size = 96
	label.pixel_size = 0.012
	label.outline_size = 14
	label.position = duelist_pos(side) + Vector3(0.0, 3.4, 0.0)
	add_child(label)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(label, "position:y", label.position.y + 1.6, 1.0).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw.tween_property(label, "modulate:a", 0.0, 0.5).set_delay(0.6)
	get_tree().create_timer(1.2).timeout.connect(label.queue_free)


# Ein Kartenbild ist angekommen: merken und alle offenen Karten dieses Namens neu zeichnen.
func set_texture(card_name: String, tex: Texture2D) -> void:
	if not cards.has(card_name):
		cards[card_name] = {}
	cards[card_name]["tex"] = tex
	for view in views.values():
		if (view as CardView).data.get("name", "") == card_name:
			(view as CardView).show_card(view.data, cards[card_name])
	for pile in _piles.values():
		if pile["top_name"] == card_name:
			_show_top(pile)


# Fliegende Karte für Bewegungen aus Deck, Friedhof, Verbannt, Extra Deck: Kartenbild, bei unbekannter Karte der Rücken.
# tint färbt sie leicht (Ziel Friedhof, Verbannt). Der Aufrufer gibt sie wieder frei.
func flying_card(card_name: String, pos: Vector3, tint := Color.BLACK) -> MeshInstance3D:
	var mesh := PlaneMesh.new()
	mesh.size = Vector2(CardView.SIZE.x, CardView.SIZE.z)
	var node := MeshInstance3D.new()
	node.mesh = mesh
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	var tex = cards.get(card_name, {}).get("tex")
	if tex != null:
		material.albedo_texture = tex
	else:
		material.albedo_color = CardView.BACK
	if tint != Color.BLACK:
		material.albedo_color = material.albedo_color.lerp(tint, 0.35)
	node.material_override = material
	node.position = pos + Vector3(0.0, 0.5, 0.0)
	add_child(node)
	return node


# Loser Kartenrücken für Flug-Animationen (Ziehen). Der Aufrufer gibt ihn wieder frei.
func card_back(pos: Vector3) -> MeshInstance3D:
	return _box(CardView.SIZE, pos, CardView.BACK)


func hand_center(side: String) -> Vector3:
	return Vector3(0.0, 1.0, 7.0) if side == "me" else Vector3(0.0, 2.0, -7.4)
