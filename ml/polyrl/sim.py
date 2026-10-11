"""Python client for the Node simulator server (ml/sim/server.js).

One SimClient = one Node process holding any number of games. Use a SimPool for parallel rollouts: each game lives in
one process, and threads talking to different processes run in parallel (the Python side only waits on pipes).
"""

from __future__ import annotations

import itertools
import json
import os
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any

ML_DIR = Path(__file__).resolve().parent.parent
SERVER_JS = ML_DIR / "sim" / "server.js"


class SimError(RuntimeError):
    pass


class SimClient:
    def __init__(self, rules: str = "polytopia", targets: str | None = None, node: str | None = None):
        node = node or os.environ.get("NODE", "node")
        if not shutil.which(node):
            raise SimError(f"Node.js not found ({node}); install Node 18+ or set NODE")
        env = dict(os.environ, POLY_RULES=rules)
        if targets:
            env["POLY_TARGETS"] = str(targets)
        self.rules = rules
        self.proc = subprocess.Popen([node, str(SERVER_JS)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=None,
                                     text=True, bufsize=1, env=env)
        self._ids = itertools.count(1)
        self._lock = threading.Lock()

    def call(self, op: str, **kw: Any) -> dict:
        with self._lock:
            msg = dict(op=op, id=next(self._ids), **kw)
            try:
                self.proc.stdin.write(json.dumps(msg) + "\n")
                self.proc.stdin.flush()
                line = self.proc.stdout.readline()
            except BrokenPipeError as e:
                raise SimError("simulator process exited") from e
        if not line:
            raise SimError("simulator process exited")
        r = json.loads(line)
        if not r.get("ok"):
            raise SimError(f"{op}: {r.get('error')}")
        return r

    # stateless helpers (no game needed)
    def render(self, state: dict, goal: dict | None = None) -> str:
        return self.call("render", state=state, goal=goal)["prompt"]

    def compile(self, text: str) -> dict:
        return self.call("compile", text=text)

    def spec(self) -> dict:
        return self.call("spec")

    def close(self) -> None:
        if self.proc.poll() is None:
            try:
                self.proc.stdin.close()
                self.proc.wait(timeout=5)
            except Exception:
                self.proc.kill()

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass


class Game:
    """Handle to one game inside a SimClient."""

    def __init__(self, client: SimClient, **new_kwargs: Any):
        self.client = client
        r = client.call("new", **new_kwargs)
        self.gid = r["gid"]
        self.settings = r["settings"]
        self.tribes = r["tribes"]
        self.difficulties = r["difficulties"]
        self.model_seats = r["model_seats"]
        self.status = r["status"]

    @property
    def over(self) -> bool:
        return self.status["over"]

    @property
    def model_turn(self) -> bool:
        return self.status["modelTurn"]

    def observe(self, boost: float = 1.0, goal: dict | None = None) -> dict:
        return self.client.call("observe", gid=self.gid, boost=boost, goal=goal)

    def evaluate(self, plans: list[str], horizon: int = 1, seed: int = 12345) -> list[dict]:
        return self.client.call("evaluate", gid=self.gid, plans=plans, horizon=horizon, seed=seed)["results"]

    def step(self, plan: str, seed: int | None = None) -> dict:
        r = self.client.call("step", gid=self.gid, plan=plan, seed=seed)
        self.status = r["status"]
        return r

    def botplan(self, difficulty: str | None = None, seed: int | None = None) -> str:
        return self.client.call("botplan", gid=self.gid, difficulty=difficulty, seed=seed)["plan"]

    def advance(self) -> dict:
        self.status = self.client.call("advance", gid=self.gid)["status"]
        return self.status

    def result(self) -> dict:
        return self.client.call("result", gid=self.gid)

    # the simulator behind the real-game bridge interface (see bridge.py)
    def snapshot(self, goal: dict | None = None, history: bool = True) -> dict:
        return self.client.call("snapshot", gid=self.gid, goal=goal, history=history)["state"]

    def exec_command(self, command: dict) -> dict:
        return self.client.call("exec", gid=self.gid, command=command)["result"]

    def end_turn(self) -> dict:
        self.status = self.client.call("end_turn", gid=self.gid)["status"]
        return self.status

    def close(self) -> None:
        try:
            self.client.call("close", gid=self.gid)
        except SimError:
            pass


class SimPool:
    """N simulator processes; games are spread round-robin."""

    def __init__(self, n: int = 4, rules: str = "polytopia", targets: str | None = None):
        self.clients = [SimClient(rules=rules, targets=targets) for _ in range(max(1, n))]
        self._next = itertools.count()

    def client(self) -> SimClient:
        return self.clients[next(self._next) % len(self.clients)]

    def new_game(self, **kw: Any) -> Game:
        return Game(self.client(), **kw)

    def close(self) -> None:
        for c in self.clients:
            c.close()
