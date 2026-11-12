extends Node3D
# Eine Karte auf dem Feld: liegende Karte mit Namen, bei offenen Monstern eine Figur und ein ATK/DEF-Schild.
# Nur eigene Platzhalter-Formen. Eigene Grafik wird automatisch benutzt, wenn die Datei existiert
# (siehe art/README.md): res://art/cards/<name>.png und res://art/models/<name>.glb.
# ponytail: Figuren sind Kapseln mit Kopf; eigene Modelle ersetzen sie ohne Code-Änderung.

const SIZE := Vector3(1.7, 0.04, 2.4)
const BACK := Color(0.42, 0.24, 0.14)
const FRAME := {
	"normal": Color(0.78, 0.64, 0.36), "effect": Color(0.80, 0.47, 0.22), "fusion": Color(0.56, 0.36, 0.66),
	"synchro": Color(0.86, 0.86, 0.84), "ritual": Color(0.36, 0.52, 0.82), "token": Color(0.55, 0.55, 0.55),
	"spell": Color(0.11, 0.56, 0.48), "trap": Color(0.70, 0.24, 0.48),
}
const ATTRIBUTE := {
	"DARK": Color(0.50, 0.30, 0.70), "LIGHT": Color(0.95, 0.88, 0.45), "WATER": Color(0.30, 0.60, 0.95),
	"FIRE": Color(0.95, 0.35, 0.25), "EARTH": Color(0.60, 0.45, 0.30), "WIND": Color(0.40, 0.80, 0.50),
	"DIVINE": Color(0.95, 0.80, 0.30),
}
const SPRITE_PATH := "res://art/sprites/%s.png"   # eigene Designs, lokal, nicht im Repo (siehe art/sprites/README.md)
const MARK := {"": [Color.BLACK, 0.0], "pick": [Color(0.3, 1.0, 0.5), 1.4], "selected": [Color(1.0, 0.8, 0.2), 2.2]}

var side := "me"
var zone := "mz"
var index := 0
var data: Dictionary = {}
var info: Dictionary = {}
var figure_height := 0.0
# "" = normal, "pick" = wählbar (grün), "selected" = gewählt (gold)
var mark := "":
	set(value):
		mark = value
		_apply_mark()
# Leuchtstärke der Karte; der Director fährt sie per Tween (Aufblitzen).
var glow := 0.0:
	set(value):
		glow = value
		if _mat != null:
			_mat.emission_energy_multiplier = value

var _mat: StandardMaterial3D
var _oval: MeshInstance3D
var _art: MeshInstance3D
var _rim: MeshInstance3D   # farbiger Rand unter der Karte: wählbar (grün) oder gewählt (gold)
var _title: Label3D
var _stats: Label3D        # der Wert in der Plakette
var _badge: Sprite3D       # runde Plakette neben der Figur: Ring, ATK oder DEF, Wert, Stufe
var _kind: Label3D
var _level: Label3D
static var _rings := {}    # Ringfarbe -> Textur (einmal gezeichnet)
static var _emblems := {}  # Attributfarbe -> Wappen-Textur
static var _shadow: Texture2D
var _figure: Node3D
var _figure_name := ""


func _ready() -> void:
	var box := BoxMesh.new()
	box.size = SIZE
	var face := MeshInstance3D.new()
	face.mesh = box
	face.position.y = SIZE.y / 2.0
	_mat = StandardMaterial3D.new()
	_mat.emission_enabled = true
	_mat.emission_energy_multiplier = 0.0
	face.material_override = _mat
	add_child(face)

	var rim_mesh := BoxMesh.new()
	rim_mesh.size = Vector3(SIZE.x + 0.2, 0.02, SIZE.z + 0.2)
	_rim = MeshInstance3D.new()
	_rim.mesh = rim_mesh
	_rim.position.y = 0.01
	var rim_mat := StandardMaterial3D.new()
	rim_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_rim.material_override = rim_mat
	_rim.visible = false
	add_child(_rim)

	# Kartenrücken: dunkles Oval auf braunem Grund
	var disc := CylinderMesh.new()
	disc.top_radius = 0.5
	disc.bottom_radius = 0.5
	disc.height = 0.01
	_oval = MeshInstance3D.new()
	_oval.mesh = disc
	_oval.scale = Vector3(0.95, 1.0, 1.5)
	_oval.position.y = SIZE.y + 0.006
	var dark := StandardMaterial3D.new()
	dark.albedo_color = Color(0.08, 0.10, 0.16)
	_oval.material_override = dark
	add_child(_oval)

	# Eigenes Kartenbild (optional), liegt als Fläche auf der Karte
	var plane := PlaneMesh.new()
	plane.size = Vector2(SIZE.x * 0.94, SIZE.z * 0.94)
	_art = MeshInstance3D.new()
	_art.mesh = plane
	_art.position.y = SIZE.y + 0.004
	_art.visible = false
	add_child(_art)

	_title = Label3D.new()
	_title.rotation_degrees.x = -90.0   # liegt flach, lesbar von der eigenen Seite
	_title.position.y = SIZE.y + 0.012
	_title.font_size = 44
	_title.pixel_size = 0.0065
	_title.outline_size = 10
	_title.width = 240.0
	_title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_title)

	_badge = Sprite3D.new()
	_badge.billboard = BaseMaterial3D.BILLBOARD_ENABLED   # dreht sich immer zur Kamera
	_badge.no_depth_test = true
	_badge.pixel_size = 0.011
	_badge.render_priority = 1
	_badge.visible = false
	add_child(_badge)
	_kind = _badge_label(26, Vector2(0.0, 34.0))
	_stats = _badge_label(46, Vector2(0.0, -2.0))
	_level = _badge_label(24, Vector2(0.0, -40.0))
	_level.modulate = Color(1.0, 0.85, 0.3)


func _badge_label(font_size: int, offset: Vector2) -> Label3D:
	var label := Label3D.new()
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.no_depth_test = true
	label.render_priority = 2   # über dem Ring
	label.font_size = font_size
	label.pixel_size = 0.0075
	label.outline_size = 8
	label.offset = offset
	_badge.add_child(label)
	return label


# Dunkle Scheibe mit farbigem Ring, 128 px, einmal je Farbe gezeichnet.
static func ring_texture(color: Color) -> Texture2D:
	if not _rings.has(color):
		var picture := Image.create(128, 128, false, Image.FORMAT_RGBA8)
		for y in 128:
			for x in 128:
				var d := Vector2(x - 63.5, y - 63.5).length()
				if d <= 62.0:
					picture.set_pixel(x, y, color if d >= 53.0 else Color(0.04, 0.05, 0.10, 0.92))
		_rings[color] = ImageTexture.create_from_image(picture)
	return _rings[color]


# card: { name?, atk, def, down, pos } aus dem Zustand der Brücke. facts: Kartenfakten (frame, level, attribute).
func show_card(card: Dictionary, facts: Dictionary) -> void:
	data = card
	info = facts
	var card_name := str(card.get("name", ""))
	var down: bool = card.get("down", false)
	var on_monster_zone := zone == "mz"
	var frame: Color = FRAME.get(facts.get("frame", "effect"), FRAME["effect"])
	_mat.albedo_color = BACK if down else frame
	_oval.visible = down
	# Bild: eigene Datei in art/cards hat Vorrang, sonst das Bild von der Brücke (facts.tex)
	var art_path := "res://art/cards/%s.png" % slug(card_name)
	var tex: Texture2D = null
	if not down and card_name != "":
		if ResourceLoader.exists(art_path):
			tex = load(art_path)
		elif facts.get("tex") != null:
			tex = facts["tex"]
	var has_art := tex != null
	_art.visible = has_art
	if has_art:
		var picture := StandardMaterial3D.new()
		picture.albedo_texture = tex
		picture.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED   # bleibt bei Nacht lesbar
		_art.material_override = picture
	_title.visible = not has_art
	_title.text = ("(verdeckt)\n" if down else "") + card_name
	_title.modulate = Color(1, 1, 1, 0.6) if down else Color.WHITE
	rotation_degrees.y = 90.0 if on_monster_zone and card.get("pos", "atk") == "def" else 0.0

	var standing := on_monster_zone and not down
	if _figure != null and _figure_name != card_name:
		_figure.queue_free()
		_figure = null
	if standing and _figure == null:
		_build_figure(card_name)
	if _figure != null:
		_figure.visible = standing
	_badge.visible = standing
	if standing:
		var defense: bool = card.get("pos", "atk") == "def"
		var color := Color(0.35, 0.65, 1.0) if defense else Color(1.0, 0.55, 0.15)
		_badge.texture = ring_texture(color)
		_kind.text = "DEF" if defense else "ATK"
		_kind.modulate = color
		_stats.text = str(int(card.get("def" if defense else "atk", 0)))
		_level.text = "LV %d" % int(facts.get("level", 0)) if int(facts.get("level", 0)) > 0 else ""
	_apply_mark()


# Die Figur (für Angriffs-Animationen). Ohne Figur bewegt sich die Karte selbst.
func figure() -> Node3D:
	return _figure if _figure != null and _figure.visible else self


# Kurzes helles Aufblitzen (Beschwörung, Treffer, Aktivierung).
func flash() -> void:
	_mat.emission = Color.WHITE
	glow = 4.0
	var tw := create_tween()
	tw.tween_property(self, "glow", 0.0, 0.3)
	tw.tween_callback(_apply_mark)


# Klickbereich in Weltkoordinaten: Kartenfläche, bei stehender Figur so hoch wie die Figur.
func pick_box() -> AABB:
	var sideways := absf(rotation_degrees.y) > 45.0
	var width := SIZE.z if sideways else SIZE.x
	var depth := SIZE.x if sideways else SIZE.z
	var height := figure_height if _figure != null and _figure.visible else 0.3
	if zone == "hand":   # geneigte, kleinere Karte: schmaler und höher
		return AABB(global_position - Vector3(width * 0.4, 0.2, depth * 0.35), Vector3(width * 0.8, 1.4, depth * 0.7))
	return AABB(global_position - Vector3(width / 2.0, 0.0, depth / 2.0), Vector3(width, height, depth))


# "Swap Frog" -> "swap_frog" (Dateiname für eigene Grafik)
static func slug(card_name: String) -> String:
	var re := RegEx.create_from_string("[^a-z0-9]+")
	return re.sub(card_name.to_lower(), "_", true).trim_prefix("_").trim_suffix("_")


func _apply_mark() -> void:
	if _mat == null:
		return
	var style: Array = MARK.get(mark, MARK[""])
	_mat.emission = Color.BLACK
	glow = 0.0
	_rim.visible = mark != ""
	(_rim.material_override as StandardMaterial3D).albedo_color = style[0]


func _build_figure(card_name: String) -> void:
	_figure_name = card_name
	figure_height = clampf(1.1 + int(info.get("level", 4)) * 0.14, 1.2, 2.4)
	var model_path := "res://art/models/%s.glb" % slug(card_name)
	if ResourceLoader.exists(model_path):
		_figure = (load(model_path) as PackedScene).instantiate() as Node3D
	if _figure == null and ResourceLoader.exists(SPRITE_PATH % slug(card_name)):
		_figure = _sprite_figure(load(SPRITE_PATH % slug(card_name)) as Texture2D, figure_height)
	if _figure == null:
		var tint: Color = ATTRIBUTE.get(info.get("attribute", ""), Color(0.7, 0.7, 0.75))
		_figure = _emblem_figure(figure_height, tint, int(info.get("level", 0)))
	add_child(_figure)
	_figure.scale = Vector3.ONE * 0.6   # Auftritt: kurz klein, federt auf Normalgröße
	create_tween().tween_property(_figure, "scale", Vector3.ONE, 0.3).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	_badge.position = Vector3(1.15, figure_height * 0.75, 0.0)


# Dein Design: aufrecht (nur um die Hochachse zur Kamera gedreht), unbeleuchtet, Füße unten auf der Karte, weicher Schatten.
func _sprite_figure(tex: Texture2D, height: float) -> Node3D:
	var root := Node3D.new()
	var sprite := Sprite3D.new()
	sprite.texture = tex
	sprite.billboard = BaseMaterial3D.BILLBOARD_FIXED_Y
	sprite.shaded = false
	sprite.pixel_size = height / maxf(float(tex.get_height()), 1.0)
	sprite.offset = Vector2(0.0, tex.get_height() * 0.5)   # Mittelpunkt nach oben: der untere Rand liegt auf dem Boden
	sprite.position.y = SIZE.y + 0.03
	root.add_child(sprite)
	root.add_child(_shadow_blob(height * 0.55))
	_float(sprite)
	return root


# Wappen für Monster ohne eigenes Design: Scheibe in der Attributfarbe mit Stufe. Gezeichnet, keine Bilddatei.
func _emblem_figure(height: float, tint: Color, level: int) -> Node3D:
	var root := Node3D.new()
	var disc := Sprite3D.new()
	disc.texture = emblem_texture(tint)
	disc.billboard = BaseMaterial3D.BILLBOARD_FIXED_Y
	disc.shaded = false
	disc.pixel_size = (height * 0.62) / 128.0
	disc.position.y = SIZE.y + 0.03 + height * 0.36
	root.add_child(disc)
	if level > 0:
		var label := Label3D.new()
		label.text = "LV %d" % level
		label.billboard = BaseMaterial3D.BILLBOARD_FIXED_Y
		label.no_depth_test = true
		label.font_size = 48
		label.pixel_size = 0.006
		label.outline_size = 12
		label.position.y = disc.position.y
		root.add_child(label)
	root.add_child(_shadow_blob(height * 0.45))
	_float(disc)
	return root


# Sanftes Schweben (nur Anzeige): die Figur hebt und senkt sich um wenige Zentimeter.
func _float(node: Node3D) -> void:
	var base := node.position.y
	var tw := node.create_tween().set_loops()
	tw.tween_property(node, "position:y", base + 0.06, 1.1).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	tw.tween_property(node, "position:y", base, 1.1).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)


# Weicher dunkler Fleck unter der Figur, einmal als Textur gezeichnet.
func _shadow_blob(width: float) -> MeshInstance3D:
	if _shadow == null:
		var gradient := Gradient.new()
		gradient.colors = PackedColorArray([Color(0.0, 0.0, 0.0, 0.55), Color(0.0, 0.0, 0.0, 0.0)])
		gradient.offsets = PackedFloat32Array([0.0, 1.0])
		var tex := GradientTexture2D.new()
		tex.gradient = gradient
		tex.fill = GradientTexture2D.FILL_RADIAL
		tex.fill_from = Vector2(0.5, 0.5)
		tex.fill_to = Vector2(1.0, 0.5)
		tex.width = 128
		tex.height = 128
		_shadow = tex
	var mesh := PlaneMesh.new()
	mesh.size = Vector2(width, width * 0.6)
	var node := MeshInstance3D.new()
	node.mesh = mesh
	var material := StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.albedo_texture = _shadow
	node.material_override = material
	node.position.y = SIZE.y + 0.02
	return node


# Scheibe mit dunklem Rand und leichtem Farbverlauf, 128 px, einmal je Farbe gezeichnet.
static func emblem_texture(color: Color) -> Texture2D:
	if not _emblems.has(color):
		var picture := Image.create(128, 128, false, Image.FORMAT_RGBA8)
		for y in 128:
			for x in 128:
				var d := Vector2(x - 63.5, y - 63.5).length()
				if d <= 62.0:
					var shade := color.lerp(Color.WHITE, 0.25 * (1.0 - float(y) / 128.0))
					picture.set_pixel(x, y, color.darkened(0.55) if d >= 54.0 else shade)
		_emblems[color] = ImageTexture.create_from_image(picture)
	return _emblems[color]


# Platzhalter: Körper (Kapsel) und Kopf (Kugel). Auch für die Duellanten benutzt.
static func placeholder_figure(height: float, tint: Color) -> Node3D:
	var root := Node3D.new()
	var material := StandardMaterial3D.new()
	material.albedo_color = tint
	material.emission_enabled = true   # bleibt bei Nacht erkennbar
	material.emission = tint
	material.emission_energy_multiplier = 0.25
	var body_mesh := CapsuleMesh.new()
	body_mesh.radius = 0.36
	body_mesh.height = height * 0.78
	var body := MeshInstance3D.new()
	body.mesh = body_mesh
	body.material_override = material
	body.position.y = height * 0.39
	root.add_child(body)
	var head_mesh := SphereMesh.new()
	head_mesh.radius = 0.24
	head_mesh.height = 0.48
	var head := MeshInstance3D.new()
	head.mesh = head_mesh
	head.material_override = material
	head.position.y = height * 0.78 + 0.16
	root.add_child(head)
	return root
