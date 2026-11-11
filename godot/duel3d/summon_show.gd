extends Control
# Beschwörungs-Einblendung wie im Anime: Sternenhimmel, das Monster groß in der Mitte, runde Werte-Plakette
# fährt von links ein, Name unten. Klicks gehen durch. Die Regie wartet mit await, bis sie vorbei ist.
# Das Monsterbild ist der Bildausschnitt des Kartenbilds (facts.tex); ohne Bild steht nur der Name da.
const HOLD := 0.7
const ART := Rect2(0.12, 0.185, 0.76, 0.52)   # Bildfenster einer Karte, als Anteil der Kartenfläche
const PICTURE := 400.0
const ATK_COLOR := Color(1.0, 0.55, 0.15)
const DEF_COLOR := Color(0.35, 0.65, 1.0)

var _picture: TextureRect
var _name: Label
var _badge: Badge
var _stars: Array = []   # [Vector3(x 0..1, y 0..1, Radius)]


# Runde Plakette: Ring, „ATK“ oder „DEF“, der Wert groß, darunter die Stufe.
class Badge extends Control:
	var kind := "ATK"
	var value := 0
	var level := 0
	var color := Color.WHITE

	func _draw() -> void:
		var c := size / 2.0
		var r := size.x / 2.0 - 8.0
		var font := get_theme_default_font()
		draw_circle(c, r, Color(0.04, 0.05, 0.10, 0.95))
		draw_arc(c, r, 0.0, TAU, 64, color, 9.0, true)
		draw_arc(c, r - 10.0, 0.0, TAU, 64, Color(1, 1, 1, 0.25), 2.0, true)
		draw_string(font, Vector2(0.0, c.y - 30.0), kind, HORIZONTAL_ALIGNMENT_CENTER, size.x, 24, color)
		draw_string(font, Vector2(0.0, c.y + 16.0), str(value), HORIZONTAL_ALIGNMENT_CENTER, size.x, 44)
		if level > 0:
			draw_string(font, Vector2(0.0, c.y + 46.0), "LV %d" % level, HORIZONTAL_ALIGNMENT_CENTER, size.x, 22, Color(1.0, 0.85, 0.3))


func _ready() -> void:
	visible = false
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_preset(Control.PRESET_FULL_RECT)
	var rng := RandomNumberGenerator.new()
	rng.seed = 5
	for i in 140:
		_stars.append(Vector3(rng.randf(), rng.randf(), rng.randf_range(0.6, 2.2)))
	_picture = TextureRect.new()
	_picture.size = Vector2(PICTURE, PICTURE)
	_picture.pivot_offset = _picture.size / 2.0
	_picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_picture)
	_name = Label.new()
	_name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_name.add_theme_font_size_override("font_size", 34)
	_name.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_name)
	_badge = Badge.new()
	_badge.size = Vector2(170.0, 170.0)
	_badge.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_badge)


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.03, 0.02, 0.10, 0.93))
	for star in _stars:
		draw_circle(Vector2(star.x * size.x, star.y * size.y), star.z, Color(0.85, 0.9, 1.0, 0.25 + star.z * 0.3))


# facts: Kartenfakten (tex, level). defense = in Verteidigungsposition beschworen.
func show_monster(card_name: String, facts: Dictionary, atk: int, def: int, defense: bool) -> void:
	var tex: Texture2D = facts.get("tex")
	_picture.visible = tex != null
	if tex != null:
		var art := AtlasTexture.new()
		art.atlas = tex
		var full := tex.get_size()
		art.region = Rect2(full.x * ART.position.x, full.y * ART.position.y, full.x * ART.size.x, full.y * ART.size.y)
		_picture.texture = art
	# Anordnung aus der aktuellen Fenstergröße: Bild mittig, Name darunter, Plakette unten links
	_picture.position = (size - _picture.size) / 2.0 - Vector2(0.0, 30.0)
	_name.position = Vector2(0.0, _picture.position.y + PICTURE + 12.0)
	_name.size = Vector2(size.x, 44.0)
	_name.text = card_name
	_badge.kind = "DEF" if defense else "ATK"
	_badge.value = def if defense else atk
	_badge.level = int(facts.get("level", 0))
	_badge.color = DEF_COLOR if defense else ATK_COLOR
	_badge.position = Vector2(-_badge.size.x, size.y - _badge.size.y - 90.0)
	_badge.queue_redraw()
	queue_redraw()
	modulate.a = 0.0
	_picture.scale = Vector2(0.6, 0.6)
	visible = true
	var tw := create_tween()
	tw.tween_property(self, "modulate:a", 1.0, 0.15)
	tw.parallel().tween_property(_picture, "scale", Vector2.ONE, 0.3).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.parallel().tween_property(_badge, "position:x", 48.0, 0.3).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw.tween_interval(HOLD)
	tw.tween_property(self, "modulate:a", 0.0, 0.2)
	await tw.finished
	visible = false
