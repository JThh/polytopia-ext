# PolyZero: learning Polytopia by search and self-play

A proposal, with a working implementation, for a second way to master The Battle of Polytopia next to the
language model in [`ml/`](../README.md): a **small network plus Gumbel AlphaZero search**, trained by playing the game
over and over in the simulator. It runs natively on a MacBook Air: the network has about 0.25M parameters,
self-play runs on the CPU cores, and gradient steps can use the Apple-silicon GPU (PyTorch `mps`).

**Rules: the live game.** PolyZero plays The Battle of Polytopia 2.17.3 by default (`POLY_RULES=polytopia_live`,
[`ml/sim/rulesets/POLYTOPIA_LIVE.md`](../sim/rulesets/POLYTOPIA_LIVE.md)). That covers the current tech tree,
rafts with scout/rammer/bomber upgrades, cloaks and infiltration, embassies, markets, bridges, starfish, monuments,
the live score formula and the bots' star bonuses. The classic ruleset (`rules=polytopia`) also works. A network
belongs to the ruleset it was trained on.

**Goal: beat the crazy bot.** Crazy is the strongest built-in bot. It plays the hard bot's algorithm and, under the
live rules, gets 3 stars a turn more than a human player (classic: 2). PolyZero plays as a human and gets no bonus.
"Beating crazy" means doing better than crazy itself from the same seats on the same maps, measured by a paired
evaluation (see [Evaluation](#evaluation)).

> **Status.** Everything below runs and is tested on CPU under both rulesets (Node tests plus pytest, including an
> end-to-end run: bot data, warm start, self-play with a league, evaluation and resume). The numbers in
> [Measured so far](#measured-so-far) come from a 4-core Linux VM in one session, about 3 CPU-hours of training:
> - Classic rules: the first self-play run collapsed. With the fixes in
>   [Stabilising self-play](#stabilising-self-play), 10 iterations took the net from 2 to 10% to 14.6% wins
>   against crazy, level with the hard bot.
> - Live rules: 20 iterations did not improve on the warm start ([Live rules](#live-rules) says why and what
>   changed).
>
> Crazy is not beaten yet: that takes the long training run this document proposes. No trained weights are
> included.

## Quick start

```bash
# Node 18+, Python 3.10+, PyTorch (the macOS arm64 wheel includes the mps backend)
pip install -e "ml/zero[dev]"
bash ml/zero/scripts/pipeline.sh            # bot data -> warm start -> self-play iterations -> evaluation
```

Or step by step, from the repository root:

```bash
node ml/zero/sim/gen_bc.js --games 2000 --workers 6 --keep 0.08 --out runs/zero/bc               # ~1.5 min
PYTHONPATH=ml/zero python -m polyzero.train --config ml/zero/configs/macbook.yaml                  # resumable
PYTHONPATH=ml/zero python -m polyzero.evaluate --config ml/zero/configs/eval.yaml weights=runs/zero/latest.pt
```

Any config value can be overridden on the command line, e.g. `selfplay.search.simulations=32 workers=4`.
`configs/gpu.yaml` is the recipe for a workstation (larger network, larger search, 30 workers).

## Why a second approach

The language model in `ml/` writes a whole turn in one go and learns from bot data and turn-level rewards. It is a
general reader of game states, but it is large (4B parameters), slow to sample, and it cannot plan: each turn is
one guess. Polytopia rewards planning. Which unit attacks first, whether to capture now or kill the defender first,
and when to save stars instead of spending them are all lookahead questions. AlphaZero answers them by
**search + learning**: a network proposes actions and judges positions, a search on the real rules checks the
proposals, and the network is then trained towards what the search found. Each round makes the next search
better.

| | LLM pipeline (`ml/`) | PolyZero (`ml/zero/`) |
| --- | --- | --- |
| model | Qwen3.5-4B + LoRA | 0.25M-parameter conv net (0.57M on the GPU recipe) |
| decision unit | a whole turn as text | one atomic action at a time, end_turn included |
| planning | none at play time | Gumbel AlphaZero search over the turn, 16 to 64 simulations per action |
| learns from | bot turns (SFT), then turn rewards (GRPO) | bot actions (warm start), then its own searches (self-play) |
| hardware | A100 40GB | a MacBook Air, faster with more cores |
| real game | PolyState JSON -> prompt | the same tuples and PolyCommands (see [Real game](#playing-the-real-game)) |

The two can feed each other: PolyZero's searched turns are good training data for the language model, and the
same bridge serves both.

Plain AlphaZero does not fit Polytopia out of the box. Each difficulty below has a design answer:

| Difficulty | Answer |
| --- | --- |
| A turn is 5 to 50 actions, so whole turns are far too many to enumerate | Search over **atomic actions**: one move, attack, build or research per tree edge, end_turn included |
| 2 to 6 players, and rivals move between my turns | The tree covers **my own turn**; the end_turn leaf is an **afterstate** the value net scores, so rivals' replies are folded into the value. Rivals are real opponents during self-play: bots, past selves, or the net itself |
| Branching is large: 46 legal actions on average in bot games, 250+ late in big games | **Gumbel root search** (Danihelka et al., 2022): sample k candidates without replacement, then sequential halving. Policy improvement is guaranteed even with 8 to 32 simulations, where PUCT is not |
| Fog of war | The network only sees the player's view. The search **freezes the view at the root**: trying a move cannot reveal what is behind the fog, and attacks need a target that was visible at the root |
| Chance (ruins, explorer rewards) | Every search state gets a **fresh random seed**, so the search samples outcomes instead of reading the real game's seed |
| Long games with sparse outcomes (300 to 1,000 decisions per player) | A **warm start** from the built-in bots; **playout-cap randomisation** (a quarter of the decisions get the full search and become policy targets, the rest are cheap); a **curriculum** from tiny 1v1 maps to full games |
| Over-fitting to one opponent | A **league**: each self-play game is against the current net, crazy, hard, or a snapshot of an earlier net |
| One action barely moves the final outcome, so an early value net's Q-gaps are noise, and a search that trusts them drifts (see [Stabilising self-play](#stabilising-self-play)) | Values scaled by their known bounds, not min-max; a **score-margin leaf blend**, annealed away; warm-start positions mixed into every batch as an **anchor** |

## How it fits together

```
 ml/zero/sim (Node)                                         ml/zero/polyzero (Python)
 ┌──────────────────────────────────────────────┐          ┌──────────────────────────────────────────┐
 │ ../../sim/tt.js + rulesets/polytopia_live.js  │          │ net.py      PolyNet (conv + pointer head) │
 │   the same Polytopia rules as ml/             │          │ mcts.py     Gumbel AlphaZero search       │
 │ core.js   observation bytes, atomic legal     │  JSON    │ play.py     many games at once, batched   │
 │           actions, apply, outcome             │◀────────▶│ workers.py  self-play processes           │
 │ server.js games + search states by handle,    │  lines   │ train.py    warm start + self-play loop   │
 │           one batched "step" per round trip   │          │ evaluate.py paired evaluation vs bots     │
 │ gen_bc.js bot games -> warm-start positions   │          │ data.py     buffer, batches, losses       │
 └──────────────────────────────────────────────┘          └──────────────────────────────────────────┘
```

The rules live only in the JavaScript engine, under the live ruleset `ml/sim/rulesets/polytopia_live.js` (or the
classic `polytopia.js`; never the browser game's own variant). A search node is a copy of the game state held by the Node process
(about 0.3 ms per copy). Python holds the tree, the network and the training loop. One round trip frees finished
trees, plays the actions searches have settled on, and expands every leaf that every running search asked for. The
new leaves of all games are then scored in one network call.

## The game as the search sees it

### Atomic actions

An action is a quad `(verb, src, dst, arg)`. `src`/`dst` are tiles on a 20 × 20 grid (every Polytopia map size fits;
smaller maps sit in the corner), or a tribe-level token for research and end_turn. `arg` is a unit type, vessel,
reward, building or tech. Quads are positional, with no unit ids, so the same quad means the same action on every
copy of a state. Each quad is also a tuple of the language-model pipeline (`("giant#12", "move", (5, 7))`), so
everything downstream of `ml/sim/actions.js`, the PolyCommand bridge included, works unchanged.

| verb | src → dst | arg |
| --- | --- | --- |
| `move`, `attack`, `convert` | unit tile → target tile | |
| `capture`, `examine`, `recover`, `heal`, `disband` | unit tile | |
| `infiltrate` (live) | cloak's tile | |
| `upgrade` | unit tile | live: scout / rammer / bomber (classic: ship / battleship) |
| `train`, `reward` | city tile | unit type / reward |
| `build` | tile | live: one of 29 kinds (harvests incl. starfish, buildings incl. market, temples, road, bridge, clear, burn, grow, destroy, the 7 monuments); classic: 21 |
| `research` | tribe token | one of 25 techs (classic: 24) |
| `embassy` (live) | tribe token → rival capital | |
| `end_turn` | tribe token | |

`core.legal()` lists every legal action, so the network never sees an illegal one and the search never wastes a
simulation. The list is exhaustive: `test/core.js` replays bot games under each ruleset and checks that every action
the bot takes is in the list (embassies, upgrades, starfish and water ruins included). It also plays every listed
action on a copy and checks that it succeeds and survives a tuple round trip. One rule matches the real game's
pop-up: a pending city level-up reward must be chosen before anything else. That is the only difference from what
the bot may do: under the live rules, a city connection can level a city mid-turn, and the bot sometimes keeps
moving before picking the reward.

### Observation

What the network gets, all from the acting player's point of view after fog of war:

- **16 categorical bytes per tile**, each with its own learned embedding: terrain (or unexplored, or off-map),
  elevation, owner, resource, improvement, road/ruin/bridge/unfound lighthouse, city (village / mine / rival by
  seat order), city level, flags (capital, walls, reward pending, unit cap, linked to the capital) and population,
  unit type, owner, HP, vessel, and can-move / can-attack / veteran flags. Owners are relative: 1 = me, then rivals
  in turn order after me.
- **87 global numbers** (85 classic): turn and turns left, mode, player count, stars, income, score and its parts,
  rank, rivals' score gaps and whether they are alive, explored fraction, tribes met, embassies, lighthouses found,
  pacifist streak, my techs, tribe and map type, and the `ended` flag of afterstates.

The same information is in the PolyState JSON a real-game bridge already produces (`ml/bridge/README.md`), apart from
each unit's separate can-move / can-attack flags.

## The network

```
tiles [B, H, W, 16] ──embed+sum──▶ + globals ──▶ stem conv ──▶ 4 residual blocks (48 ch) ──▶ h [B, H·W, 48]
                                                                     │                     + tribe token
                                                    masked mean+max ──┴─▶ g ──▶ value = tanh(MLP(g))
policy: for each legal (verb, src, dst, arg):  logit = MLP( Ws·h[src] + Wd·h[dst] + E[verb] + E[arg] + Wg·g )
```

- **Pointer-style policy head.** It scores the legal actions themselves instead of a fixed output layer. That keeps
  the head tiny and covers every action and map size.
- **Batches are cropped** to the largest map in the batch. On a tiny 11 × 11 map that is 3.3× less convolution than
  the full 20 × 20 grid.
- **No batch norm.** Residual blocks use a learned gain that starts at zero, so mixed map sizes behave the same in
  training and at play time.
- **Sizes**: `macbook.yaml` uses 48 channels, 4 blocks, 0.25M parameters; `gpu.yaml` uses 64 channels, 6 blocks,
  0.57M parameters. Both play comfortably on a laptop CPU.
- **Devices**: `device: auto` picks cuda, then mps (Apple silicon), then cpu. Self-play inference stays on the CPU
  (`actor_device: cpu`): with batches of a few positions per call, kernel launches cost more than the arithmetic.

## Search

`polyzero/mcts.py` implements Gumbel AlphaZero, with the real simulator as the model:

- **Root.** Gumbel-top-k picks `max_considered` candidates (8 by default) from the policy logits. Sequential
  halving spreads `simulations` (16) over them and keeps the better half each round. The action played is
  argmax(g + logits + σ(q̂)). Candidates' subtrees are disjoint, so one simulation below each candidate runs as a
  single batch.
- **Interior.** Deterministic selection: argmax(π′(a) − N(a) / (1 + ΣN)), with π′ = softmax(logits + σ(completed Q)).
  Unvisited actions are completed with the mixed value estimate.
- **Leaves.** The value net scores the position. An `end_turn` child is the afterstate: same position, `ended` flag
  set, no unit able to act. A finished game gets its exact outcome. There are no intermediate rewards and no
  discounting: every value is the expected final outcome in [−1, 1].
- **σ.** σ(q) = (c_visit + max N) · c_scale · (q + 1)/2, with c_visit 50 and c_scale 1. Values are mapped by their
  known bounds. The usual per-node min-max rescaling (mctx's default, `rescale: true`) turned tiny, noisy Q gaps
  into ±5-logit swings with an early value net, and played far worse (see below).
- **Leaf blend** (`heuristic`, training only, annealed to 0): leaf value = (1 − λ) · value net + λ · score margin
  (the same squashed margin as the outcome, read from the observation). Early on, this gives the search real credit
  for actions that gain score: research, training, captures, growth, exploration.
- **Policy target**: π′ at the root.
- **Budgets**: `full_prob` 0.25 of decisions get the full budget and become policy targets. The rest get
  `fast_simulations` (4) and only contribute value targets. Evaluation always searches fully and deterministically
  (`gumbel_scale: 0`).

## Training

### Stage 0: warm start from the bots

`sim/gen_bc.js` plays bot-vs-bot games over random setups: map types, sizes, 2 to 4 tribes, normal/hard/crazy
bots. It records a sample of their atomic actions as (observation, legal actions, target). The order of a bot's
actions within a turn is mostly arbitrary, so the policy target is the bot's next action (half the mass) plus every
action it takes later that turn that is already legal (the other half). Hard and crazy actions get full policy
weight, normal a quarter. Every position, whoever played it, gets a value target: that seat's final outcome. Each
end_turn also yields an afterstate position (value only). On 4 cores, 1,500 live-rules games give 84k positions in
80 s.

### Stage 1: self-play iterations

Each iteration:

1. `workers` processes play `games_per_iter` games with the current weights. The opponent is drawn per game from
   the league: `self` (every seat is the current net, all recorded), a bot (`bot:normal`, `bot:hard`,
   `bot:crazy`), or `past` (a recent snapshot). Each curriculum stage can set its own mix: crazy joins once the net
   can sometimes win. The learner's seat is random.
2. Every decision of a learner seat becomes a position: the improved policy π′ (full searches only), the game's
   outcome for that seat, and, at each end_turn, the afterstate.
3. The learner takes `replay_ratio × new positions / batch_size` AdamW steps on a FIFO replay buffer (150k). Loss
   is policy cross-entropy plus value MSE. It saves weights atomically (workers reload on change), snapshots into
   the league every 5 iterations, and runs the paired evaluation every 10.

**Outcome** (`sim.utility`): 0.75 × rank utility (1st = +1 … last = −1; eliminated = −1) + 0.25 × tanh(score margin
over the best rival, relative to the scores). The rank part is what matters. The margin separates a narrow win
from a rout and gives lost games a gradient.

**Anchor** (`optim.bc_mix`, 0.2): a fifth of every batch is warm-start positions (hard/crazy actions, afterstates),
as with the KL-to-human-play term in AlphaStar. It keeps the policy close to competent play while the value net is
still learning what single actions are worth.

**Value warm-up** (`selfplay.policy_warmup`, 10 iterations): at first, self-play positions train only the value
head, and the policy is held by the anchor. Search targets start steering the policy only once the value has
adapted to on-policy games (see [the live run](#live-rules)).

**Curriculum** (`macbook.yaml`): 1v1 on tiny maps for 20 turns (against self, normal, hard and past), then
tiny/small maps with 2 to 3 tribes (crazy joins), then small to large maps with 2 to 4 tribes, some domination games
and the full league.

## Evaluation

`polyzero.evaluate` plays every game of a suite several times from the same seed: same map, tribes and seat. Once
the network is in the seat, and once each baseline bot is. The other seats are crazy bots.

| who in our seat | what it shows |
| --- | --- |
| `net:eval` | PolyZero, full deterministic search (32 simulations), no bonus stars |
| `bot:crazy` | crazy itself (+3 stars a turn over a human under the live rules, +2 classic): what "as good as crazy" means on these games |
| `bot:hard` | crazy's algorithm with a smaller bonus (+1 live, 0 classic) |

It reports win rate with a 95% Wilson interval, average rank, utility, score and score share, plus the **paired
utility difference** to each baseline (mean ± standard error over the same games). **PolyZero surpasses crazy on a
suite when its win rate beats the `bot:crazy` row and the paired difference to `bot:crazy` is positive, beyond
noise.** The default suites are 1v1 on small and normal maps, a 4-tribe free-for-all, and a domination duel.

Crazy's head start, measured in the simulator with paired seats (score games):

| our seat vs crazy | live rules: bonus | live: win | classic: bonus | classic: win | fair share |
| --- | --- | --- | --- | --- | --- |
| crazy, 1v1, tiny map, 20 turns (120 games) | +3 | 47% | +2 | 55% | 50% |
| hard, same | +1 | 22% | 0 | 20% | 50% |
| normal, same | 0 | 12.5% | 0 | not measured | 50% |
| crazy, 1v1, small map, 30 turns (60 games) | +3 | 42% | +2 | 45% | 50% |
| hard, same | +1 | 22% | 0 | 28% | 50% |
| normal, same | 0 | not measured | 0 | 18% | 50% |
| hard vs 3 crazy, normal map, 30 turns (60 games) | +1 | 5% | 0 | 10% | 25% |

"Bonus" is stars a turn over a human player. Under the live rules, the bot playing at a human's income (normal,
which also adds a little noise) wins one duel in eight against crazy. PolyZero starts from that handicap and has to
reach about one in two.

## Measured so far

On a 4-core Linux VM (no GPU), in this session. The first experiments ran under the classic rules, before the live
ruleset landed on this branch; the live run follows below.

| | |
| --- | --- |
| simulator cost per search node | clone 0.30 ms, legal actions 0.34 ms, observation 0.05 ms |
| legal actions per decision (bot games) | classic: mean 46, 95th percentile 137, max 257; live: mean 41 to 52 |
| network inference, 1 CPU thread | 480 positions/s (batch 1), 630 (batch 8), 750 (batch 32) |
| training step, batch 256, 4 threads | about 0.9 s (forward + backward + AdamW) |
| self-play iteration, 4 workers, tiny 1v1 maps | 24 games (2,000 to 4,300 positions) plus training: 13 to 60 s |
| warm-start data | classic: 1,200 bot games -> 60k positions in 52 s; live: 1,500 games -> 84k positions in 80 s |
| warm start (classic), 2 epochs (453 steps) | val hit rate 0.18 -> 0.62 (net's top action is one the bot takes that turn), val value MSE 0.47 -> 0.35 (outcome variance 0.61) |
| end-to-end test (`tests/test_pipeline.py`) | about 10 s |

Classic rules: the warm-start net against crazy in 48 paired 1v1 games on tiny maps (20 turns):

| our seat | win | utility | score |
| --- | --- | --- | --- |
| warm-start net, no search (policy argmax) | 2.1% | −0.909 | 2116 |
| same net, 16 simulations, absolute σ (default) | 10.4% | −0.770 | 1764 |
| same net, 32 simulations, c_scale 0.25 | 6.2% | −0.831 | 2311 |
| same net, 16 simulations, mctx min-max σ | 4.2% | −0.905 | 876 |
| hard bot (crazy without the bonus, 120 games) | 20% | | |

The warm start alone plays below the hard bot. Imitating a bot gets at most the bot's level, so the point of the
warm start is a prior that is better than random. Search already helps at this stage, and how much it should trust
an early value net matters a lot.

### Stabilising self-play

The first self-play run (classic rules, tiny 1v1 maps), with no blend and no anchor, collapsed within 10 iterations. Measured on the same
positions with 16 simulations:

| net | actions per turn | V(end turn now) − V(position) | end_turn: prior → search target | score vs crazy |
| --- | --- | --- | --- | --- |
| warm start | 4.9 | −0.14 | 0.28 → 0.13 | 2,000 to 3,600 |
| after 5 iterations | 2.5 | −0.08 | 0.25 → 0.29 | 0 in 3 of 4 games (eliminated) |
| after 10 iterations | 1.7 | −0.07 | 0.30 → 0.45 | 0 in 4 of 4 |

The value net had picked up action-level differences that were mostly noise. The search turned them into a policy
target that favoured ending the turn, and distilling that target made the next searches worse. The paired
evaluation went to 0% wins and a score of 375. That is why the defaults now include the leaf blend and the anchor.
Both are standard for search plus learning from a weak start (AlphaGo's value/rollout mixing, AlphaStar's
supervised anchor). Both can be switched off (`selfplay.heuristic=0`, `optim.bc_mix=0`) once the value net is good.

The same run with both on (same warm-start net, same settings otherwise), 10 iterations (about 8 minutes):

| | actions per turn | paired eval vs crazy (48 games) |
| --- | --- | --- |
| without blend and anchor | 5.1 -> 1.7 | 0% wins, score 375 |
| with blend (λ = 0.5, annealed) and anchor (20%) | 5.1 -> 4.6 | **14.6% wins** (warm start: 2 to 10%), score 1749; paired utility vs the hard bot −0.03 ± 0.11, i.e. level with it |

### Live rules

The same recipe under the live rules: warm start from 1,500 bot games (2 epochs, val hit rate 0.66, value MSE
0.28), then self-play on tiny 1v1 maps with the opponent mix of the classic run (40% crazy). 48 paired games vs
crazy; on these games crazy in our seat wins 48% and hard 19%.

| net | search in the eval | win | score | score share |
| --- | --- | --- | --- | --- |
| warm start | none (policy argmax) | 2.1% | 2427 | 0.28 |
| warm start | 16 simulations | 2.1% | 1638 | 0.19 |
| warm start | 16 simulations + blend 0.5 | 6.2% | 2214 | 0.25 |
| + 10 iterations (blend + anchor) | 16 + blend 0.45 | 0% | 1248 | 0.13 |
| + 10 iterations, value warm-up (policy held by the anchor) | 16 + blend 0.45 | 0% | 1784 | 0.19 |
| + 20 iterations, value warm-up (search targets from iteration 11) | 16 + blend 0.40 | 2.1% | 1300 | 0.15 |

Nothing collapsed: 3.7 to 5.6 actions a turn throughout. But 20 iterations did not improve on the warm start
either. The diagnostics point at the training signal rather than the search:

- The warm-start net is **eliminated in about half its games** against crazy's +3★ economy on tiny maps. The
  learner won 0 to 14% of its self-play games against crazy. So 40% of the games ended at the same outcome near −1,
  and the value head had little to learn from them.
- Without the blend, search on top of the live warm-start value net plays worse than the policy alone. The value
  net does not yet know what single actions are worth under the live rules. Search targets distilled from it
  cannot beat the bot prior yet.
- What the search changes is sensible (more moves and research, less end_turn and training), so the tree is not
  the problem.

The recipes now start the league against opponents the net can sometimes beat. The first curriculum stage uses
self, normal, hard and past; crazy joins in stage two and gets the full 40% only in stage three. The value warm-up
stays on. The next levers, in order: larger budgets for the searches that become policy targets (32 to 64),
TD(λ) value targets over the player's own turns, and the longer games where live-only mechanics (monuments,
growing temples, embassies) pay off. All but TD(λ) are config changes.


## Compute plan

A MacBook Air with 8 cores, 6 of them for self-play workers, should make roughly 2 to 3 times this VM's throughput.
That is about 100 to 150 iterations of 24 games per hour on tiny maps, and fewer as games get longer. A plan, with
gates:

| phase | iterations | games | gate (live rules, paired vs crazy) |
| --- | --- | --- | --- |
| warm start | | 2,000 bot games | hit rate above 0.55 |
| tiny 1v1 | 0 to 30 | about 700 | above the normal bot at human income (12.5%), then hard (22%) |
| tiny/small, 2 to 3 players | 30 to 120 | about 2,000 | parity with crazy on duel_small (about 42 to 47%) |
| small to large, 2 to 4 players | 120 to 300+ | 4,000+ | surpass crazy: duel and FFA win rates above the crazy rows, paired difference > 0 |

That is a few evenings on a laptop for the first two phases. The last phase is where a many-core box
(`configs/gpu.yaml`: 128 games per iteration, 64-simulation evaluation) pays off. The finished network still plays
on the laptop.

## Playing the real game

Every PolyZero action is a tuple of `ml/sim/actions.js`, so a trained net can drive the real game through the
PolyCommand bridge of `ml/bridge/README.md`. What remains:

- **Policy-only play** needs only the observation. It can be computed from PolyState if the bridge adds two
  optional per-unit fields, `can_move` and `can_attack`. The legal-action list can come from the game, or be
  rebuilt from PolyState with `core.legal` on an engine state.
- **Search in the real game** needs a simulator state. The plan is to rebuild an engine state from PolyState, with
  unexplored tiles filled by a sampled guess (determinisation). That is the same machinery as below.

## Open questions and next steps

- **Seeing the rivals' replies.** The tree stops at end_turn and trusts the value net about what rivals will do. One
  cheap extension is to let the built-in bot play the rivals' turns from each end_turn leaf and score the start of
  my next turn. That needs the hidden part of the board determinised first, or the search learns from rivals'
  units it could not have seen.
- **Value targets.** z only (default) or mixed with the root search value (`optim.value_mix`). A TD(λ) target over
  the player's own turns is the next thing to try if the value stays noisy.
- **Score-mode versus domination play.** The utility treats them alike, and the curriculum mixes them late. Separate
  evaluation suites will show whether that needs per-mode weighting.
- **Distillation to the language model.** Searched turns (π′ sequences) as SFT targets for `ml/polyrl`.
- **The live rules' long game.** Monuments, temples that grow for 10 turns, embassies and connections pay off over
  many turns. A 20-turn tiny duel does not reward them, so the curriculum has to reach 30+ turn games before the
  network can learn them. Special tribes (Aquarion, Polaris, ∑∫ỹriȱŋ, Cymanti) are not in the ruleset yet.
- **Game updates.** New units, buildings or verbs need ruleset entries and, for a new verb, a line in `core.legal`.
  The vocabularies are read from the ruleset, so most of it is automatic. Then a fresh warm start: a network belongs
  to the ruleset it was trained on, and the workers refuse a mismatch.

## Files

| Path | |
| --- | --- |
| `sim/core.js` | observation bytes, exhaustive atomic legal actions, quads ↔ tuples, apply, outcome |
| `sim/server.js` | JSON-lines server: games, search states by handle, batched `step` (free + act + expand) |
| `sim/gen_bc.js` | warm-start data from bot games (binary shards) |
| `polyzero/net.py` | PolyNet, batching with crops, device choice, save/load |
| `polyzero/mcts.py` | Gumbel AlphaZero search as a generator (driver batches the leaves) |
| `polyzero/play.py` | plays many games at once in one simulator process; records positions |
| `polyzero/workers.py` | self-play/eval worker processes (spawned, so the same on macOS) |
| `polyzero/train.py` | warm start, self-play iterations, league, curriculum, logging, resume |
| `polyzero/evaluate.py` | paired evaluation against the bots |
| `polyzero/data.py` | warm-start loader, replay buffer, batches, losses |
| `polyzero/sim.py`, `config.py` | simulator client, outcome utility and score-margin heuristic; YAML configs with `key=value` overrides |
| `configs/` | `macbook.yaml`, `gpu.yaml`, `eval.yaml` |
| `scripts/pipeline.sh` | the whole pipeline |
| `test/core.js`, `tests/` | Node checks; pytest (search unit tests, end-to-end pipeline) |

## Tests

```bash
npm run test:zero                  # Node, live and classic rules: action-space coverage, legality, fog, server (~6 s)
cd ml/zero && python -m pytest     # search on toy trees + end-to-end CPU pipeline with resume (~10 s)
```
