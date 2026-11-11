extends Node
# Regie: spielt die Ereignisse der Brücke nacheinander ab (Beschwörung, Angriff, Treffer, Zerstörung).
# Jedes Ereignis wird mit await abgespielt; danach gleicht sync() das Feld mit dem Zustand ab.
# Kennt keine Regeln: sie zeigt nur, was die Engine schon entschieden hat.

signal finished
signal lp_changed(side: String, lp: int)

const CAM_DIST := 16.0
const ZOOM_DIST := 9.0

var board: Node3D
var cam: Camera3D
var busy := false
var trauma := 0.0       # Kamera-Zittern, 0..1
var shake_enabled := true
var _t := 0.0
var _home: Transform3D
var _stop_id := 0


func setup(b: Node3D, c: Camera3D) -> void:
	board = b
	cam = c
	_home = cam.transform


func _process(dt: float) -> void:
	_t += dt * 30.0
	trauma = maxf(trauma - 1.5 * dt, 0.0)
	var s := trauma * trauma if shake_enabled else 0.0
	cam.h_offset = sin(_t * 1.7) * 0.35 * s
	cam.v_offset = sin(_t * 2.3) * 0.35 * s


func _exit_tree() -> void:
	Engine.time_scale = 1.0   # Hit-Stop darf nie hängen bleiben


# Spielt eine Ereignisliste ab. Danach stimmt das Feld mit field überein.
func play(events: Array, field: Dictionary) -> void:
	busy = true
	for e in events:
		await _event(e)
	board.sync(field)
	busy = false
	await _cam_to(_home, 0.4)
	finished.emit()


func _event(e: Dictionary) -> void:
	match e.type:
		"summon": await _summon(e)
		"set": await _set(e)
		"attack": await _attack(e)
		"damage": await _lp_change(e, "-", Color(1.0, 0.35, 0.3), true)
		"pay": await _lp_change(e, "-", Color(1.0, 0.6, 0.2), false)
		"heal": await _lp_change(e, "+", Color(0.4, 1.0, 0.5), false)
		"move": await _move(e)
		"chain": await _chain(e)
		"win": await _win(e)
		_: pass   # turn, phase, draw, negate: nur Zustand, keine Animation nötig


func _summon(e: Dictionary) -> void:
	var view = board.view_at(e.side, e.zone, e.index)
	if view == null:
		view = board.place(e.side, e.zone, e.index, {"name": e.name, "atk": e.atk, "def": e.def, "down": false, "pos": e.pos})
	view.flash()
	trauma = minf(trauma + 0.15, 1.0)
	await _pause(0.35)


func _set(e: Dictionary) -> void:
	var view = board.place(e.side, e.zone, e.index, {"name": e.name, "down": true, "pos": "def", "atk": 0, "def": 0})
	view.flash()
	await _pause(0.25)


func _chain(e: Dictionary) -> void:
	var view = board.view_at(e.side, e.zone, e.index)
	if view != null:
		view.flash()
	await _pause(0.3)


# Angriff: Kamera zoomt auf die Paarung, der Angreifer läuft vor, Treffer mit kurzem Hit-Stop.
func _attack(e: Dictionary) -> void:
	var attacker = board.view_at(e.from.side, e.from.zone, e.from.index)
	if attacker == null:
		return
	var mover: Node3D = attacker.figure()
	var home := mover.global_position
	var target_pos: Vector3 = board.duelist_pos(e.to.side) if e.to == null or e.to.zone != "mz" else board.zone_pos(e.to.side, "mz", e.to.index)
	if e.to != null and e.to.zone == "mz":
		var target_view = board.view_at(e.to.side, "mz", e.to.index)
		if target_view != null:
			target_pos = target_view.global_position
	var dir := (target_pos - home).normalized()
	await _cam_to((home + target_pos) / 2.0 + Vector3(0.0, 2.0, 0.0), ZOOM_DIST, 0.3)
	var tw := create_tween()
	tw.tween_property(mover, "global_position", target_pos - dir * 1.2, 0.2).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_IN)
	await tw.finished
	trauma = minf(trauma + 0.6, 1.0)
	await _hit_stop()
	var back := create_tween()
	back.tween_property(mover, "global_position", home, 0.3).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	await back.finished


# Lebenspunkte: Zahl steigt über dem Duellanten auf, der Ring fährt auf den neuen Stand (duel3d.gd).
func _lp_change(e: Dictionary, sign: String, color: Color, shake: bool) -> void:
	board.popup(e.side, "%s%d" % [sign, int(e.amount)], color)
	lp_changed.emit(e.side, int(e.lp))
	if shake:
		trauma = minf(trauma + 0.3, 1.0)
	await _pause(0.5)


# Bewegung zwischen Zonen: Karte fliegt vom alten zum neuen Platz.
func _move(e: Dictionary) -> void:
	var from_view = board.take(e.from.side, e.from.zone, e.from.index)
	if from_view == null:
		return
	var dest_pos: Vector3 = board.zone_pos(e.to.side, e.to.zone, e.to.index)
	var tw := create_tween()
	tw.tween_property(from_view, "position", dest_pos, 0.3).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	await tw.finished
	from_view.queue_free()
	await _pause(0.05)


func _win(e: Dictionary) -> void:
	await _pause(0.6)


func _cam_to(xf: Transform3D, dur: float) -> void:
	var tw := create_tween()
	tw.tween_property(cam, "transform", xf, dur).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	await tw.finished


func _hit_stop(duration := 0.08, slow := 0.05) -> void:
	_stop_id += 1
	var id := _stop_id
	Engine.time_scale = slow
	await get_tree().create_timer(duration, true, false, true).timeout
	if id == _stop_id:
		Engine.time_scale = 1.0


func _pause(seconds: float) -> void:
	await get_tree().create_timer(seconds).timeout
