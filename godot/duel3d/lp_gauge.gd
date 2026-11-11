extends Control
# LP-Ring wie in Yu-Gi-Oh 5D's: ein Ring um die Zahl, der Bogen zeigt die verbleibenden Lebenspunkte.
# Gezeichnet mit _draw, keine Bilddateien. set_lp() zählt Zahl und Bogen per Tween auf den neuen Stand.
# ponytail: feste Skala 8000 LP; darüber bleibt der Ring voll, die Zahl läuft weiter.

const FULL := 8000.0
const COLOR_HIGH := Color(0.35, 0.95, 0.45)
const COLOR_MID := Color(0.98, 0.85, 0.30)
const COLOR_LOW := Color(0.98, 0.35, 0.30)
const TRACK := Color(0.10, 0.12, 0.16, 0.9)
const POINTS := 96

@export var title := "Du"
@export var radius := 56.0
@export var width := 12.0

var shown := FULL
var _tween: Tween
var _number: Label


func _ready() -> void:
	var ring := radius + width
	custom_minimum_size = Vector2(2.0 * ring + 8.0, 2.0 * (ring + 4.0) + 30.0)
	_number = Label.new()
	_number.position = _center() - Vector2(radius, radius)
	_number.size = Vector2(2.0 * radius, 2.0 * radius)
	_number.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_number.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_number.add_theme_font_size_override("font_size", 28)
	add_child(_number)
	var name_label := Label.new()
	name_label.text = title
	name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_label.position = Vector2(0.0, 2.0 * (ring + 4.0) + 4.0)
	name_label.size = Vector2(custom_minimum_size.x, 24.0)
	add_child(name_label)
	_show(shown)


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
	draw_arc(c, radius, 0.0, TAU, POINTS, TRACK, width, true)
	var ratio := clampf(shown / FULL, 0.0, 1.0)
	if ratio > 0.0:
		draw_arc(c, radius, -PI / 2.0, -PI / 2.0 + TAU * ratio, POINTS, _color(ratio), width, true)


func _color(ratio: float) -> Color:
	if ratio >= 0.5:
		return COLOR_MID.lerp(COLOR_HIGH, (ratio - 0.5) * 2.0)
	return COLOR_LOW.lerp(COLOR_MID, ratio * 2.0)


func _center() -> Vector2:
	return Vector2(custom_minimum_size.x / 2.0, radius + width + 4.0)
