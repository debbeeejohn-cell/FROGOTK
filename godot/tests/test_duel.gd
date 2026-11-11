extends SceneTree
# Lauf: godot --headless -s tests/test_duel.gd   (Exit-Code 0 = alles grün)
const Tests = preload("res://tests/duel_tests.gd")


func _init() -> void:
	var fails: int = Tests.new().run()
	quit(1 if fails > 0 else 0)
