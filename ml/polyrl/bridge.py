"""Play The Battle of Polytopia with the trained model through a game bridge.

The model never sees the simulator. Each turn it gets a prompt rendered from a PolyState (JSON of what the player
knows) and answers with action tuples, which become PolyCommands (JSON) for the game to execute. Anything that can
produce PolyState and execute PolyCommands can host the model: the simulator (SimBridge, used for tests and
demos), or a real Polytopia client behind a small HTTP service (HttpBridge). ml/bridge/README.md has the contract.

    python -m polyrl.bridge --model runs/rl/merged --http http://127.0.0.1:8765   # real game via HTTP bridge
    python -m polyrl.bridge --model runs/rl/merged --sim                          # demo against the simulator's bots
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
from collections import Counter
from typing import Callable, Protocol

from .sim import Game, SimClient


class GameBridge(Protocol):
    def state(self) -> dict: ...                    # PolyState of the player the model controls, at the start of its turn
    def execute(self, command: dict) -> dict: ...   # run one PolyCommand -> {"ok": bool, "err": str | None}
    def end_turn(self) -> None: ...
    def status(self) -> dict: ...                   # {"over": bool, "my_turn": bool}


class SimBridge:
    """The simulator behind the bridge interface. history=False mimics a real-game bridge that reports no history
    (the agent then supplies the model's own past actions itself)."""

    def __init__(self, game: Game, history: bool = True):
        self.game, self.history = game, history

    def state(self) -> dict:
        return self.game.snapshot(history=self.history)

    def execute(self, command: dict) -> dict:
        return self.game.exec_command(command)

    def end_turn(self) -> None:
        self.game.end_turn()

    def status(self) -> dict:
        return {"over": self.game.over, "my_turn": self.game.model_turn}


class HttpBridge:
    """Client for a bridge service next to the real game:
         GET  /status  -> {"over": bool, "my_turn": bool}
         GET  /state   -> PolyState
         POST /command  PolyCommand -> {"ok": bool, "err": str | null}
         POST /end_turn -> {}"""

    def __init__(self, base: str, timeout: float = 30.0):
        self.base, self.timeout = base.rstrip("/"), timeout

    def _req(self, path: str, body: dict | None = None) -> dict:
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method="GET" if body is None else "POST", headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            return json.loads(r.read() or b"{}")

    def state(self) -> dict:
        return self._req("/state")

    def execute(self, command: dict) -> dict:
        return self._req("/command", command)

    def end_turn(self) -> None:
        self._req("/end_turn", {})

    def status(self) -> dict:
        return self._req("/status")


class Agent:
    """policy: prompt text -> answer text. sim: a SimClient used only to render prompts and compile answers, so the
    text format is exactly the one the model trained on."""

    def __init__(self, policy: Callable[[str], str], sim: SimClient, goal_boost: float = 1.0, hist_turns: int = 2):
        self.policy, self.sim, self.boost, self.hist_turns = policy, sim, goal_boost, hist_turns
        self.memory: list[dict] = []  # the model's own executed actions per turn

    def goal(self, s: dict) -> dict:
        return self.sim.call("target", mode=s["mode"], turn_limit=s.get("turn_limit"), width=s["width"], players=s["players"], boost=self.boost)["goal"]

    def prompt(self, s: dict) -> str:
        if s.get("history") is None:
            s["history"] = [h for h in self.memory if h["turn"] >= s["turn"] - self.hist_turns and h["actions"] is not None]
        if not s.get("goal"):
            s["goal"] = self.goal(s)
        return self.sim.render(s)

    def play_turn(self, bridge: GameBridge) -> dict:
        s = bridge.state()
        text = self.policy(self.prompt(s))
        comp = self.sim.compile(text)
        done, errors, ended = [], Counter(), False
        for t, cmd in zip(comp["actions"], comp["commands"]):
            if "error" in cmd:
                errors[cmd["error"]] += 1
                continue
            if cmd["type"] == "end_turn":
                ended = True
                break
            r = bridge.execute(cmd)
            if r.get("ok"):
                done.append(t)
            else:
                errors[r.get("err") or "rejected"] += 1
        self.memory.append({"turn": s["turn"], "pid": s["me"]["id"], "actions": done})
        bridge.end_turn()
        return {"turn": s["turn"], "executed": len(done), "rejected": dict(errors), "ended_explicitly": ended, "parse_error": comp["error"]}

    def play_game(self, bridge: GameBridge, poll: float = 1.0, log: Callable[[dict], None] = print) -> None:
        while True:
            st = bridge.status()
            if st["over"]:
                return
            if st["my_turn"]:
                log(self.play_turn(bridge))
            else:
                time.sleep(poll)


def model_policy(model_path: str, adapter: str | None = None, greedy: bool = True, max_new_tokens: int = 768):
    import torch

    from .formatting import encode_prompt, load_format
    from .generation import GenConfig, HFGenerator
    from .modeling import ModelConfig, load_model, load_tokenizer

    tok = load_tokenizer(model_path)
    model = load_model(ModelConfig(name=model_path, gradient_checkpointing=False), "cuda" if torch.cuda.is_available() else "cpu")
    if adapter:
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, adapter)
    model.eval()
    chat = bool(load_format(adapter or model_path).get("chat_template", False))
    gen = HFGenerator(model, tok, GenConfig(max_new_tokens=max_new_tokens))
    return lambda prompt: gen.generate([encode_prompt(tok, prompt, chat)], greedy=greedy)[0][0].text


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", required=True)
    p.add_argument("--adapter")
    p.add_argument("--http", help="base URL of a game bridge service")
    p.add_argument("--sim", action="store_true", help="play a simulator game through the bridge interface")
    p.add_argument("--rules", default="polytopia")
    p.add_argument("--targets", default="ml/data/sft/targets.json")
    p.add_argument("--goal-boost", type=float, default=1.0)
    p.add_argument("--seed", type=int, default=7)
    a = p.parse_args(argv)
    sim = SimClient(rules=a.rules, targets=a.targets)
    agent = Agent(model_policy(a.model, a.adapter), sim, a.goal_boost)
    if a.http:
        agent.play_game(HttpBridge(a.http))
    elif a.sim:
        g = Game(sim, sample={"sizes": {"small": 1}, "players": [2, 3], "modes": {"score": 1}, "turnLimits": [20]}, seed=a.seed, random_model_seat=True)
        agent.play_game(SimBridge(g, history=False), poll=0)
        print(json.dumps(g.result()))
    else:
        p.error("choose --http URL or --sim")


if __name__ == "__main__":
    main()
