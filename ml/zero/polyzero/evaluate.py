"""Evaluate a PolyZero checkpoint against the built-in bots, with paired bot baselines on the very same games.

    PYTHONPATH=ml/zero python -m polyzero.evaluate --config ml/zero/configs/eval.yaml weights=runs/zero/latest.pt

Every game of a suite is played several times from the same seed (same map, tribes and seat): once with the network
in the seat, and once with each baseline bot in it. The other seats are the suite's opponent (the crazy bot by
default). Baselines:
  bot:crazy  the opponent itself in our seat: what "as good as crazy" means on these games (about 1/n wins)
  bot:hard   the same bot without crazy's +2 stars a turn: the handicap the network plays with (net seats get no
             bot bonus)
The network beats crazy on a suite when its paired utility difference to the bot:crazy baseline is positive, i.e. it
does better from the same seats on the same maps without the extra income.
"""

from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import config as C
from .mcts import SearchConfig
from .play import PlayConfig
from .workers import Pool

DEFAULT_SUITES = [
    {"name": "duel_small", "games": 24, "sample": {"sizes": {"small": 1}, "players": [2, 2], "modes": {"score": 1}, "turnLimits": [30]}},
    {"name": "ffa4_normal", "games": 16, "sample": {"sizes": {"normal": 1}, "players": [4, 4], "modes": {"score": 1}, "turnLimits": [30]}},
]


@dataclass
class EvalConfig:
    weights: str = "runs/zero/latest.pt"
    suites: list = field(default_factory=lambda: [dict(s) for s in DEFAULT_SUITES])
    opponent: str = "bot:crazy"
    baselines: list = field(default_factory=lambda: ["bot:crazy", "bot:hard"])
    search: SearchConfig = field(default_factory=lambda: SearchConfig(simulations=32, gumbel_scale=0.0))
    play: PlayConfig = field(default_factory=lambda: PlayConfig(concurrent=8, full_prob=1.0))
    workers: int = 4
    device: str = "cpu"
    seed: int = 20_000
    out: str | None = None


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def specs_for(cfg: EvalConfig) -> list[dict]:
    specs = []
    for si, s in enumerate(cfg.suites):
        for g in range(s["games"]):
            seed = cfg.seed + 7919 * g + 104729 * si
            base = {"seed": seed, "sample": s["sample"], "max_turns": s.get("max_turns")}
            opp = s.get("opponent", cfg.opponent)
            for who in ["net:eval"] + list(cfg.baselines):
                specs.append(dict(base, plan={"main": who, "main_seat": g, "others": opp}, tag={"suite": s["name"], "game": g, "who": who}))
    return specs


def summarize(results: list[dict]) -> dict:
    rows: dict = {}
    paired: dict = {}
    for r in results:
        t = r["tag"]
        res = r["result"]
        seat = t["game"] % res["n"]  # the plan's main_seat
        row = rows.setdefault((t["suite"], t["who"]), {"games": 0, "wins": 0, "rank": 0.0, "utility": 0.0, "score": 0.0, "share": 0.0, "alive": 0, "players": res["n"],
                                                       "decisions": 0.0, "simulations": 0.0, "turns": 0.0})
        row["games"] += 1
        row["wins"] += int(res["winner"] == seat)
        row["rank"] += res["ranks"][seat]
        row["utility"] += r["utility"][seat]
        row["score"] += res["scores"][seat]
        row["share"] += res["scores"][seat] / max(1, sum(res["scores"]))
        row["alive"] += int(res["alive"][seat])
        row["decisions"] += r["stats"].get("decisions", 0)
        row["simulations"] += r["stats"].get("simulations", 0)
        row["turns"] += r["stats"].get("turns", 0)
        paired.setdefault((t["suite"], t["game"]), {})[t["who"]] = r["utility"][seat]
    report = {"suites": {}}
    for (suite, who), row in sorted(rows.items()):
        n = row["games"]
        lo, hi = wilson(row["wins"], n)
        entry = {"games": n, "players": row["players"], "win_rate": row["wins"] / n, "win_ci95": [lo, hi], "fair_share": 1 / row["players"],
                 "avg_rank": row["rank"] / n, "utility": row["utility"] / n, "score": row["score"] / n, "score_share": row["share"] / n, "survival": row["alive"] / n}
        if who.startswith("net"):
            entry["sims_per_decision"] = row["simulations"] / max(1, row["decisions"])
            entry["actions_per_turn"] = row["decisions"] / max(1, row["turns"])
        report["suites"].setdefault(suite, {})[who] = entry
    for suite in report["suites"]:
        for base in [w for w in report["suites"][suite] if not w.startswith("net")]:
            d = [p["net:eval"] - p[base] for (s, _), p in paired.items() if s == suite and "net:eval" in p and base in p]
            if d:
                report["suites"][suite]["net:eval"]["vs_" + base] = {"utility_diff": float(np.mean(d)), "stderr": float(np.std(d) / math.sqrt(len(d))), "games": len(d)}
    return report


def print_report(report: dict) -> None:
    for suite, rows in report["suites"].items():
        print(f"[{suite}]")
        for who, e in rows.items():
            line = (f"  {who:10s} win {100 * e['win_rate']:5.1f}% (95% {100 * e['win_ci95'][0]:.0f}-{100 * e['win_ci95'][1]:.0f}, fair {100 * e['fair_share']:.0f}%)"
                    f"  rank {e['avg_rank']:.2f}  utility {e['utility']:+.3f}  score {e['score']:.0f}  share {e['score_share']:.2f}")
            print(line)
            for k, v in e.items():
                if k.startswith("vs_"):
                    print(f"    paired vs {k[3:]}: utility {v['utility_diff']:+.3f} +- {v['stderr']:.3f} over {v['games']} games")


def evaluate(cfg: EvalConfig, pool: Pool | None = None) -> dict:
    own = pool is None
    pool = pool or Pool(cfg.workers)
    t0 = time.time()
    try:
        results = pool.run(specs_for(cfg), cfg.weights, cfg.search, cfg.search, cfg.play, device=cfg.device, seed=cfg.seed)
    finally:
        if own:
            pool.close()
    report = summarize(results)
    report["seconds"] = time.time() - t0
    report["weights"] = cfg.weights
    if cfg.out:
        Path(cfg.out).parent.mkdir(parents=True, exist_ok=True)
        with open(cfg.out, "a") as f:
            f.write(json.dumps(report) + "\n")
    return report


def main(argv=None):
    cfg = C.cli(EvalConfig, argv, description=__doc__)
    report = evaluate(cfg)
    print_report(report)
    print(f"{report['seconds']:.0f}s")


if __name__ == "__main__":
    main()
