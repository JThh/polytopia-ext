"""Client for the PolyZero simulator server (ml/zero/sim/server.js): one Node process, JSON lines over pipes.

Arrays come back as base64 little-endian buffers; `decode_obs` and `decode_legal` turn them into numpy arrays.
"""

from __future__ import annotations

import base64
import itertools
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

import numpy as np

ZERO_DIR = Path(__file__).resolve().parent.parent
SERVER_JS = ZERO_DIR / "sim" / "server.js"


class SimError(RuntimeError):
    pass


class Sim:
    def __init__(self, rules: str = "polytopia", node: str | None = None):
        node = node or os.environ.get("NODE", "node")
        if not shutil.which(node):
            raise SimError(f"Node.js not found ({node}); install Node 18+ or set NODE")
        env = dict(os.environ, POLY_RULES=rules)
        self.proc = subprocess.Popen([node, str(SERVER_JS)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=None,
                                     text=True, bufsize=1, env=env)
        self._ids = itertools.count(1)
        self.spec = self.call("spec")["spec"]

    def call(self, op: str, **kw: Any) -> dict:
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

    def close(self) -> None:
        if self.proc.poll() is None:
            try:
                self.proc.stdin.close()
                self.proc.wait(timeout=5)
            except Exception:
                self.proc.kill()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass


def decode_obs(o: dict, spec: dict) -> tuple[np.ndarray, np.ndarray]:
    """-> tiles uint8 [PAD*PAD, F], glob float32 [G]"""
    pad, nf = spec["pad"], len(spec["fields"])
    tiles = np.frombuffer(base64.b64decode(o["tiles"]), dtype=np.uint8).reshape(pad * pad, nf)
    glob = np.frombuffer(base64.b64decode(o["glob"]), dtype="<f4")
    return tiles, glob


def decode_legal(s: str) -> np.ndarray:
    """-> int16 [n, 4]: (verb, src, dst, arg) per legal action"""
    if not s:
        return np.zeros((0, 4), dtype=np.int16)
    return np.frombuffer(base64.b64decode(s), dtype="<i2").reshape(-1, 4)


def margin_value(glob: np.ndarray, spec: dict) -> float:
    """Score margin over the best living rival, squashed as in utility(): a heuristic position value read from the
    observation's globals (in score games the final score decides the winner)."""
    G = spec["glob"]
    me = float(glob[G.index("score")]) * 2000.0
    gaps = [float(glob[G.index(f"riv{k}")]) * 2000.0 for k in range(1, 6) if glob[G.index(f"riv{k}_alive")] > 0]
    best = me + max(gaps) if gaps else 0.0
    return float(np.tanh((me - best) / (0.3 * max(me, best) + 300.0)))


def utility(result: dict, pid: int, w_margin: float = 0.25) -> float:
    """Outcome for one seat in [-1, 1]: final rank (1st = +1, last = -1; eliminated = -1), blended with the score
    margin over the best rival, which separates a narrow win from a rout and gives losing games a gradient."""
    n, rank = result["n"], result["ranks"][pid]
    r = 1.0 if n <= 1 else 1.0 - 2.0 * (rank - 1) / (n - 1)
    if not result["alive"][pid]:
        r = -1.0
    s = result["scores"][pid]
    best = max([x for i, x in enumerate(result["scores"]) if i != pid] or [0])
    m = float(np.tanh((s - best) / (0.3 * max(s, best) + 300.0)))
    return (1.0 - w_margin) * r + w_margin * m
