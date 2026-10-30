"""Play games with PolyZero seats: many games at once in one simulator process, all their searches batched.

Each round trip does three things in one simulator call: free finished search trees, play the actions searches have
settled on, and expand the leaves every running search asked for. The new leaves of all games are then scored in one
network call per agent. Bot seats play inside the simulator, between net turns.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np

from .data import afterstate
from .mcts import Node, SearchConfig, handles, search
from .sim import Sim, decode_legal, decode_obs, margin_value, utility


@dataclass
class PlayConfig:
    concurrent: int = 8                # games one worker plays at once (their leaves share calls)
    full_prob: float = 0.25            # playout-cap randomisation: share of decisions searched with the full budget
    fast_simulations: int = 4          # budget of the other decisions; their policy targets are not trained on
    max_decisions_per_turn: int = 200  # safety cap; the turn is ended after that many actions
    w_margin: float = 0.25             # outcome = rank utility blended with the score margin (sim.utility)


@dataclass
class Agent:
    evaluator: object                  # net.Evaluator
    search: SearchConfig
    record: bool = False               # keep training samples for this agent's seats
    full: bool = False                 # always search with the full budget (evaluation)
    name: str = "net"


@dataclass
class GameSpec:
    agents: dict[str, Agent]           # seat label ("net:<name>") -> agent
    seed: int
    seats: list[str] | None = None     # per seat: "net:<name>" or "bot:<easy|normal|hard|crazy>", or
    plan: dict | None = None           # {main, main_seat (-1 random), others}, filled in once the player count is known
    sample: dict | None = None         # constraints for ml/sim/configs.js (random setup), or
    settings: dict | None = None       # a fixed TT.newGame setup
    max_turns: int | None = None
    tag: dict = field(default_factory=dict)


class _Game:
    def __init__(self, spec: GameSpec, gid: int):
        self.spec, self.gid = spec, gid
        self.pid = -1
        self.root: Node | None = None
        self.gen = None
        self.full = False
        self.turn_key = None
        self.decisions = 0
        self.seats: list[str] = []
        self.samples: list[dict] = []
        self.stats = defaultdict(float)
        self.info: dict = {}


def _end_turn_index(legal: np.ndarray) -> int:
    idx = np.nonzero(legal[:, 0] == 0)[0]
    return int(idx[0]) if len(idx) else 0


def play(sim: Sim, specs: list[GameSpec], cfg: PlayConfig, rng: np.random.Generator) -> list[dict]:
    """Play every game in `specs` (cfg.concurrent at a time). Returns one dict per game: result, seats, per-seat
    utility, samples (for agents with record=True, value targets filled in) and stats."""
    spec = sim.spec
    todo = list(specs)[::-1]
    out: list[dict] = []
    evalq: list[tuple] = []  # (game, "root", payload) | (game, "nodes", [payload, ...])

    def finish(g: _Game, result: dict) -> None:
        util = [utility(result, p, cfg.w_margin) for p in range(result["n"])]
        for s in g.samples:
            s["z"] = np.float32(util[s["pid"]])
        out.append({"result": result, "seats": g.seats,
                    "utility": util, "samples": g.samples, "stats": dict(g.stats), "tag": g.spec.tag, "info": g.info})
        sim.call("close", gid=g.gid)

    def start_next() -> None:
        if not todo:
            return
        sp = todo.pop()
        r = sim.call("new", seed=sp.seed, sample=sp.sample, settings=sp.settings, seats=sp.seats, plan=sp.plan, max_turns=sp.max_turns)
        g = _Game(sp, r["gid"])
        g.seats = r["seats"]
        g.info = {"settings": {k: r["settings"].get(k) for k in ("size", "mapType", "mode", "turnLimit", "seed")}, "tribes": r["tribes"]}
        if r.get("root"):
            evalq.append((g, "root", r["root"]))
        else:
            finish(g, r.get("result") or sim.call("result", gid=g.gid)["result"])
            start_next()

    for _ in range(cfg.concurrent):
        start_next()

    while evalq:
        # ---- score every new node, one network call per agent
        batch = defaultdict(list)  # agent id -> [(entry, item, tiles, glob, legal)]
        agents = {}
        built: dict[tuple[int, int], Node] = {}
        for e, (g, kind, pl) in enumerate(evalq):
            if kind == "root":
                g.pid = pl["pid"]
            ag = g.spec.agents[g.seats[g.pid]]
            agents[id(ag)] = ag
            for k, p in enumerate([pl] if kind == "root" else pl):
                tiles, glob = decode_obs(p["obs"], spec)
                legal = decode_legal(p["legal"])
                if p.get("over"):
                    built[(e, k)] = Node(p["h"], legal, [], utility(p["result"], g.pid, cfg.w_margin), terminal=True)
                else:
                    batch[id(ag)].append((e, k, tiles, glob, legal, p))
        for aid, items in batch.items():
            ag = agents[aid]
            logits, values = ag.evaluator([it[2] for it in items], [it[3] for it in items], [it[4] for it in items])
            hw = ag.search.heuristic
            for (e, k, tiles, glob, legal, p), lg, v in zip(items, logits, values):
                if hw > 0:
                    v = (1.0 - hw) * float(v) + hw * margin_value(glob, spec)
                built[(e, k)] = Node(p["h"], legal, lg, v, terminal=bool(p.get("ended")), tiles=tiles, glob=glob)

        # ---- advance each search to its next request or its decision
        acts, acting, jobs, owners, free = [], [], [], [], []
        for e, (g, kind, pl) in enumerate(evalq):
            ag = g.spec.agents[g.seats[g.pid]]
            decision, send = None, None
            if kind == "root":
                root = g.root = built[(e, 0)]
                key = (g.pid, pl["turn"])
                if key != g.turn_key:
                    g.turn_key, g.decisions = key, 0
                    g.stats["turns"] += 1
                g.decisions += 1
                g.full = ag.full or rng.random() < cfg.full_prob
                if g.decisions > cfg.max_decisions_per_turn:
                    decision = (_end_turn_index(root.legal), root.prior.astype(np.float32), root.value, 0)
                    g.stats["forced_end"] += 1
                else:
                    g.gen = search(root, ag.search, rng, None if g.full else cfg.fast_simulations)
            else:
                send = [built[(e, k)] for k in range(len(pl))]
            if decision is None:
                try:
                    req = g.gen.send(send)
                    jobs.extend([parent.h, int(a)] for parent, a in req)
                    owners.append((g, len(req)))
                    continue
                except StopIteration as stop:
                    decision = stop.value
            a, pi, v, used = decision
            root = g.root
            g.stats["decisions"] += 1
            g.stats["simulations"] += used
            if ag.record:
                s = {"tiles": root.tiles, "glob": root.glob, "legal": root.legal, "pi": pi,
                     "pw": np.float32(1.0 if g.full and len(root.legal) > 1 and used > 0 else 0.0),
                     "v_search": np.float32(v), "pid": g.pid, "turn": g.turn_key[1]}
                g.samples.append(s)
                if root.legal[a, 0] == 0:  # end_turn: the afterstate is what the search scores end_turn leaves with
                    g.samples.append(afterstate(s, spec))
            free.extend(handles(root))
            acts.append([g.gid, root.legal[a].tolist(), int(rng.integers(1 << 30))])
            acting.append(g)
            g.root = g.gen = None

        if not acts and not jobs:
            break
        r = sim.call("step", free=free, acts=acts, jobs=jobs)
        evalq = []
        for g, ar in zip(acting, r["acts"]):
            if not ar["ok"]:
                g.stats["rejected"] += 1
            if ar.get("result") is not None:
                finish(g, ar["result"])
                start_next()
            elif ar.get("root"):
                evalq.append((g, "root", ar["root"]))
            else:
                raise RuntimeError(f"game {g.gid}: no net seat to move but the game is not over")
        i = 0
        for g, n in owners:
            evalq.append((g, "nodes", r["nodes"][i:i + n]))
            i += n
    return out
