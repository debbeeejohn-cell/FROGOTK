extends Control
# LP-Anzeige im Stil von Yu-Gi-Oh 5D's: dunkelblaue Stahlfassung, Regenbogen-Scheibe, „LP“ und die Zahl in Weiß.
# Gezeichnet mit _draw, keine Bilddateien. In der Fassung zeigt ein schmaler Bogen die verbleibenden Lebenspunkte.
# set_lp() zählt Zahl und Bogen per Tween auf den neuen Stand.
# ponytail: feste Skala 8000 LP; darüber bleibt der Bogen voll, die Zahl läuft weiter.

const FULL := 8000.0
const COLOR_HIGH := Color(0.35, 0.95, 0.45)
const COLOR_MID := Color(0.98, 0.85, 0.30)
const COLOR_LOW := Color(0.98, 0.35, 0.30)
const STEEL_DARK := Color(0.08, 0.14, 0.26)
const STEEL_MID := Color(0.24, 0.38, 0.56)
const STEEL_LIGHT := Color(0.72, 0.86, 1.0, 0.65)
const TEXT_OUTLINE := Color(0.05, 0.05, 0.14)
const SEGMENTS := 72   # Regenbogen: Tortenstücke der Scheibe
const POINTS := 96

@export var title := "Du"
@export var radius := 54.0   # Außenradius der Fassung

var shown := FULL
var _tween: Tween
var _lp: Label
var _number: Label


func _ready() -> void:
	custom_minimum_size = Vector2(2.0 * radius + 8.0, 2.0 * radius + 8.0 + 30.0)
	_lp = _text_label(radius * 0.30, -radius * 0.58)
	_lp.text = "LP"
	_number = _text_label(radius * 0.40, -radius * 0.22)
	var name_label := Label.new()
	name_label.text = title
	name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_label.position = Vector2(0.0, 2.0 * radius + 12.0)
	name_label.size = Vector2(custom_minimum_size.x, 24.0)
	name_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(name_label)
	_show(shown)


# Weiße Schrift mit dunklem Rand, mittig in der Scheibe; dy verschiebt vom Mittelpunkt aus nach oben (negativ) oder unten.
func _text_label(font_size: float, dy: float) -> Label:
	var label := Label.new()
	var disc := radius * 0.78
	label.position = _center() - Vector2(disc, 0.0) + Vector2(0.0, dy)
	label.size = Vector2(2.0 * disc, font_size * 1.4)
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.add_theme_font_size_override("font_size", int(font_size))
	label.add_theme_color_override("font_color", Color.WHITE)
	label.add_theme_color_override("font_outline_color", TEXT_OUTLINE)
	label.add_theme_constant_override("outline_size", int(maxf(4.0, font_size * 0.28)))
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(label)
	return label


# Ring und Zahl auf einen neuen Stand fahren. instant = sofort (z. B. nach dem Abspielen).
func set_lp(value: float, instant := false) -> void:
	if _tween != null and _tween.is_valid():
		_tween.kill()
	if instant:
		_show(value)
		return
	_tween = create_tween()
	_tween.tween_method(_show, shown, value, 0.6).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)


func _show(value: float) -> void:
	shown = value
	_number.text = str(int(round(value)))
	queue_redraw()


func _draw() -> void:
	var c := _center()
	# Fassung: dunkler Grund, hellerer Ring darin, Glanzbogen oben links
	draw_circle(c, radius, STEEL_DARK)
	draw_arc(c, radius * 0.92, 0.0, TAU, POINTS, STEEL_MID, radius * 0.10, true)
	draw_arc(c, radius * 0.92, PI * 0.80, PI * 1.45, 32, STEEL_LIGHT, radius * 0.05, true)
	# LP-Bogen schmal innen in der Fassung, beginnt oben und läuft im Uhrzeigersinn
	var ratio := clampf(shown / FULL, 0.0, 1.0)
	if ratio > 0.0:
		draw_arc(c, radius * 0.82, -PI / 2.0, -PI / 2.0 + TAU * ratio, POINTS, _color(ratio), radius * 0.07, true)
	# Regenbogen-Scheibe: Farbton läuft einmal um den Mittelpunkt
	var disc := radius * 0.74
	for i in SEGMENTS:
		var a0 := TAU * float(i) / SEGMENTS - PI / 2.0
		var a1 := TAU * float(i + 1) / SEGMENTS - PI / 2.0 + 0.01
		var color := Color.from_hsv(float(i) / SEGMENTS, 0.78, 1.0)
		draw_colored_polygon(PackedVector2Array([c, c + Vector2(cos(a0), sin(a0)) * disc, c + Vector2(cos(a1), sin(a1)) * disc]), color)
	draw_circle(c + Vector2(-disc * 0.25, -disc * 0.30), disc * 0.55, Color(1.0, 1.0, 1.0, 0.10))   # weicher Glanz
	draw_arc(c, disc, 0.0, TAU, POINTS, Color(0.05, 0.08, 0.18, 0.85), 2.0, true)


func _color(ratio: float) -> Color:
	if ratio >= 0.5:
		return COLOR_MID.lerp(COLOR_HIGH, (ratio - 0.5) * 2.0)
	return COLOR_LOW.lerp(COLOR_MID, ratio * 2.0)


func _center() -> Vector2:
	return Vector2(custom_minimum_size.x / 2.0, radius + 4.0)
