extends Control
# Im Godot-Editor: diese Szene öffnen und F6 drücken. Das Ergebnis steht groß im Fenster.
const Tests = preload("res://tests/duel_tests.gd")


func _ready() -> void:
	var fails: int = Tests.new().run()
	var l := Label.new()
	add_child(l)
	l.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	l.add_theme_font_size_override("font_size", 40)
	l.add_theme_color_override("font_color", Color.GREEN if fails == 0 else Color.RED)
	l.text = "ALLE TESTS GRÜN" if fails == 0 else "%d TESTS ROT\n(Details im Reiter Ausgabe)" % fails
