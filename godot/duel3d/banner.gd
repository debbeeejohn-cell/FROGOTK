extends Control
# Phasen-Banner: ein kleiner Streifen mit dem Namen der Phase, mittig, blendet ein, hält und blendet aus.
# Klicks gehen durch (MOUSE_FILTER_IGNORE). Die Regie wartet mit await, bis er weg ist.

var _label: Label


func _ready() -> void:
	visible = false
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_preset(Control.PRESET_FULL_RECT)
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(center)
	var box := PanelContainer.new()
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var paper := StyleBoxFlat.new()
	paper.bg_color = Color(0.05, 0.07, 0.16, 0.94)
	paper.border_color = Color(0.95, 0.80, 0.35)
	paper.set_border_width_all(2)
	paper.set_corner_radius_all(8)
	paper.content_margin_left = 28.0
	paper.content_margin_right = 28.0
	paper.content_margin_top = 10.0
	paper.content_margin_bottom = 10.0
	box.add_theme_stylebox_override("panel", paper)
	center.add_child(box)
	_label = Label.new()
	_label.add_theme_font_size_override("font_size", 34)
	_label.add_theme_color_override("font_color", Color(1.0, 0.92, 0.6))
	_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(_label)


func show_text(text: String, hold: float) -> void:
	_label.text = text
	modulate.a = 0.0
	visible = true
	var tw := create_tween()
	tw.tween_property(self, "modulate:a", 1.0, 0.15)
	tw.tween_interval(hold)
	tw.tween_property(self, "modulate:a", 0.0, 0.2)
	await tw.finished
	visible = false
