"""Rewards for simulation-based RL.

Turn reward (one sampled action list, measured on its own copy of the game; see Session.evaluate in ml/sim):
  progress   change over the horizon (my turn + rivals' replies [+ further bot-played turns]) in
             my score, my lead over the best rival, my income (stars per turn) and my city count
  rules      penalties for answers that are not a clean action list, for each action the game rejects,
             for a missing ("tribe", "end_turn"), and for being eliminated
Final reward (whole game): final score, winning, and final rank.
"""

from __future__ import annotations

from dataclasses import dataclass


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
    w_win: float = 1.0
    w_rank: float = 0.5


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
    return rules + progress, {"rules": rules, "progress": progress, "d_score": h["score"] - b["score"]}


def final_reward(result: dict, seat: int, c: RewardConfig) -> float:
    n, rank = result["n"], result["ranks"][seat]
    return c.w_final_score * result["scores"][seat] / c.final_scale + c.w_win * (rank == 1) + c.w_rank * (n - rank) / max(1, n - 1)
