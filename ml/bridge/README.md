# Playing real Polytopia: the bridge contract

The model is trained in a simulator, but it never talks to the simulator directly. Every turn it reads a prompt
rendered from a **PolyState** (JSON of what the player knows) and answers with action tuples that become
**PolyCommands** (JSON) for the game to execute. Any program that can produce PolyState and execute PolyCommands
can host the model, and the prompt it sees is byte-for-byte the format it trained on: rendering goes through the
same code (`ml/sim/observe.js: render`). The test `ml/tests/test_sim_bridge.py` checks both properties.

```
 real Polytopia client ──PolyState JSON──▶ render ──prompt──▶ model ──tuples──▶ compile ──PolyCommand JSON──▶ client
        ▲                                                                                              │
        └──────────────────────────────────── executes, then end_turn ◀────────────────────────────────┘
```

`ml/polyrl/bridge.py` implements the loop (`Agent`) and two bridges: `SimBridge` (the simulator, for tests and
demos) and `HttpBridge` (a small HTTP service next to the real game):

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/status` | | `{"over": bool, "my_turn": bool}` |
| GET | `/state` | | PolyState for the model's tribe, at the start of its turn |
| POST | `/command` | PolyCommand | `{"ok": bool, "err": string or null}` |
| POST | `/end_turn` | `{}` | `{}` |

```bash
PYTHONPATH=ml python -m polyrl.bridge --model runs/rl-qwen3.5-4b/merged --http http://127.0.0.1:8765
```

## What the game side has to provide

The service runs next to the game and reads and drives it. A natural home is a game mod (for example a plugin for
PolyMod, the community mod loader for The Battle of Polytopia): game state is available in memory and actions can
be issued the way the UI issues them. That plugin is not part of this repository. Its job is only
the translation below, and every rule check stays in the game: a PolyCommand the game rejects is answered with
`ok: false`, and the agent moves on to the next one, exactly as in training.

### PolyState

Everything is from the point of view of the model's tribe, after fog of war. Coordinates are `(x, y)` on the square
grid the game uses internally (x = column, y = row, 0-based). The map's diamond look on screen is only how
it's drawn.

```jsonc
{
  "version": 1,
  "rules": "polytopia",           // ruleset the model was trained on
  "turn": 4, "turn_limit": 20,     // turn_limit: null outside score ("Perfection") games
  "mode": "score",                 // "score" (play to the turn limit) or "domination"
  "map_type": "lakes", "width": 11, "height": 11, "players": 2, "events": false,
  "me": {
    "id": 0, "tribe": "Ai-Mo", "stars": 2, "income": 2,
    "power": null, "power_cost": null,   // tribe powers do not exist in Polytopia
    "score": 760, "rank": 2, "alive_players": 2, "kills": 0, "losses": 0, "embassy": false,
    "techs": ["organization", "meditation"],
    "score_parts": {"cities": 105, "land": 180, "tech": 300, "army": 20, "explore": 155, "temples": 0, "parks": 0}
  },
  "rivals": [{"id": 1, "tribe": null, "alive": true, "score": 925}],   // tribe stays null until met
  "tiles": [[null, {"terrain": "field", "owner": -1, "resource": null, "improvement": null, "road": false, "ruin": false}, ...], ...],
                                   // tiles[y][x]; null = unexplored. terrain: ocean | shallow | field | forest | mountain
                                   // resource (not yet used): fruit crop game fish ore whale; improvement: farm mine lumber port
                                   // windmill forge sawmill customs temple forest_temple mountain_temple water_temple; owner = player id or -1
  "cities": [
    {"id": 0, "x": 7, "y": 2, "owner": 0, "capital": true, "level": 1, "pop": 1, "units": 2, "unit_cap": 2,
     "radius": 1, "walls": false, "workshop": 0, "parks": 0, "trade": 0, "pending": []},   // own city: full detail
    {"id": 3, "x": 4, "y": 1, "owner": -1, "capital": false, "level": 1, "walls": false}  // village or rival city
  ],
  "units": [
    {"id": 1, "type": "warrior", "owner": 0, "x": 4, "y": 1, "hp": 10, "max_hp": 10, "naval": null, "veteran": false,
     "home": 0, "kills": 0, "frozen": false, "slow": false}       // home/kills/frozen/slow only for own units
  ],
  "storm": null,
  "history": [{"turn": 3, "pid": 0, "actions": [["warrior#1", "move", [4, 1]], ["tribe", "build", "fruit", [6, 1]]]}],
                                   // optional; null = the agent fills in the model's own past actions itself.
                                   // Rival entries (pid != me) are actions the player saw happen on explored tiles.
  "goal": null                     // optional; null = the agent asks for rank 1 and a strong score for this game size
}
```

`id`s only need to be stable for the length of a game: unit ids, and city ids that stay the same when a
city changes hands. `units` lists own units and visible rival units. `pending` lists the levels of city upgrades
whose reward has not been picked yet. `trade` is the extra star production from customs houses.

### PolyCommand

The model's tuples compile to one JSON object each, in order. A turn always ends with `end_turn`:

| Tuple | PolyCommand | In the game |
| --- | --- | --- |
| `("giant#12", "move", (5, 7))` | `{"type": "move", "unit": 12, "unit_type": "giant", "to": [5, 7]}` | select unit, tap a tile |
| `("archer#4", "attack", (6, 7))` | `{"type": "attack", "unit": 4, "unit_type": "archer", "target": [6, 7]}` | attack the unit on that tile |
| `("mindbender#9", "convert", (6, 7))` | `{"type": "convert", ...}` | Mind Bender converts the unit on that tile |
| `("rider#2", "capture")` | `{"type": "capture", "unit": 2, "unit_type": "rider"}` | capture the city / village under the unit |
| `("rider#2", "examine")` | `{"type": "examine", ...}` | examine the ruins under the unit |
| `("warrior#3", "recover")` / `heal` / `disband` | `recover` / `heal_others` / `disband` | unit actions |
| `("warrior#3", "upgrade", "ship")` | `{"type": "upgrade", ..., "to": "ship"}` | upgrade the unit's boat |
| `("city#0", "train", "rider")` | `{"type": "train", "city": 0, "unit_type": "rider"}` | train in that city |
| `("city#0", "reward", "workshop")` | `{"type": "city_reward", "city": 0, "reward": "workshop"}` | pick the city's level-up reward |
| `("tribe", "build", "forge", (4, 6))` | `{"type": "build", "building": "forge", "at": [4, 6]}` | build / harvest / terrain action on a tile |
| `("tribe", "research", "free_spirit")` | `{"type": "research", "tech": "free_spirit"}` | research |
| `("tribe", "end_turn")` | `{"type": "end_turn"}` | end turn |

`build` covers every tile action: harvests (`fruit`, `hunt`, `fish`, `whale`), buildings (`farm`, `mine`, `lumber`,
`port`, `windmill`, `forge`, `sawmill`, `customs`, `temple`, `forest_temple`, `mountain_temple`, `water_temple`),
`road`, and terrain changes (`clear`, `burn`, `grow`, `destroy`). Rewards: `workshop`, `explorer`, `walls`,
`resources`, `growth`, `borders`, `park`, `giant`. The full vocabulary is in `ml/data/sft/action_spec.json`
(written by the data generator) or `python -c "from polyrl.sim import SimClient; print(SimClient().spec())"`.

One game action is left to the bridge because it is always right and needs no decision: promote a unit to veteran
as soon as it can be promoted (the simulator promotes automatically, so the model never learned to ask).

## Matching the version you play

The simulator's Polytopia rules (`ml/sim/rulesets/polytopia.js`) follow the classic game as encoded by the
open-source research re-implementation [Tribes](https://github.com/GAIGResearch/Tribes): 12 tribes, 24 techs, the
classic units, windmill/forge/sawmill/customs adjacency, temples, ruins, city rewards and the score formula. The
live game has added tribes, units and techs since then (e.g. Cymanti, Cloaks and Diplomacy, the naval rework). To
target a newer patch:

1. Update the tables in `ml/sim/rulesets/polytopia.js` (every number is there; lines marked "verify" are where
   sources disagree), add new units/buildings to `UNITS`/`BUILD`, and new verbs to `actions.js` if the patch adds a
   new kind of action.
2. Regenerate the SFT set (`gen_sft.js`) and continue SFT from the current model for a short run, then RL.
3. Keep the PolyState/PolyCommand fields; only the vocabularies grow.

Rules the model never saw in training cost it nothing worse than rejected commands: the game refuses them, the
agent goes on, and the next turn's state shows what actually happened. Continued RL against the real game through
the bridge (rewarding score, as in `rewards.py`) is the way to close any remaining gap.
