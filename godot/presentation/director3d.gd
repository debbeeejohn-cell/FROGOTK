extends Node3D
# 3D-Darstellung "Duell auf der Straße": Karten liegen groß auf der Fahrbahn, Monster stehen darauf.
# Nur eigene Platzhalter-Formen, keine fremden Grafiken. Gleiche Schnittstelle wie director.gd.
# ponytail: Monster sind Kapseln; durch eigene Modelle (.glb) ersetzen, wenn Grafik ansteht.
signal lp_changed(p: int, lp: int)
signal phase_changed(p: int, phase: String, turn: int)
signal won(p: int)

const CARD := Vector3(1.7, 0.04, 2.4)
const LOOK := Vector3(0, 0, 1.8)          # Blickpunkt: nach vorn verschoben, unten ist Platz für die Bedienung
const CAM_DIST := 9.5
const ZOOM_DIST := 5.5
const COLORS := [Color(0.3, 0.55, 1.0), Color(1.0, 0.35, 0.3)]
const BACK := Color(0.35, 0.2, 0.12)      # Kartenrücken (verdeckt)

@export var shake_enabled := true   # Barrierefreiheit: Shake abschaltbar

var cam: Camera3D
var nodes := {}   # uid -> Node3D (Karte; Kinder "Face", "Text", "M" = Monster)
var trauma := 0.0
var _view := Vector3.ZERO
var _t := 0.0
var _stop_id := 0


func _ready() -> void:
	var we := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.04, 0.06, 0.15)   # Nachthimmel
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.35, 0.4, 0.6)
	env.glow_enabled = true                          # lässt leuchtende Karten "holo" wirken
	we.environment = env
	add_child(we)
	var moon := DirectionalLight3D.new()
	moon.rotation_degrees = Vector3(-55, 30, 0)
	moon.light_color = Color(0.7, 0.75, 1.0)
	moon.shadow_enabled = true
	add_child(moon)
	# Straße: Fahrbahn, gelbe Doppellinie, weiße Striche, Gehwege
	_box(Vector3(40, 0.1, 16), Vector3(0, -0.05, 0), Color(0.12, 0.12, 0.14))
	for z in [-0.12, 0.12]:
		_box(Vector3(40, 0.02, 0.07), Vector3(0, 0.01, z), Color(0.95, 0.75, 0.1))
	for i in 10:
		for z in [-5.0, 5.0]:
			_box(Vector3(1.2, 0.02, 0.12), Vector3(-18 + i * 4, 0.01, z), Color(0.85, 0.85, 0.85))
	for z in [-9.0, 9.0]:
		_box(Vector3(40, 0.3, 2), Vector3(0, 0.1, z), Color(0.45, 0.45, 0.48))
	# Duellanten (Platzhalter)
	for p in 2:
		var d := _mesh(CapsuleMesh.new(), Color(0.3, 0.3, 0.38))
		d.position = Vector3(-6.0, 1.0, 6.0 if p == 0 else -6.0)
		add_child(d)
	cam = Camera3D.new()
	add_child(cam)
	_view = Vector3(0, 9.5, 8.5).normalized()
	cam.position = LOOK + _view * CAM_DIST
	cam.look_at(LOOK)


func slot_pos(p: int, slot: int) -> Vector3:
	return Vector3((slot - 2) * 2.1, 0, 2.0 if p == 0 else -2.0)


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
	await _cam_to(LOOK, CAM_DIST, 0.4)


# --- Feedback: Trauma-Shake (nur Kamera-Offset) und Hit-Stop (Echtzeit-Timer) ---
func _process(dt: float) -> void:
	trauma = maxf(trauma - 1.5 * dt, 0.0)
	_t += dt * 30.0
	var s := trauma * trauma if shake_enabled else 0.0
	cam.h_offset = sin(_t * 1.7) * 0.35 * s
	cam.v_offset = sin(_t * 2.3) * 0.35 * s


func _exit_tree() -> void:
	Engine.time_scale = 1.0   # Hit-Stop darf nie hängen bleiben


func hit_stop(duration := 0.08, slow := 0.05) -> void:
	_stop_id += 1
	var id := _stop_id
	Engine.time_scale = slow
	await get_tree().create_timer(duration, true, false, true).timeout
	if id == _stop_id:
		Engine.time_scale = 1.0


# Kamera fährt parallel zur Blickrichtung, dist kleiner = näher dran.
func _cam_to(focus: Vector3, dist: float, dur: float) -> void:
	var tw := create_tween()
	tw.tween_property(cam, "position", focus + _view * dist, dur).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	await tw.finished


# --- Ereignisse ---
func _summon(e: Dictionary) -> void:
	var c := Node3D.new()
	add_child(c)
	c.position = slot_pos(e.p, e.slot)
	c.rotation_degrees.y = 90.0 if e.pos == "def" else 0.0
	var b := BoxMesh.new()
	b.size = CARD
	var face := _mesh(b, COLORS[e.p] if e.up else BACK)
	face.name = "Face"
	var m := face.material_override as StandardMaterial3D
	m.emission_enabled = true
	m.emission = COLORS[e.p]
	m.emission_energy_multiplier = 0.0
	c.add_child(face)
	var l := Label3D.new()
	l.name = "Text"
	l.rotation_degrees.x = -90.0   # liegt flach auf der Karte
	l.position.y = 0.03
	l.font_size = 64
	l.pixel_size = 0.009
	l.shaded = false
	l.text = ("%s\n%d" % [e.name, e.atk]) if e.up else ""   # verdeckt: nichts verraten
	c.add_child(l)
	nodes[e.uid] = c
	var tw := create_tween()   # Holo-Aufblitzen beim Ausspielen
	tw.tween_property(m, "emission_energy_multiplier", 3.0, 0.12)
	tw.tween_property(m, "emission_energy_multiplier", 0.3, 0.3)
	trauma = minf(trauma + 0.15, 1.0)
	await tw.finished
	if e.up:
		await _rise(c, COLORS[e.p], e.atk)


# Monster wächst aus der Karte (Squash & Stretch über TRANS_BACK).
func _rise(c: Node3D, col: Color, atk: int) -> void:
	var h := 0.8 + atk / 1500.0
	var mesh := CapsuleMesh.new()
	mesh.radius = 0.45
	mesh.height = h
	var mo := _mesh(mesh, col.lightened(0.3))
	mo.name = "M"
	mo.position.y = h / 2.0
	mo.scale = Vector3.ONE * 0.01
	c.add_child(mo)
	var tw := create_tween()
	tw.tween_property(mo, "scale", Vector3.ONE, 0.4).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	await tw.finished


func _flip(e: Dictionary) -> void:
	var c: Node3D = nodes.get(e.uid)
	if c == null:
		return
	var m := (c.get_node("Face") as MeshInstance3D).material_override as StandardMaterial3D
	m.albedo_color = m.emission
	(c.get_node("Text") as Label3D).text = "%s\n%d" % [e.name, e.atk]
	_flash(c)
	await _rise(c, m.emission, e.atk)


func _position(e: Dictionary) -> void:
	var c: Node3D = nodes.get(e.uid)
	if c == null:
		return
	var tw := create_tween()
	tw.tween_property(c, "rotation_degrees:y", 90.0 if e.pos == "def" else 0.0, 0.25)
	await tw.finished


func _attack(e: Dictionary) -> void:
	var c: Node3D = nodes.get(e.uid)
	if c == null:
		return
	var mo: Node3D = c.get_node_or_null("M")
	if mo == null:
		mo = c
	var home := mo.global_position
	var ground := slot_pos(e.tp, e.tslot) if e.tslot >= 0 else Vector3(0, 0, -4.2 if e.tp == 1 else 4.2)
	var target := ground + Vector3(0, home.y, 0)
	var dir := (target - home).normalized()
	await _cam_to((home + target) / 2.0, ZOOM_DIST, 0.3)
	var tw := create_tween()
	tw.tween_property(mo, "global_position", target - dir * 1.2, 0.2).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_IN)
	await tw.finished
	trauma = minf(trauma + 0.6, 1.0)
	hit_stop()
	var victim: Node3D = nodes.get(e.tuid)
	if victim:
		_flash(victim)
	var back := create_tween()
	back.tween_property(mo, "global_position", home, 0.3).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	await back.finished


func _destroy(e: Dictionary) -> void:
	var c: Node3D = nodes.get(e.uid)
	if c == null:
		return
	nodes.erase(e.uid)
	_flash(c)
	var tw := create_tween()
	tw.tween_property(c, "scale", Vector3.ONE * 0.01, 0.3).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_IN)
	await tw.finished
	c.queue_free()


# Treffer-Blitz: Karte leuchtet kurz hell auf.
func _flash(c: Node3D) -> void:
	var m := (c.get_node("Face") as MeshInstance3D).material_override as StandardMaterial3D
	m.emission_energy_multiplier = 5.0
	create_tween().tween_property(m, "emission_energy_multiplier", 0.3, 0.3)


# --- Bausteine ---
func _mesh(mesh: Mesh, col: Color) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	mi.material_override = m
	return mi


func _box(size: Vector3, pos: Vector3, col: Color) -> void:
	var b := BoxMesh.new()
	b.size = size
	var mi := _mesh(b, col)
	mi.position = pos
	add_child(mi)
