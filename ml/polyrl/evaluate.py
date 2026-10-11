"""Evaluate a policy against the built-in bots, paired with a baseline on the very same games.

    python -m polyrl.evaluate --config ml/configs/eval.yaml [key=value ...]

Each game is played twice from the same seed and seat: once by the model, once by the built-in bot (baseline).
Reports win rate, final rank and score, action validity, and the model/baseline score ratio.
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from . import config as C
from .formatting import encode_prompt, load_format
from .generation import GenConfig, make_generator
from .modeling import ModelConfig, load_model, load_tokenizer
from .sim import Game, SimPool

DEFAULT_SAMPLE = {"sizes": {"small": 1, "normal": 2, "large": 1}, "players": [2, 5], "difficulties": {"hard": 2, "crazy": 1}, "modes": {"score": 1}, "turnLimits": [30]}


@dataclass
class EvalConfig:
    model: ModelConfig = field(default_factory=lambda: ModelConfig(name="runs/rl/merged", gradient_checkpointing=False))
    adapter: str | None = None
    gen: GenConfig = field(default_factory=GenConfig)
    rules: str = "polytopia"
    targets: str | None = "ml/data/sft/targets.json"
    games: int = 32
    sample: dict = field(default_factory=lambda: dict(DEFAULT_SAMPLE))
    seed: int = 10_000
    greedy: bool = True
    goal_boost: float = 1.0
    baseline: str | None = "hard"   # bot difficulty in the model's seat for the paired baseline; null to skip
    sim_procs: int = 4
    max_turns: int | None = 40
    max_prompt_tokens: int = 6144
    out: str | None = None


class ModelPolicy:
    def __init__(self, gen, tok, chat: bool, greedy: bool = True, goal_boost: float = 1.0, max_prompt_tokens: int = 6144):
        self.gen, self.tok, self.chat, self.greedy, self.boost, self.max_prompt = gen, tok, chat, greedy, goal_boost, max_prompt_tokens

    def __call__(self, games: list[Game]) -> list[str | None]:
        obs = [g.observe(boost=self.boost) for g in games]
        ids = [encode_prompt(self.tok, o["prompt"], self.chat) for o in obs]
        fit = [i for i, x in enumerate(ids) if len(x) <= self.max_prompt]
        out: list[str | None] = [None] * len(games)  # None: too long for the model, the bot plays it
        for i, s in zip(fit, self.gen.generate([ids[i] for i in fit], n=1, greedy=self.greedy)):
            out[i] = s[0].text
        return out


class BotPolicy:
    def __init__(self, difficulty: str = "hard"):
        self.difficulty = difficulty

    def __call__(self, games: list[Game]) -> list[str]:
        return [g.botplan(self.difficulty) for g in games]


def play_games(pool: SimPool, n: int, sample: dict, seed0: int, policy, max_turns: int | None) -> list[dict]:
    games = [pool.new_game(sample=sample, seed=seed0 + k, random_model_seat=True, max_turns=max_turns) for k in range(n)]
    logs = [{"reports": [], "bot_turns": 0} for _ in games]
    with ThreadPoolExecutor(max_workers=max(1, len(pool.clients))) as ex:
        while True:
            active = [k for k, g in enumerate(games) if not g.over and g.model_turn]
            if not active:
                break
            texts = policy([games[k] for k in active])

            def step(j):
                k, t = active[j], texts[j]
                if t is None:
                    logs[k]["bot_turns"] += 1
                    t = games[k].botplan()
                return k, games[k].step(t)["report"]

            for k, rep in ex.map(step, range(len(active))):
                logs[k]["reports"].append(rep)
    res = []
    for g, lg in zip(games, logs):
        res.append({"seed": g.settings["seed"], "settings": g.settings, "tribes": g.tribes, "seat": g.model_seats[0], "result": g.result(), **lg})
        g.close()
    return res


def summarize(res: list[dict]) -> dict:
    mean = lambda v: sum(v) / len(v) if v else 0.0
    reps = [r for g in res for r in g["reports"]]
    seat = lambda g: g["seat"]
    return {
        "games": len(res),
        "win_rate": mean([g["result"]["ranks"][seat(g)] == 1 for g in res]),
        "final_rank": mean([g["result"]["ranks"][seat(g)] for g in res]),
        "final_score": mean([g["result"]["scores"][seat(g)] for g in res]),
        "survival_rate": mean([g["result"]["alive"][seat(g)] for g in res]),
        "turns": len(reps),
        "parse_rate": mean([r["parsed"] > 0 and r["complete"] for r in reps]),
        "end_turn_rate": mean([r["endedExplicitly"] for r in reps]),
        "valid_action_rate": sum(r["valid"] for r in reps) / max(1, sum(r["valid"] + r["invalid"] for r in reps)),
        "actions_per_turn": mean([r["valid"] for r in reps]),
        "invalid_per_turn": mean([r["invalid"] for r in reps]),
        "bot_turn_share": sum(g["bot_turns"] for g in res) / max(1, len(reps)),
    }


def main(cfg: EvalConfig) -> dict:
    pool = SimPool(cfg.sim_procs, rules=cfg.rules, targets=cfg.targets)
    report = {"config": C.to_dict(cfg)}
    if cfg.model.name:
        tok = load_tokenizer(cfg.model.name, cfg.model.trust_remote_code)
        chat = bool(load_format(cfg.adapter or cfg.model.name).get("chat_template", False))
        model = None
        if cfg.gen.backend != "vllm":
            import torch

            model = load_model(cfg.model, "cuda" if torch.cuda.is_available() else "cpu")
            if cfg.adapter:
                from peft import PeftModel

                model = PeftModel.from_pretrained(model, cfg.adapter)
            model.eval()
        gen = make_generator(cfg.gen, model, tok, model_path=cfg.model.name, seed=cfg.seed)
        if cfg.gen.backend == "vllm" and cfg.adapter:
            gen.set_adapter(cfg.adapter, 1)
        model_res = play_games(pool, cfg.games, cfg.sample, cfg.seed, ModelPolicy(gen, tok, chat, cfg.greedy, cfg.goal_boost, cfg.max_prompt_tokens), cfg.max_turns)
        report["model"] = summarize(model_res)
        report["model_games"] = [{k: g[k] for k in ("seed", "tribes", "seat")} | {"scores": g["result"]["scores"], "ranks": g["result"]["ranks"]} for g in model_res]
    if cfg.baseline:
        base_res = play_games(pool, cfg.games, cfg.sample, cfg.seed, BotPolicy(cfg.baseline), cfg.max_turns)
        report["baseline"] = summarize(base_res)
        if "model" in report:
            pairs = [(m["result"]["scores"][m["seat"]], b["result"]["scores"][b["seat"]]) for m, b in zip(model_res, base_res)]
            report["paired"] = {"score_ratio": sum(m for m, _ in pairs) / max(1, sum(b for _, b in pairs)),
                                "model_better_or_equal": sum(m >= b for m, b in pairs) / max(1, len(pairs))}
    pool.close()
    print(json.dumps({k: v for k, v in report.items() if k not in ("config", "model_games")}, indent=1))
    if cfg.out:
        Path(cfg.out).parent.mkdir(parents=True, exist_ok=True)
        Path(cfg.out).write_text(json.dumps(report, indent=1))
    return report


if __name__ == "__main__":
    main(C.cli(EvalConfig, description=__doc__))
