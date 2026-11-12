extends Node
# Regie: spielt die Ereignisse der Brücke nacheinander ab (Beschwörung, Angriff, Treffer, Zerstörung).
# Jedes Ereignis wird mit await abgespielt; danach gleicht sync() das Feld mit dem Zustand ab.
# Kennt keine Regeln: sie zeigt nur, was die Engine schon entschieden hat.
const Board = preload("res://duel3d/board.gd")
const Banner = preload("res://duel3d/banner.gd")
const SummonShow = preload("res://duel3d/summon_show.gd")

signal finished
signal lp_changed(side: String, lp: int)
signal card_shown(card_name: String)   # eine Karte wurde offen beschworen: die Oberfläche zeigt sie ganz

const ZOOM_DIST := 9.0

var board: Board
var cam: Camera3D
var banner: Banner   # Phasen-Banner in der Mitte (gesetzt von duel3d.gd)
var last_phase := ""  # zuletzt angezeigte Hauptphase; Schlachtschritte und Schaden lösen kein Banner aus
const PHASE_NAMES := {"Draw Phase": "Draw-Phase", "Standby Phase": "Standby-Phase", "Main Phase 1": "Main-Phase 1", "Battle Phase": "Battle-Phase", "Main Phase 2": "Main-Phase 2", "End Phase": "End-Phase"}
const CAM_DIST := 5.2   # Abstand der Kamera zur hochstehenden Karte
var summon_show: SummonShow   # Beschwörungs-Einblendung (gesetzt von duel3d.gd); null oder aus = keine
var summon_show_enabled := true
var trauma := 0.0   # Kamera-Zittern, 0..1
var shake_enabled := true
var speed := 1.0   # Faktor auf Pausen und Flüge: 1 normal, 0,5 schnell, 0 aus (Taste T, siehe duel3d.gd)
var _t := 0.0
var _home: Transform3D
var _stop_id := 0


func setup(b: Board, c: Camera3D) -> void:
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
var _draw_next := 0   # Platz meiner Hand, auf den die nächste gezogene Karte fliegt

# Die Hand steht vom ersten Moment an da. Gezogene Karten sind bis zur Landung ausgeblendet und fliegen in ihren Platz.
func play(events: Array, field: Dictionary) -> void:
	board.sync_hand(field)
	if speed > 0.0:
		var incoming := 0
		for e in events:
			if e.type == "draw" and e.side == "me":
				incoming += int(e.count)
		_draw_next = int(field.me.hand.size()) - incoming
		board.hide_hand_from(_draw_next)
	for e in events:
		await _event(e)
	board.sync(field)
	await _cam_to(_home, 0.4)
	finished.emit()


func _event(e: Dictionary) -> void:
	match e.type:
		"summon": await _summon(e)
		"set": await _set_card(e)
		"attack": await _attack(e)
		"damage": await _lp_change(e, "-", Color(1.0, 0.35, 0.3), true)
		"pay": await _lp_change(e, "-", Color(1.0, 0.6, 0.2), false)
		"heal": await _lp_change(e, "+", Color(0.4, 1.0, 0.5), false)
		"move": await _move(e)
		"chain": await _chain(e)
		"phase": await _phase(e)
		"draw": await _draw_card(e)
		"win": await _win(e)
		_: pass   # turn, phase, negate: nur Zustand, keine Animation nötig


func _summon(e: Dictionary) -> void:
	var view = board.view_at(e.side, e.zone, e.index)
	if view == null:
		view = board.place(e.side, e.zone, e.index, {"name": e.name, "atk": e.atk, "def": e.def, "down": false, "pos": e.pos})
	var facts: Dictionary = board.cards.get(e.name, {})
	if summon_show != null and summon_show_enabled and not e.get("down", false) and facts.get("frame", "") != "token":
		await summon_show.show_monster(e.name, facts, int(e.atk), int(e.def), e.get("pos", "atk") == "def")
	view.flash()
	card_shown.emit(str(e.name))
	trauma = minf(trauma + 0.15, 1.0)
	await _pause(0.35)


func _set_card(e: Dictionary) -> void:
	var view = board.place(e.side, e.zone, e.index, {"name": e.name, "down": true, "pos": "def", "atk": 0, "def": 0})
	view.flash()
	await _pause(0.25)


# Jede aktivierte Karte (Zauber, Falle, Monstereffekt) leuchtet groß in der Bildmitte auf.
# Jede aktivierte Karte: die Kamera fährt zum Ausführenden, die Karte steht hochkant in der Mitte und klappt auf.
# Verdeckte Fallen werden so sichtbar umgedreht. Danach geht die Kamera zurück.
func _chain(e: Dictionary) -> void:
	card_shown.emit(str(e.name))
	var view = board.view_at(e.side, e.zone, e.index)
	if view != null:
		view.flash()
	if speed <= 0.0:
		return
	var kind := _activation(e)
	if kind == "ray":   # Monster auf dem Feld: Strahlen, keine Karte in der Mitte
		await board.rays(board.zone_pos(e.side, "mz", int(e.index)) + Vector3(0.0, 0.5, 0.0), 0.7 * speed)
		return
	var sign := 1.0 if e.side == "me" else -1.0
	var origin: Vector3 = Board.HERO + Vector3(0.0, 0.6, sign * CAM_DIST)
	var near := Transform3D(Basis.looking_at(Board.HERO - origin, Vector3.UP), origin)
	var base := 0.0 if e.side == "me" else PI
	var flips: bool = kind == "flip"
	var hero: Node3D = board.hero_card(str(e.name), str(e.side), flips)
	await _cam_to(near, 0.45 * speed)
	if flips:
		var flip := create_tween()
		flip.tween_property(hero, "rotation:y", base, 0.4 * speed).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		await flip.finished
	if kind == "light":   # Dauerzauber: leuchtet beim Ausspielen, bleibt danach auf dem Feld
		await board.light_card(hero, 3.0, 1.0 * speed)
	else:
		await _pause(0.9)
	hero.queue_free()
	await _cam_to(_home, 0.35 * speed)


# Welche Darstellung eine aktivierte Karte bekommt:
#   ray   Monstereffekt auf dem Feld (Strahlen)
#   flip  Monster aus der Hand, verdeckte Falle oder verdeckter Schnellzauber (umklappen)
#   light Dauerzauber, Feldzauber oder Ausrüstung aus der Hand (leuchten, bleibt liegen)
#   plain alles andere (Karte zeigen)
func _activation(e: Dictionary) -> String:
	var facts: Dictionary = board.cards.get(e.name, {})
	var frame: String = facts.get("frame", "normal")
	var spell := frame == "spell" or frame == "trap"
	var permanent := ["Continuous", "Field", "Equip"].any(func(word: String) -> bool: return word in facts.get("type", ""))
	if e.zone == "mz" and not spell:
		return "ray"
	if e.zone == "hand" and not spell:
		return "flip"
	if e.zone == "hand" and permanent:
		return "light"
	if e.zone == "st" and e.get("down", false):
		return "flip"
	return "plain"


# Phasen-Banner, nur wenn sich die Hauptphase ändert. Die Regie hält kurz an, damit man reagieren kann.
func _phase(e: Dictionary) -> void:
	var text: String = PHASE_NAMES.get(e.phase, "")
	if text == "" or text == last_phase:
		return
	last_phase = text
	if banner != null and speed > 0.0:
		await banner.show_text(text, 0.8 * speed)


# Angriff: Kamera zoomt auf die Paarung, der Angreifer läuft vor, Treffer mit kurzem Hit-Stop.
# to == null ist ein Direktangriff: dann läuft der Angreifer zum Duellanten des Gegners.
func _attack(e: Dictionary) -> void:
	var attacker = board.view_at(e.from.side, e.from.zone, e.from.index)
	if attacker == null:
		return
	var mover: Node3D = attacker.figure()
	var home := mover.global_position
	var foe: String = "bot" if e.from.side == "me" else "me"
	var target_pos: Vector3 = board.duelist_pos(foe)
	if e.to != null:
		var target_view = board.view_at(e.to.side, e.to.zone, e.to.index)
		target_pos = target_view.global_position if target_view != null else board.zone_pos(e.to.side, e.to.zone, e.to.index)
	var dir := (target_pos - home).normalized()
	var focus := (home + target_pos) / 2.0
	var zoom := Transform3D(cam.transform.basis, focus + cam.transform.basis.z * ZOOM_DIST + Vector3(0.0, 2.0, 0.0))
	await _cam_to(zoom, 0.3)
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
const TINT := {"gy": Color(0.45, 0.55, 0.75), "banished": Color(0.65, 0.35, 0.85)}


# Jede Kartenbewegung fliegt in einem Bogen vom alten zum neuen Platz. Eine echte Ansicht (Hand, Feld) wird genommen,
# sonst entsteht eine fliegende Karte mit Bild (oder Rücken, wenn der Name verdeckt ist).
func _move(e: Dictionary) -> void:
	if speed <= 0.0:
		board.take(e.from.side, e.from.zone, e.from.index)
		return
	var start: Vector3 = board.zone_pos(e.from.side, e.from.zone, e.from.index)
	var dest: Vector3 = board.zone_pos(e.to.side, e.to.zone, e.to.index)
	var node: Node3D = board.take(e.from.side, e.from.zone, e.from.index)
	if node == null:
		var card_name: String = e.name if e.name != null else ""
		node = board.flying_card(card_name, start, TINT.get(e.to.zone, Color.BLACK))
		start = node.position
		dest += Vector3(0.0, 0.5, 0.0)
	else:
		start = node.position
	var fly := func(t: float) -> void:
		node.position = start.lerp(dest, t) + Vector3(0.0, sin(t * PI) * 1.6, 0.0)
	var tw := create_tween()
	tw.tween_method(fly, 0.0, 1.0, 0.25 * speed).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN_OUT)
	await tw.finished
	node.queue_free()
	await _pause(0.04)


# Ziehen: je Karte fliegt ein Kartenrücken vom Deck zur Hand. Die Handkarten selbst legt sync() danach aus.
# Ziehen: je Karte fliegt ein Kartenrücken vom Deck genau in ihren Platz in der Hand. Dort erscheint sie bei der Landung.
func _draw_card(e: Dictionary) -> void:
	if speed <= 0.0:
		return
	for i in int(e.count):
		var card: MeshInstance3D = board.card_back(board.zone_pos(e.side, "deck", 0) + Vector3(0.0, 0.6, 0.0))
		var mine: bool = e.side == "me"
		var target: Vector3 = board.zone_pos("me", "hand", _draw_next) if mine else board.hand_center(e.side)
		var tw := create_tween()
		tw.tween_property(card, "position", target, 0.25 * speed).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		await tw.finished
		card.queue_free()
		if mine:
			board.show_hand_slot(_draw_next)
			_draw_next += 1


func _win(_e: Dictionary) -> void:
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
	await get_tree().create_timer(seconds * speed).timeout
