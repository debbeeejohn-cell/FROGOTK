extends Control
# Cut-in: eine Zauber- oder Fallenkarte wird kurz groß eingeblendet, mit Namensbanner, dann weggeblendet.
# Bild aus res://art/cards/<name>.png, wenn vorhanden; sonst die Kartenfläche in der Rahmenfarbe mit dem Namen.
# Klicks gehen durch (MOUSE_FILTER_IGNORE). Die Regie wartet mit await, bis die Einblendung vorbei ist.
const CardView = preload("res://duel3d/card_view.gd")
const SIZE := Vector2(340.0, 480.0)
const HOLD := 1.0

var _panel: ColorRect
var _picture: TextureRect
var _banner: Label


func _ready() -> void:
	visible = false
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	custom_minimum_size = SIZE
	size = SIZE
	set_anchors_and_offsets_preset(Control.PRESET_CENTER, Control.PRESET_MODE_KEEP_SIZE)
	pivot_offset = SIZE / 2.0
	_panel = ColorRect.new()
	_panel.set_anchors_preset(Control.PRESET_FULL_RECT)
	_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_panel)
	_picture = TextureRect.new()
	_picture.set_anchors_preset(Control.PRESET_FULL_RECT)
	_picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	_picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_picture)
	var strip := ColorRect.new()
	strip.color = Color(0.0, 0.0, 0.0, 0.7)
	strip.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	strip.offset_top = -64.0
	strip.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(strip)
	_banner = Label.new()
	_banner.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	_banner.offset_top = -64.0
	_banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_banner.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_banner.add_theme_font_size_override("font_size", 26)
	_banner.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_banner)


# Blendet die Karte ein, hält sie kurz, blendet sie aus. Die Regie wartet auf das Ende.
func show_card(card_name: String, frame: String) -> void:
	var art_path := "res://art/cards/%s.png" % CardView.slug(card_name)
	_picture.visible = ResourceLoader.exists(art_path)
	if _picture.visible:
		_picture.texture = load(art_path)
	_panel.color = CardView.FRAME.get(frame, CardView.FRAME["spell"])
	_banner.text = card_name
	visible = true
	modulate.a = 1.0
	scale = Vector2(0.4, 0.4)
	var tw := create_tween()
	tw.tween_property(self, "scale", Vector2.ONE, 0.25).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_interval(HOLD)
	tw.tween_property(self, "modulate:a", 0.0, 0.25)
	await get_tree().create_timer(0.25 + HOLD + 0.25).timeout
	visible = false
