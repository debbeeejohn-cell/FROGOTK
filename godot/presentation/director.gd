extends Node2D
# Spielt die Ereignisse des Regelkerns nacheinander als 2D-Cinematic ab.
# Enthält keine Regeln. Kamera-Zoom, Hit-Stop und Shake leben nur hier.
# Karten sind Platzhalter-Rechtecke. Für echte 2D-Grafik ColorRect durch Sprite2D ersetzen.
signal lp_changed(p: int, lp: int)
signal phase_changed(p: int, phase: String, turn: int)
signal won(p: int)

const CENTER := Vector2(576, 324)   # Mitte des Standard-Fensters 1152x648
const CARD := Vector2(120, 170)

@export var shake_enabled := true   # Barrierefreiheit: Shake abschaltbar

var cam: Camera2D
var nodes := {}   # uid -> Node2D
var trauma := 0.0
var _t := 0.0
var _stop_id := 0


func _ready() -> void:
	var bg := ColorRect.new()
	bg.color = Color(0.08, 0.2, 0.12)
	bg.size = Vector2(1152, 648)
	bg.z_index = -10
	add_child(bg)
	cam = Camera2D.new()
	cam.position = CENTER
	add_child(cam)


func slot_pos(p: int, slot: int) -> Vector2:
	return Vector2(CENTER.x + (slot - 2) * 150, 470 if p == 0 else 180)


func play(events: Array) -> void:
	for e in events:
		match e.t:
			"summon": await _summon(e)
			"flip": await _flip(e)
			"position": await _position(e)
			"attack": await _attack(e)
			"destroy": await _destroy(e)
			"damage": lp_changed.emit(e.p, e.lp)
			"phase": phase_changed.emit(e.p, e.phase, e.turn)
			"win": won.emit(e.winner)
	await _cam_to(CENTER, Vector2.ONE, 0.4)


# --- Feedback: Trauma-Shake (nur Kamera-Offset) und Hit-Stop (Echtzeit-Timer) ---
func _process(dt: float) -> void:
	trauma = maxf(trauma - 1.5 * dt, 0.0)
	_t += dt * 30.0
	var s := trauma * trauma if shake_enabled else 0.0
	cam.offset = Vector2(sin(_t * 1.7), sin(_t * 2.3)) * 24.0 * s


func _exit_tree() -> void:
	Engine.time_scale = 1.0   # Hit-Stop darf nie hängen bleiben


func hit_stop(duration := 0.08, slow := 0.05) -> void:
	_stop_id += 1
	var id := _stop_id
	Engine.time_scale = slow
	await get_tree().create_timer(duration, true, false, true).timeout
	if id == _stop_id:
		Engine.time_scale = 1.0


func _cam_to(pos: Vector2, zoom: Vector2, dur: float) -> void:
	var tw := create_tween().set_parallel()
	tw.tween_property(cam, "position", pos, dur).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw.tween_property(cam, "zoom", zoom, dur).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	await tw.finished


# --- Ereignisse ---
func _summon(e: Dictionary) -> void:
	var c := Node2D.new()
	var r := ColorRect.new()
	r.size = CARD
	r.position = -CARD / 2
	r.color = Color(0.25, 0.45, 0.9) if e.p == 0 else Color(0.9, 0.35, 0.3)
	var l := Label.new()
	l.text = ("%s\n%d" % [e.name, e.atk]) if e.up else "?"   # verdeckt: nichts verraten
	l.size = CARD
	l.position = -CARD / 2
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	c.add_child(r)
	c.add_child(l)
	add_child(c)
	c.position = slot_pos(e.p, e.slot)
	c.rotation_degrees = 90.0 if e.pos == "def" else 0.0
	c.scale = Vector2.ZERO
	nodes[e.uid] = c
	var tw := create_tween()
	tw.tween_property(c, "scale", Vector2.ONE, 0.35).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	trauma = minf(trauma + 0.2, 1.0)
	await tw.finished


func _flip(e: Dictionary) -> void:
	var c: Node2D = nodes.get(e.uid)
	if c == null:
		return
	(c.get_child(1) as Label).text = "%s\n%d" % [e.name, e.atk]
	var tw := create_tween()
	tw.tween_property(c, "scale", Vector2(1.2, 1.2), 0.1)
	tw.tween_property(c, "scale", Vector2.ONE, 0.1)
	await tw.finished


func _position(e: Dictionary) -> void:
	var c: Node2D = nodes.get(e.uid)
	if c == null:
		return
	var tw := create_tween()
	tw.tween_property(c, "rotation_degrees", 90.0 if e.pos == "def" else 0.0, 0.25)
	await tw.finished


func _attack(e: Dictionary) -> void:
	var c: Node2D = nodes.get(e.uid)
	if c == null:
		return
	var home := c.position
	var target := slot_pos(e.tp, e.tslot) if e.tslot >= 0 else Vector2(CENTER.x, slot_pos(e.tp, 0).y)
	var dir := (target - home).normalized()
	await _cam_to((home + target) / 2.0, Vector2(1.3, 1.3), 0.3)
	c.z_index = 5
	var tw := create_tween()
	tw.tween_property(c, "position", target - dir * 150.0, 0.2).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_IN)
	await tw.finished
	trauma = minf(trauma + 0.6, 1.0)
	hit_stop()
	var victim: Node2D = nodes.get(e.tuid)
	if victim:
		victim.modulate = Color(3, 3, 3)   # Treffer-Blitz
		create_tween().tween_property(victim, "modulate", Color.WHITE, 0.25)
	var back := create_tween()
	back.tween_property(c, "position", home, 0.3).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	await back.finished
	c.z_index = 0


func _destroy(e: Dictionary) -> void:
	var c: Node2D = nodes.get(e.uid)
	if c == null:
		return
	nodes.erase(e.uid)
	var tw := create_tween()
	tw.tween_property(c, "scale", Vector2.ZERO, 0.3).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_IN)
	await tw.finished
	c.queue_free()
