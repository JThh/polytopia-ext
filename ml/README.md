# A decision model for The Battle of Polytopia

A language model that reads a Polytopia game state and answers with the turn's actions as typed tuples, nothing else:

```
[("defender#7", "attack", (8, 5)),
 ("giant#4", "move", (9, 2)),
 ("city#8", "train", "warrior"),
 ("tribe", "build", "hunt", (5, 3)),
 ("tribe", "end_turn")]
```

It starts from an open model that fits one A100 40GB (Qwen3.5-4B by default, Gemma 4 E4B as an alternative) and is
trained in two stages:

1. **SFT** on a compact set of bot-vs-bot turns, so it learns the output format and the rules from examples.
2. **Simulation-based online RL** against the built-in bots. It is rewarded turn by turn for score, stars and
   cities, and at the end for the final score and result.

Like a decision transformer, every prompt carries a goal (final rank and final score). Training data is labelled
with the outcome each trajectory actually reached, and at play time the model is asked for rank 1 and a strong
score. The rules are never written into the prompt: the model learns them from data, and from the game rejecting
illegal actions during RL.

The simulator follows **The Battle of Polytopia** rules (`sim/rulesets/polytopia.js`), not the browser game's
variant, and the model talks to any game through a JSON bridge. The same prompts and actions work with a real
Polytopia client: see [bridge/README.md](bridge/README.md).

> Status: everything here runs and is tested end to end on CPU with a tiny random-weight Qwen3.5-architecture
> model (`tests/test_train_smoke.py`). The real 4B training runs on your GPU. No trained weights are included.

## Quick start

```bash
# Node 18+ and Python 3.10+
pip install -e "ml[qwen35,dev]"             # add ,vllm for faster RL rollouts
bash ml/scripts/pipeline.sh                  # data -> SFT -> eval -> RL -> eval
```

Or one stage at a time (from the repository root, `PYTHONPATH=ml`):

```bash
node ml/sim/gen_sft.js --games 3000 --keep 0.25 --workers 8 --out ml/data/sft   # ~3 min on 4 cores
python -m polyrl.sft --config ml/configs/sft.yaml
python -m polyrl.rl --config ml/configs/rl.yaml
python -m polyrl.evaluate --config ml/configs/eval.yaml
python -m polyrl.bridge --model runs/rl-qwen3.5-4b/merged --http http://127.0.0.1:8765   # real game
```

Every config value can be overridden on the command line: `python -m polyrl.rl --config ml/configs/rl.yaml lr=5e-6 gen.backend=vllm`.

## How it fits together

```
 ml/sim (Node)                                               ml/polyrl (Python)
 ┌───────────────────────────────────────────────┐          ┌─────────────────────────────────────┐
 │ src/engine.js + src/ai.js  (game rules, bots)  │          │ sft.py       stage 1                │
 │ rulesets/polytopia.js   Polytopia rules        │  JSON    │ rl.py        stage 2 (GRPO-style)   │
 │ actions.js   tuple <-> engine call / command   │◀────────▶│ evaluate.py  vs bots, paired        │
 │ observe.js   state -> PolyState -> prompt      │  lines   │ bridge.py    real game via bridge   │
 │ history.js   who saw which action (fog)        │          │ modeling.py  model, LoRA, log-probs │
 │ session.js   games, branch evaluation          │          │ generation.py  HF / vLLM sampling   │
 │ server.js    RPC for Python                    │          │ rewards.py   turn + final rewards   │
 │ gen_sft.js   dataset generator                 │          │ sim.py       simulator client       │
 └───────────────────────────────────────────────┘          └─────────────────────────────────────┘
```

All game logic stays in the JavaScript engine, the single source of truth. Python only handles tokens and
gradients. The simulator is fast: a 4-player, 30-turn bot game takes about 0.3 s, and a game state copies in under
1 ms. That makes counterfactual branch evaluation in RL cheap.

## The action space

An action is `(actor, verb, *args)`. Actors are one of my units (`"<type>#<id>"`, e.g. `"giant#12"`), one of my
cities (`"city#<id>"`), or `"tribe"`. Positions are `(x, y)`, with x the column and y the row. A turn is a list
executed in order and closed by `("tribe", "end_turn")`. The verbs cover every action the game has (each engine
action maps to exactly one), and nothing else:

| Verb | Actor | Args | Meaning |
| --- | --- | --- | --- |
| `move` | unit | `(x, y)` | move to a reachable empty tile |
| `attack` | unit | `(x, y)` | attack the enemy unit on that tile |
| `convert` | unit | `(x, y)` | Mind Bender takes the enemy unit on that tile |
| `capture` | unit | | capture / found the city or village under the unit |
| `examine` | unit | | examine the ruins under the unit |
| `recover` | unit | | heal instead of acting |
| `heal` | unit | | heal adjacent allies (Mind Bender) |
| `disband` | unit | | remove the unit (needs Free Spirit) |
| `upgrade` | unit | `ship` / `battleship` | upgrade the unit's boat |
| `train` | city | unit type | train a unit |
| `reward` | city | reward | pick the level-up reward (`workshop`, `explorer`, `walls`, `resources`, `growth`, `borders`, `park`, `giant`) |
| `build` | tribe | kind, `(x, y)` | harvest, build, road or terrain action on a tile (15 building kinds + `road`, `clear`, `burn`, `grow`, `destroy`) |
| `research` | tribe | tech | research one of the 24 techs |
| `end_turn` | tribe | | always last |

(The browser game's ruleset, `POLY_RULES=tessera`, has extra verbs for its own features: `power`, `walls`,
`embassy`, `infiltrate`.) The format is checked by a strict parser. The game's own rules are checked by the engine:
an illegal tuple is skipped and reported (`illegal`, `no_unit`, `not_owner`, `wrong_unit_type`, `no_target`, ...),
so the model can only ever do legal things. `ml/test/codec.js` replays bot games on every map type entirely through
text → parse → execute and checks that the state ends up identical, so the format loses nothing.

## The observation

What the player knows at the start of its turn, after fog of war. These are the sections the model reads (a
real sample from the dataset, shortened):

```
<polytopia v1>
goal: final_rank=1 final_score=11020 score_to_go=9025
game: rules=polytopia turn=11 mode=domination map=pangaea size=14x14 players=2 events=off
me: P1 tribe=Quetzali stars=6 income=5 score=1995 rank=2/2 kills=1 losses=0
score_parts: cities=320 land=540 tech=500 army=100 explore=535 temples=0 parks=0
techs: hunting organization riding shields
rivals: P0 Oumaji score=2045
board: rows y=0..13, runs x0-x1 + terrain (w deep water, s shallow, p field, f forest, m mountain, ? unexplored) + owner
y2: 0w 1-2s 3s1 4p1 5f1 6-8p 9p0 10-13?
y3: 0w 1s 2f 3-5f1 6p1 7m1 8p1 9p0 10-13?
...
resources: fish (5,1) (6,1) (3,2) | crop (8,2) (9,3) | game (5,3) (2,6) | ore (7,3) (6,8)
ruins: (6,9)
my cities:
 city#1 (2,5) capital level=2 pop=1/3 units=3/3 radius=1
other cities:
 city#0 (9,8) P0 capital level=2
my units:
 giant#4 (8,3) hp=40/40 kills=1
 defender#7 (7,4) hp=15/15 home=city#1
enemy units:
 P0 rider#10 (8,5) hp=10/10
history:
 me turn 10: [("giant#4", "attack", (8, 3)), ("city#8", "train", "warrior"), ("tribe", "research", "hunting")]
 P0 turn 11: [("warrior#11", "move", (8, 8)), ("rider#10", "move", (8, 5)), ("tribe", "build", "hunt", (8, 8))]
actions:
```

- **Board**: one line per row, run-length encoded with explicit x ranges (`3-5f1` = x 3 to 5 are forest in P1's
  territory), so the model never has to count characters to find a coordinate.
- **Partial information**: `?` is unexplored, rival tribes are `?` until met (the in-game scoreboard is public),
  and stealthy units stay hidden.
- **History**: the model's own last two turns, plus every rival action it could see since then. An action counts as
  seen if it happened on tiles the player had explored, or was aimed at it.
- **Size**: about 1,700 tokens on average (95th percentile 3,500), up to about 7,000 on 20×20 maps late in the game.

The prompt is rendered from a **PolyState** JSON (`observe.js: snapshot -> render`). The bridge hands the same JSON
from a real game to the same renderer, so the model sees identical text either way.

## Rules: Polytopia, not the browser game

`src/` is Tessera Tribes, a Polytopia-like browser game whose engine and bots this project reuses. The model is
meant to play Polytopia, so `sim/rulesets/polytopia.js` patches the engine to Polytopia's rules. Its reference is the
classic game as encoded by the open-source research re-implementation [Tribes](https://github.com/GAIGResearch/Tribes)
(`TribesConfig.java`, `Types.java`):

| | Tessera Tribes (`src/`) | Simulator under `POLY_RULES=polytopia` (default) |
| --- | --- | --- |
| Tribes | 6 own tribes with passives and powers | Xin-xi, Imperius, Bardur, Oumaji, Kickoo, Hoodrick, Luxidoor, Vengir, Zebasi, Ai-Mo, Quetzali, Yadakk with their start tech and start unit, 5 stars, no powers |
| Techs | 25, incl. Ballooning, Diplomacy | Polytopia's 24 (Free Spirit, Shields, Whaling, ...), cost 4 + tier × cities, Philosophy discount |
| Units | + Shaman, Balloon, Cloak; shove/stomp/charge/splash | Warrior, Rider, Archer, Defender, Swordsman, Mind Bender, Knight, Catapult, Giant, boats; Polytopia skills |
| Buildings | market, embassy, walls for sale | farm, mine, lumber hut, port, windmill / forge / sawmill / customs house adjacency, four temples, burn forest, destroy |
| Ruins | taken by stepping on them | `examine` action: giant, tech, population, explorer or stars |
| Score | own formula | cities 100 + 5 per population, territory 20/tile, tech 100 × tier, units by type, exploration 5/tile, temples, parks |
| Other | storms, resource blooms | none |

Combat (attack and defence force, × 4.5 damage), movement, zones of control, city growth and level-up rewards were
already Polytopia's. Unchanged from the engine, they apply under both rulesets. `ml/test/rules.js` checks
setup, ruins, adjacency, invariants over 30 bot games, and that bots actually use the Polytopia economy.
Approximations and version notes are in the ruleset file (marked "verify") and in
[bridge/README.md](bridge/README.md#matching-the-version-you-play). The live game has added content since the classic
version: update the tables there and regenerate the data to match the patch you play.

## Stage 0: the SFT dataset

`sim/gen_sft.js` plays bots against each other in random setups, covering every map type (drylands, lakes,
continents, pangea, archipelago, water world), every size up to 20×20, 2–6 tribes, all 12 tribes, score and
domination modes, turn limits from 20 to 40, and easy to crazy bots per seat. Each seat's turn is one sample:
prompt = that seat's observation, completion = its actions that turn.

- **Hindsight goal labels.** After the game, each prompt gets a goal line with the final rank and score its seat
  actually reached.
- **Quality filter.** Samples are kept with a probability that favours strong play: hard and crazy bots at 1.0,
  normal at 0.6, easy at 0.3, times 1.0 for the winner, 0.6 or 0.35 for others by rank, and 0.15 for eliminated
  seats. Turns where nothing happened are kept at 0.3×. Weaker trajectories stay in at low rates because their goal
  lines show the model what low returns look like.
- **Splits.** Validation games are held out by game, not by turn.

The default set (`--games 3000 --keep 0.25`, seed 1, about 3 minutes on 4 cores):

| | |
| --- | --- |
| games / seat-turns played | 3,000 / 312,791 |
| samples (train / val) | 37,794 / 1,011 |
| from the eventual winner | 55% |
| from hard or crazy bots | 82% |
| avg prompt / answer | 3,132 / 302 characters (≈1,700 / 160 tokens), 9 actions per turn; 0.3% exceed 6,144 tokens and are dropped |
| actions | 167k move, 47k build, 28k train, 25k attack, 18k research, 16k reward, 5k capture, 3k recover, 2.4k upgrade, 1.3k examine, 229 heal, 187 convert |
| coverage | all 12 tribes and 6 map types evenly; all 24 techs; 15 building kinds; all 8 trainable units |

`data/sft/stats.json` has the full breakdown. `data/sft/targets.json` holds winners' final-score quantiles per game
setup, which are the goals asked for at play time. `data/sample.jsonl` has 40 samples to look at. The full JSONL is
not committed; it regenerates deterministically.

## Stage 1: SFT

`python -m polyrl.sft --config ml/configs/sft.yaml`

- Plain text, `prompt + action list + EOS`, with loss on the action list only. No chat template by default, so the
  format does not depend on the model family (`data.chat_template: true` to use one). The choice is saved in
  `format.json` next to every checkpoint and picked up by later stages.
- LoRA r=64 on every linear layer of the language model, including Qwen3.5's linear-attention projections; the
  vision tower and LM head stay frozen. Multimodal checkpoints (Qwen3.5, Gemma 4) load text-only.
- Batches are packed by token budget with length-sorted windows, the loss is normalised per token across gradient
  accumulation, and logits are computed only for the answer span. Prompts are long and the vocabulary is about 250k,
  so that saves most of the memory.
- Evaluation reports validation loss, plus greedy answers on validation states: parse rate, end_turn rate, and
  overlap with the bot's actions.
- Output: `adapter/`, and `merged/` (base with LoRA folded in), which is what RL starts from.

On one A100 40GB, one epoch over the default set is about 71M tokens, roughly 4–7 hours for Qwen3.5-4B with
`flash-linear-attention` and `causal-conv1d` installed. Without those kernels transformers falls back to slow
PyTorch code for the linear-attention layers.

## Stage 2: simulation-based RL

`python -m polyrl.rl --config ml/configs/rl.yaml`

Each iteration sets up one game (map, tribes, seat, bot difficulties from the curriculum) and plays `trunks`
copies of it:

1. **Branching at every model turn.** The policy samples `group_size` action lists for the same state. Each one is
   played on its own copy of the game: apply it, let every rival reply, and optionally let the bot continue for us
   for `horizon` turns. All copies use the same random seed for the bots, so differences come from the plan.
2. **Turn reward** (`rewards.py`): the change in my score, my lead over the best rival, my income and my city count,
   minus penalties for unparseable or cut-off answers, each rejected action, a missing `end_turn`, and elimination.
3. **The trunk** plays the group's best list (ε = 0.15 random), so the rollout reaches good states. Long games are
   still on-policy samples from the model.
4. **Game reward** at the end: final score, win and rank. It is normalised across the trunks and added to the
   lists each trunk actually played, which carries the game outcome back to the turns that led to it.
5. **Update.** GRPO-style group-relative advantages with a PPO clipped objective. Clipping is asymmetric
   (0.2 / 0.28), the loss is normalised per token, and a KL penalty (k3) keeps the policy near the SFT model. The
   reference is the same network with the RL LoRA switched off, so it costs no extra memory. Groups whose rewards
   are all equal are dropped.
6. **Curriculum**: small maps and weak bots first, then full games against hard and crazy bots.

Options: `teacher_in_group` adds the bot's own plan to each group as an off-policy candidate (useful early, or
for a weak SFT model); `branch_prob < 1` saves compute; `gen.backend: vllm` gives much faster rollouts (the adapter
is saved and hot-loaded each iteration); `ppo_epochs > 1` stores old log-probs for real PPO ratios. Logged per
iteration: parse / valid-action / end_turn rates, turn reward and its parts, final score, win rate and rank, KL,
clip fraction, and timing. `rollouts.jsonl` keeps example plans.

Cost, roughly, on one A100 with HF generation: 2 trunks × 6 samples × 20–40 turns is 250–500 samples, about 10
minutes per iteration. vLLM roughly halves that. 300 iterations is about 1–2 days. Shorter games early in the
curriculum make the first stages much cheaper.

## Evaluation

`python -m polyrl.evaluate --config ml/configs/eval.yaml` plays N games with the model in one seat and bots in the
others. It then replays the same games (same seed and seat) with the hard bot in the model's seat as a paired
baseline. It reports win rate, final rank and score, survival, parse / valid-action / end_turn rates, and the paired
score ratio. A model that beats this baseline plays better than the bot it learned from.

## Playing real Polytopia

[bridge/README.md](bridge/README.md) defines the contract a game-side bridge implements: PolyState in, PolyCommand
out, four HTTP endpoints. `polyrl.bridge.Agent` runs the loop (render → generate → compile → execute → end turn)
and keeps the model's own action history if the game does not report one. `ml/tests/test_sim_bridge.py` checks
that a prompt rendered from bridge JSON is byte-identical to the training prompt, and that a full game played only
through PolyCommands has every command accepted.

## Files

| Path | |
| --- | --- |
| `sim/tt.js` | loads engine + bot, picks the ruleset (`POLY_RULES`), seedable bot randomness, action listeners |
| `sim/rulesets/polytopia.js` | Polytopia rules: tribes, techs, units, buildings, ruins, score |
| `sim/actions.js` | action space: tuple ↔ engine call ↔ PolyCommand, strict parser |
| `sim/observe.js` | snapshot (state → PolyState) and render (PolyState → prompt) |
| `sim/history.js` | action log with per-player visibility |
| `sim/session.js` | a game with model and bot seats; plan execution; branch evaluation |
| `sim/server.js` | JSON-lines RPC for Python |
| `sim/gen_sft.js`, `configs.js`, `targets.js` | dataset generator, game setups, goal targets |
| `polyrl/` | `sft.py`, `rl.py`, `evaluate.py`, `bridge.py`, `modeling.py`, `generation.py`, `rewards.py`, `formatting.py`, `sim.py`, `config.py` |
| `configs/` | A100 recipes: `sft.yaml`, `sft_gemma4.yaml`, `rl.yaml`, `eval.yaml` |
| `scripts/` | `pipeline.sh`, `make_tiny_model.py` (tiny random model for CPU tests) |
| `test/` (Node), `tests/` (pytest) | see below |

## Tests

```bash
npm run test:ml                         # codec round trip (both rulesets), Polytopia rules + invariants, server protocol
cd ml && python -m pytest               # simulator client, rewards, parsing, bridge, and the CPU training smoke test
```

The smoke test builds a tiny random Qwen3.5 (vision tower included, like the real checkpoint), then runs SFT →
merge → an RL iteration → evaluation. It checks plumbing, not playing strength.

## Limits

- The teacher is the game's built-in bot. It plays a solid game, but SFT can only get the model to its level; beating
  it is RL's job. The paired evaluation measures exactly that.
- The ruleset is the classic game. Newer content (special tribes, the naval rework, Cloaks and Diplomacy) needs
  table updates and new data before the model knows it.
- The model plans a whole turn up front. Ruins and other random outcomes are not known until afterwards; actions
  that become illegal are skipped, and the next turn sees the result.
- Coordinates and ids in PolyState must match the game's. Building that mapping into a game mod is the
  integration work that remains on the game side.
