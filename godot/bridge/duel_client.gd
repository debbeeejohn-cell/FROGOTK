extends Node
# Spricht mit der Duel-Brücke des FROGOTK-Projekts (dort starten: node --no-warnings scripts/duel-server.mjs).
# Die Brücke kennt alle Regeln. Dieses Skript schickt nur Antworten und meldet den neuen Zustand.
#   state.field.me / .bot   hand, mz[5], st[5], field, gy, banished, extra, deck
#   state.prompt.choices    [{ id, label, card: { side, zone, index, name } }]   (card fehlt bei Phasen-Knöpfen)
#   state.events            [{ type: "summon"|"attack"|"move"|"damage"|... }]    Futter für den Director
#   state.review            Rückmeldung des Lehrers nach dem eigenen Zug
signal state_changed(state: Dictionary)
signal failed(message: String)

const OFFLINE := "Brücke nicht erreichbar. Im FROGOTK-Ordner starten: node --no-warnings scripts/duel-server.mjs"

@export var base_url := "http://127.0.0.1:8131"
var busy := false
var _http: HTTPRequest


func _ready() -> void:
	_http = HTTPRequest.new()
	add_child(_http)


func new_duel(deck: String, opp: String, hand: Array = [], first := true, bot := "aktiv") -> void:
	_post("/new", {"deck": deck, "opp": opp, "hand": hand, "first": first, "bot": bot})


func choose(id: int) -> void:
	_post("/answer", {"choice": id})


func pick(ids: Array) -> void:
	_post("/answer", {"pick": ids})


func undo() -> void:
	_post("/undo", {})


# Eine Anfrage zur Zeit: Die Engine erwartet genau eine Antwort pro Frage.
func _post(path: String, body: Dictionary) -> void:
	if busy:
		return
	busy = true
	var err := _http.request(base_url + path, ["Content-Type: application/json"], HTTPClient.METHOD_POST, JSON.stringify(body))
	if err != OK:
		busy = false
		failed.emit(OFFLINE)
		return
	var res: Array = await _http.request_completed
	busy = false
	var data = JSON.parse_string((res[3] as PackedByteArray).get_string_from_utf8())
	if res[0] != HTTPRequest.RESULT_SUCCESS or typeof(data) != TYPE_DICTIONARY:
		failed.emit(OFFLINE)
	elif not data.get("ok", false):
		failed.emit(str(data.get("error", "Fehler")))
	else:
		state_changed.emit(data)
