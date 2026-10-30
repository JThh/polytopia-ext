"""Rewards for simulation-based RL.

Turn reward (one sampled action list, measured on its own copy of the game; see Session.evaluate in ml/sim):
  progress   change over the horizon (my turn + rivals' replies [+ further bot-played turns]) in
             my score, my lead over the best rival, my income (stars per turn) and my city count
  rules      penalties for answers that are not a clean action list, for each action the game rejects,
             for a missing ("tribe", "end_turn"), and for being eliminated
Final reward (whole game): final score, being alive at the end, winning, and final rank.

Long-horizon option (value_model, w_value): the turn reward also counts the change, over the horizon, in a learned
value V(state) ~ expected final reward (polyrl/value.py, fit by ml/scripts/fit_value.py). w_progress scales the
immediate terms above, so w_value > 0 with a small w_progress makes the turn signal mostly long-term.
"""

from __future__ import annotations

from dataclasses import dataclass

from .value import load_value_model


@dataclass
class RewardConfig:
    score_scale: float = 300.0   # a strong Polytopia player gains roughly this much score per turn
    w_score: float = 1.0
    w_rel: float = 0.5           # lead over the best rival
    w_income: float = 0.1        # per star of income gained
    w_city: float = 0.5          # per city gained
    w_invalid: float = 0.15      # per action the game rejects
    w_parse: float = 1.5         # answer is not an action list at all
    w_incomplete: float = 0.5    # list cut off before its closing bracket
    w_no_end: float = 0.2        # no ("tribe", "end_turn")
    w_after_end: float = 0.05    # per action written after end_turn
    w_death: float = 3.0         # eliminated within the horizon
    final_scale: float = 3000.0
    w_final_score: float = 1.0
    w_survive: float = 0.0       # still alive when the game ends (0 keeps the original recipe)
    w_win: float = 1.0
    w_rank: float = 0.5
    value_model: str | None = None  # .npz from ml/scripts/fit_value.py; used when w_value > 0
    w_value: float = 0.0             # per unit change in V(state) over the horizon
    w_progress: float = 1.0          # scales the immediate progress terms (score, lead, income, cities, elimination)


def turn_reward(res: dict, c: RewardConfig) -> tuple[float, dict]:
    rep, b, h = res["report"], res["before"], res["horizon"]
    rules = 0.0
    if rep["parsed"] == 0 and rep["parseError"]:
        rules -= c.w_parse
    elif not rep["complete"]:
        rules -= c.w_incomplete
    if not rep["endedExplicitly"]:
        rules -= c.w_no_end
    rules -= c.w_invalid * rep["invalid"] + c.w_after_end * rep["afterEnd"]
    progress = (c.w_score * (h["score"] - b["score"]) + c.w_rel * ((h["score"] - h["maxOther"]) - (b["score"] - b["maxOther"]))) / c.score_scale
    progress += c.w_income * (h["income"] - b["income"]) + c.w_city * (h["cities"] - b["cities"])
    if not h["alive"]:
        progress -= c.w_death
    info = {"rules": rules, "progress": progress, "d_score": h["score"] - b["score"]}
    total = rules + c.w_progress * progress
    if c.w_value and c.value_model:
        d = value_change(res, c)
        info["d_value"] = d
        total += c.w_value * d
    return total, info


def value_change(res: dict, c: RewardConfig) -> float:
    """V(state at the horizon) - V(state at the start of the turn); the realised final reward replaces V when the
    game ends inside the horizon, and an eliminated seat is worth 0."""
    v = load_value_model(c.value_model)
    b, h = res["before"], res["horizon"]
    v0 = float(v([b["feat"]])[0])
    if not h["alive"]:
        return 0.0 - v0
    if res.get("over"):
        n = int(b["feat"][0])
        won = res.get("winner", -1) == res["report"]["pid"]
        v1 = (c.w_final_score * h["score"] / c.final_scale + c.w_survive + c.w_win * won
              + c.w_rank * (n - h["rank"]) / max(1, n - 1))
    else:
        v1 = float(v([h["feat"]])[0])
    return v1 - v0


def final_reward(result: dict, seat: int, c: RewardConfig) -> float:
    n, rank = result["n"], result["ranks"][seat]
    alive = result.get("alive", [True] * n)[seat]
    return (c.w_final_score * result["scores"][seat] / c.final_scale + c.w_survive * alive
            + c.w_win * (rank == 1) + c.w_rank * (n - rank) / max(1, n - 1))
