"""Record replays: a model against built-in bots, every action as a frame (ml/sim/replay.js), for the replay viewer.

The model plays seat 0 (greedy, as in polyrl.evaluate); the other seats are the engine's own AI at the given
difficulty, so they keep the difficulty's bonuses. Seeds are fixed up front; every game played is written out.

    PYTHONPATH=ml python ml/scripts/record_replay.py --model runs/rl-v4-longterm/merged --seeds 101 202 303 \\
        --out runs/replay/v4_vs_crazy.json
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import torch

from polyrl.evaluate import ModelPolicy
from polyrl.formatting import load_format
from polyrl.generation import GenConfig, make_generator
from polyrl.modeling import ModelConfig, load_model, load_tokenizer
from polyrl.sim import Game, SimClient


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="runs/rl-v4-longterm/merged")
    ap.add_argument("--label", default="RL v4 (final)")
    ap.add_argument("--seeds", type=int, nargs="+", default=[101, 202, 303])
    ap.add_argument("--difficulty", default="crazy")
    ap.add_argument("--size", default="normal")
    ap.add_argument("--players", type=int, default=2)
    ap.add_argument("--turn-limit", type=int, default=30)
    ap.add_argument("--max-turns", type=int, default=40)
    ap.add_argument("--rules", default="polytopia")
    ap.add_argument("--targets", default="ml/data/sft/targets.json")
    ap.add_argument("--out", default="runs/replay/v4_vs_crazy.json")
    a = ap.parse_args()

    tok = load_tokenizer(a.model, False)
    chat = bool(load_format(a.model).get("chat_template", False))
    model = load_model(ModelConfig(name=a.model, gradient_checkpointing=False), "cuda" if torch.cuda.is_available() else "cpu")
    model.eval()
    gen = make_generator(GenConfig(max_new_tokens=768), model, tok, model_path=a.model)
    policy = ModelPolicy(gen, tok, chat, greedy=True)
    sample = {"sizes": {a.size: 1}, "players": [a.players, a.players], "difficulties": {a.difficulty: 1}, "modes": {"score": 1},
              "turnLimits": [a.turn_limit]}

    out = {"model": a.label, "model_path": a.model, "opponent": a.difficulty, "rules": a.rules, "games": []}
    client = SimClient(rules=a.rules, targets=a.targets)
    for seed in a.seeds:
        t0 = time.time()
        g = Game(client, sample=sample, seed=seed, model_seats=[0], max_turns=a.max_turns)
        frames = client.call("record", gid=g.gid, viewer=0)["frames"]
        orders = []
        while not g.over:
            if not g.model_turn:
                g.advance()
                frames += client.call("frames", gid=g.gid)["frames"]
                continue
            turn = frames[-1]["turn"]
            text = policy([g])[0]
            by_bot = text is None
            if by_bot:  # prompt too long for the model: the bot plays this turn, as in evaluation
                text = g.botplan()
            rep = g.step(text)["report"]
            frames += client.call("frames", gid=g.gid)["frames"]
            orders.append({"turn": turn, "plan": text, "by_bot": by_bot, "valid": rep["valid"], "invalid": rep["invalid"],
                           "errors": rep["errors"], "parsed": rep["parsed"]})
        res = g.result()
        g.close()
        out["games"].append({"seed": seed, "settings": g.settings, "tribes": g.tribes, "difficulties": g.difficulties,
                             "result": res, "orders": orders, "frames": frames})
        print(json.dumps({"seed": seed, "winner": res["winner"], "scores": res["scores"], "alive": res["alive"], "turn": res["turn"],
                          "frames": len(frames), "model_turns": len(orders), "secs": round(time.time() - t0)}), flush=True)
    client.close()
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, separators=(",", ":")))
    print("saved", a.out)


if __name__ == "__main__":
    main()
