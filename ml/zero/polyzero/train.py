"""Train PolyZero: an optional warm start on bot games, then self-play iterations (Gumbel AlphaZero).

    PYTHONPATH=ml/zero python -m polyzero.train --config ml/zero/configs/macbook.yaml [key=value ...]

Each iteration:
  1. workers play `games_per_iter` games with the current weights, each against one opponent kind drawn from the
     league: itself (every seat searched and recorded), the crazy or hard bot, or an older snapshot;
  2. every searched decision of a learner seat becomes a position: improved policy pi' (full searches only) and
     the game's final outcome for that seat;
  3. the learner takes replay_ratio x (new positions) / batch_size gradient steps on the replay buffer, saves the
     weights the workers read next, and every few iterations snapshots them into the league and runs the paired
     evaluation against the crazy bot.
Re-running the same command resumes from output_dir/latest.pt.
"""

from __future__ import annotations

import json
import math
import random
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import torch
import yaml

from . import config as C
from .data import Buffer, load_bc, losses, make_batch
from .evaluate import EvalConfig, evaluate, print_report
from .mcts import SearchConfig
from .net import NetConfig, PolyNet, load, n_params, pick_device, save
from .play import PlayConfig
from .sim import Sim
from .workers import Pool

DEFAULT_CURRICULUM = [
    {"until": 30, "sample": {"sizes": {"tiny": 1}, "players": [2, 2], "modes": {"score": 1}, "turnLimits": [20]}},
    {"until": 120, "sample": {"sizes": {"tiny": 1, "small": 2}, "players": [2, 3], "modes": {"score": 1}, "turnLimits": [25, 30]}},
    {"until": None, "sample": {"sizes": {"small": 2, "normal": 2, "large": 1}, "players": [2, 4], "modes": {"score": 4, "domination": 1}, "turnLimits": [30]},
     "max_turns": 40},
]


@dataclass
class OptimConfig:
    lr: float = 1e-3
    weight_decay: float = 1e-4
    batch_size: int = 256
    value_weight: float = 1.0
    value_mix: float = 0.0       # value target = (1 - mix) * outcome + mix * the search's root value
    bc_mix: float = 0.2          # share of each self-play batch drawn from the warm-start positions: an anchor that
                                 # keeps the policy near competent bot play while the value net is still learning
    grad_clip: float = 1.0


@dataclass
class WarmStartConfig:
    data: str | None = None      # output of ml/zero/sim/gen_bc.js; null = start from random weights
    epochs: float = 3.0
    lr: float = 2e-3
    value_weight: float = 0.5    # outcomes repeat across a game's positions: a lighter value loss overfits less
    policy_weights: dict = field(default_factory=lambda: {"easy": 0.0, "normal": 0.25, "hard": 1.0, "crazy": 1.0})
    val_every: int = 25          # games with game % val_every == 0 are held out


@dataclass
class SelfPlayConfig:
    games_per_iter: int = 24
    opponents: dict = field(default_factory=lambda: {"self": 0.3, "bot:crazy": 0.4, "bot:hard": 0.15, "past": 0.15})
    curriculum: list = field(default_factory=lambda: [dict(c) for c in DEFAULT_CURRICULUM])
    search: SearchConfig = field(default_factory=SearchConfig)
    play: PlayConfig = field(default_factory=PlayConfig)
    snapshot_every: int = 5
    league_size: int = 6
    heuristic: float = 0.5       # search leaf value mix with the score margin (SearchConfig.heuristic) ...
    heuristic_anneal: int = 100  # ... decayed linearly to 0 over this many iterations (0: kept constant)


def heuristic_at(sp: SelfPlayConfig, it: int) -> float:
    if sp.heuristic_anneal <= 0:
        return sp.heuristic
    return sp.heuristic * max(0.0, 1.0 - it / sp.heuristic_anneal)


@dataclass
class TrainConfig:
    net: NetConfig = field(default_factory=NetConfig)
    optim: OptimConfig = field(default_factory=OptimConfig)
    warm_start: WarmStartConfig = field(default_factory=WarmStartConfig)
    selfplay: SelfPlayConfig = field(default_factory=SelfPlayConfig)
    eval: EvalConfig = field(default_factory=EvalConfig)
    output_dir: str = "runs/zero"
    iterations: int = 300
    buffer_size: int = 150_000
    replay_ratio: float = 4.0    # positions drawn for training per new self-play position
    min_buffer: int = 2_000
    workers: int = 4
    device: str = "auto"         # learner: cuda, Apple-silicon "mps", or cpu
    actor_device: str = "cpu"    # self-play inference (small batches: the CPU is usually fastest)
    eval_every: int = 10
    seed: int = 1
    rules: str = "polytopia_live"  # the live game (2.17.3); "polytopia" for the classic ruleset


def _log(path: Path, row: dict) -> None:
    with open(path, "a") as f:
        f.write(json.dumps(row) + "\n")


def _atomic_save(net, path: Path, **extra) -> None:
    tmp = path.with_suffix(".tmp")
    save(net, tmp, **extra)
    tmp.replace(path)


def _train_steps(net, opt, buffer, steps, cfg: OptimConfig, device, rng, pad, anchor=None) -> dict:
    net.train()
    agg: dict = {}
    n_anchor = int(round(cfg.batch_size * cfg.bc_mix)) if anchor is not None and len(anchor) else 0
    for _ in range(steps):
        items = buffer.sample(cfg.batch_size - n_anchor, rng) + (anchor.sample(n_anchor, rng) if n_anchor else [])
        b = make_batch(items, pad, device, cfg.value_mix)
        loss, m = losses(net, b, cfg.value_weight)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(net.parameters(), cfg.grad_clip)
        opt.step()
        for k, v in m.items():
            if not math.isnan(v):
                agg.setdefault(k, []).append(v)
    net.eval()
    return {k: float(np.mean(v)) for k, v in agg.items()}


@torch.no_grad()
def _eval_set(net, items, device, pad, bs=512) -> dict:
    net.eval()
    agg: dict = {}
    for i in range(0, len(items), bs):
        _, m = losses(net, make_batch(items[i:i + bs], pad, device))
        for k, v in m.items():
            if not math.isnan(v):
                agg.setdefault(k, []).append(v)
    return {k: float(np.mean(v)) for k, v in agg.items()}


def warm_start_data(cfg: TrainConfig, spec: dict) -> list[dict]:
    w = cfg.warm_start
    return load_bc(w.data, w.policy_weights, spec=spec) if w.data else []


def warm_start(net, cfg: TrainConfig, device, out: Path, data: list[dict]) -> None:
    """Behaviour cloning of the hard/crazy bots' atomic actions (policy) and of every seat's outcome (value): a prior
    for the search to improve on, so self-play does not start from random play."""
    w = cfg.warm_start
    val = [s for s in data if s["game"] % w.val_every == 0]
    train = Buffer(len(data))
    train.add(s for s in data if s["game"] % w.val_every != 0)
    steps = int(w.epochs * len(train) / cfg.optim.batch_size)
    print(f"warm start: {len(train)} train / {len(val)} val positions, {steps} steps")
    opt = torch.optim.AdamW(net.parameters(), lr=w.lr, weight_decay=cfg.optim.weight_decay)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=w.lr, total_steps=max(1, steps), pct_start=0.1)
    rng, pad = random.Random(cfg.seed), net.spec["pad"]
    ocfg = OptimConfig(**{**C.to_dict(cfg.optim), "value_weight": w.value_weight})
    t0, chunk = time.time(), max(1, steps // 10)
    for s0 in range(0, steps, chunk):
        n = min(chunk, steps - s0)
        m = {}
        for _ in range(n):
            m = _train_steps(net, opt, train, 1, ocfg, device, rng, pad)
            sched.step()
        v = _eval_set(net, val, device, pad) if val else {}
        row = {"phase": "warm_start", "step": s0 + n, "train": m, "val": v, "seconds": round(time.time() - t0, 1)}
        print(f"  step {s0 + n}/{steps}  loss {m.get('loss', 0):.3f}  val policy {v.get('policy', 0):.3f} hit {v.get('hit', 0):.3f} top1 {v.get('top1', 0):.3f} value {v.get('value', 0):.3f}")
        _log(out / "log.jsonl", row)
    _atomic_save(net, out / "warm_start.pt", iteration=0)


def selfplay_specs(cfg: TrainConfig, it: int, league: list[str], rng: random.Random) -> list[dict]:
    sp = cfg.selfplay
    stage = next((c for c in sp.curriculum if c.get("until") is None or it < c["until"]), sp.curriculum[-1])
    kinds, weights = list(sp.opponents), list(sp.opponents.values())
    specs = []
    for _ in range(sp.games_per_iter):
        kind = rng.choices(kinds, weights)[0]
        if kind == "past" and not league:
            kind = "self"
        others = {"self": "net:learner", "past": "net:past:" + (rng.choice(league) if league else "")}.get(kind, kind)
        specs.append({"seed": rng.randrange(1, 2**31 - 1), "sample": stage["sample"], "max_turns": stage.get("max_turns"),
                      "plan": {"main": "net:learner", "main_seat": -1, "others": others}, "tag": {"opponent": kind}})
    return specs


def selfplay_stats(results: list[dict]) -> dict:
    by: dict = {}
    for r in results:
        k = r["tag"]["opponent"]
        if k == "self":
            continue
        res = r["result"]
        seat = r["seats"].index("net:learner")
        d = by.setdefault(k, {"games": 0, "wins": 0, "utility": 0.0})
        d["games"] += 1
        d["wins"] += int(res["winner"] == seat)
        d["utility"] += r["utility"][seat]
    return {k: {"games": d["games"], "win_rate": d["wins"] / d["games"], "utility": d["utility"] / d["games"]} for k, d in by.items()}


def main(argv=None):
    cfg = C.cli(TrainConfig, argv, description=__doc__)
    out = Path(cfg.output_dir)
    (out / "league").mkdir(parents=True, exist_ok=True)
    (out / "config.yaml").write_text(yaml.safe_dump(C.to_dict(cfg), sort_keys=False))
    device = pick_device(cfg.device)
    torch.manual_seed(cfg.seed)
    rng = random.Random(cfg.seed)

    latest = out / "latest.pt"
    start, league, bc = 0, [], None
    if latest.exists():
        net, ck = load(latest, device)
        start, league = ck.get("iteration", 0), [p for p in ck.get("league", []) if Path(p).exists()]
        print(f"resuming from {latest} at iteration {start}")
    else:
        with Sim(rules=cfg.rules) as sim:
            spec = sim.spec
        net = PolyNet(spec, cfg.net).to(device)
        if cfg.warm_start.data:
            bc = warm_start_data(cfg, net.spec)
            warm_start(net, cfg, device, out, bc)
        _atomic_save(net, latest, iteration=0, league=[])
    print(f"PolyNet {n_params(net) / 1e6:.2f}M parameters on {device}; {cfg.workers} self-play workers")
    opt = torch.optim.AdamW(net.parameters(), lr=cfg.optim.lr, weight_decay=cfg.optim.weight_decay)
    if latest.exists():
        ck = torch.load(latest, map_location="cpu", weights_only=False)
        if "optimizer" in ck:
            opt.load_state_dict(ck["optimizer"])

    anchor = None
    if cfg.optim.bc_mix > 0 and cfg.warm_start.data:
        anchor = Buffer(10**9)
        anchor.add(s for s in (bc if bc is not None else warm_start_data(cfg, net.spec)) if s["pw"] > 0 or not len(s["legal"]))
        print(f"anchor: {len(anchor)} warm-start positions, {cfg.optim.bc_mix:.0%} of each batch")
    del bc
    pool = Pool(cfg.workers, rules=cfg.rules)
    buffer, pad = Buffer(cfg.buffer_size), net.spec["pad"]
    try:
        for it in range(start, cfg.iterations):
            t0 = time.time()
            hw = heuristic_at(cfg.selfplay, it)
            cfg.selfplay.search.heuristic = hw
            specs = selfplay_specs(cfg, it, league, rng)
            results = pool.run(specs, str(latest), cfg.selfplay.search, cfg.eval.search, cfg.selfplay.play, device=cfg.actor_device, seed=cfg.seed * 7919 + it)
            t_play = time.time() - t0
            new = [s for r in results for s in r["samples"]]
            buffer.add(new)
            steps = math.ceil(len(new) * cfg.replay_ratio / cfg.optim.batch_size) if len(buffer) >= cfg.min_buffer else 0
            m = _train_steps(net, opt, buffer, steps, cfg.optim, device, rng, pad, anchor) if steps else {}
            if cfg.selfplay.snapshot_every and (it + 1) % cfg.selfplay.snapshot_every == 0:
                snap = out / "league" / f"iter-{it + 1:04d}.pt"
                _atomic_save(net, snap, iteration=it + 1)
                league = (league + [str(snap)])[-cfg.selfplay.league_size:]
            _atomic_save(net, latest, iteration=it + 1, league=league, optimizer=opt.state_dict())
            dec = sum(r["stats"].get("decisions", 0) for r in results)
            sims = sum(r["stats"].get("simulations", 0) for r in results)
            turns = sum(r["stats"].get("turns", 0) for r in results)
            row = {"phase": "selfplay", "iteration": it + 1, "games": len(results), "positions": len(new), "trained_on": int(sum(s["pw"] > 0 for s in new)),
                   "buffer": len(buffer), "steps": steps, "heuristic": hw, "train": m, "vs": selfplay_stats(results), "decisions": dec,
                   "sims_per_decision": sims / max(1, dec), "actions_per_turn": dec / max(1, turns), "seconds_play": round(t_play, 1), "seconds": round(time.time() - t0, 1)}
            _log(out / "log.jsonl", row)
            vs = " ".join(f"{k} {100 * v['win_rate']:.0f}%/{v['games']}" for k, v in sorted(row["vs"].items()))
            print(f"it {it + 1}: {len(results)} games, {len(new)} positions, {steps} steps, loss {m.get('loss', float('nan')):.3f} "
                  f"(policy {m.get('policy', float('nan')):.3f} value {m.get('value', float('nan')):.3f}) | {row['actions_per_turn']:.1f} actions/turn | wins {vs} | {row['seconds']:.0f}s")
            if cfg.eval_every and (it + 1) % cfg.eval_every == 0:
                ecfg = cfg.eval
                ecfg.weights, ecfg.out = str(latest), None
                ecfg.search.heuristic = hw  # the agent as trained so far (network + search alone once annealed)
                rep = evaluate(ecfg, pool)
                rep["iteration"] = it + 1
                _log(out / "eval.jsonl", rep)
                print_report(rep)
                shutil.copy(latest, out / f"eval-{it + 1:04d}.pt")
    finally:
        pool.close()


if __name__ == "__main__":
    main()
