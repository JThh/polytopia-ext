"""Training positions: the warm-start set written by ml/zero/sim/gen_bc.js, the self-play replay buffer, batching.

A position is a dict: tiles uint8 [PAD*PAD, F], glob float32 [G], legal int16 [n, 4], a policy target (pi float32
[n], or target: index of the bot's action), pw (policy-loss weight), z (outcome, the value target) and v_search
(the search's own value estimate, which can be mixed into the value target).
"""

from __future__ import annotations

import json
import random
from collections import deque
from pathlib import Path

import numpy as np
import torch

from .net import collate

DIFFS = ["easy", "normal", "hard", "crazy"]


def outcome_utility(rank, n, score, best, alive, w_margin: float = 0.25) -> float:
    """sim.utility from the per-sample outcome columns gen_bc.js stores (rank, players, score, best rival, alive)."""
    r = 1.0 if n <= 1 else 1.0 - 2.0 * (rank - 1) / (n - 1)
    if not alive:
        r = -1.0
    m = float(np.tanh((score - best) / (0.3 * max(score, best) + 300.0)))
    return (1.0 - w_margin) * r + w_margin * m


def afterstate(s: dict, spec: dict) -> dict:
    """The position right after the player ends its turn, value target only: what the search scores an end_turn
    leaf with. Same as core.encode(..., ended=true): no unit of mine can act any more, and the ended flag is set."""
    names = [f for f, _ in spec["fields"]]
    tiles = s["tiles"].copy()
    tiles[:, names.index("unit_flags")] &= 4
    glob = s["glob"].copy()
    glob[spec["glob"].index("ended")] = 1.0
    return {"tiles": tiles, "glob": glob, "legal": s["legal"][:0], "pi": np.zeros(0, np.float32), "pw": np.float32(0.0),
            "z": s.get("z", np.float32(0.0)), "v_search": np.float32(np.nan), "pid": s["pid"], "turn": s["turn"], "game": s.get("game", -1)}


def load_bc(path: str | Path, policy_weights: dict, w_margin: float = 0.25, spec: dict | None = None) -> list[dict]:
    """Positions from gen_bc.js shards. With `spec`, each position where the bot ends its turn also yields the
    afterstate (value target only)."""
    out = []
    for head in sorted(Path(path).glob("bc-*.json")):
        h = json.loads(head.read_text())
        if h["n"] == 0:
            continue
        base = str(head)[: -len(".json")]
        arr = {k: np.fromfile(f"{base}.{k}.bin", dtype=np.dtype(t).newbyteorder("<")).reshape(-1, w) for k, (t, w) in h["arrays"].items()}
        tiles = arr["tiles"].reshape(h["n"], -1, h["F"])
        loff = arr["loff"][:, 0]
        for i in range(h["n"]):
            rank, n, score, best, alive = arr["out"][i]
            game, seat, turn, diff = arr["info"][i]
            s = {"tiles": tiles[i], "glob": arr["glob"][i], "legal": arr["legal"][loff[i]:loff[i + 1]], "target": int(arr["target"][i, 0]),
                 "pw": np.float32(policy_weights.get(DIFFS[diff], 0.0)), "z": np.float32(outcome_utility(rank, n, score, best, alive, w_margin)),
                 "v_search": np.float32(np.nan), "pid": int(seat), "turn": int(turn), "game": int(game)}
            if "pi" in arr:
                s["pi"] = arr["pi"][loff[i]:loff[i + 1], 0]
            out.append(s)
            if spec is not None and s["legal"][s["target"], 0] == 0:
                out.append(afterstate(s, spec))
    return out


class Buffer:
    """FIFO replay buffer of positions."""

    def __init__(self, capacity: int):
        self.items: deque = deque(maxlen=capacity)

    def add(self, samples) -> None:
        self.items.extend(samples)

    def __len__(self) -> int:
        return len(self.items)

    def sample(self, k: int, rng: random.Random) -> list[dict]:
        n = len(self.items)
        return [self.items[rng.randrange(n)] for _ in range(k)]


def make_batch(samples: list[dict], pad: int, device, value_mix: float = 0.0) -> dict:
    b = collate([s["tiles"] for s in samples], [s["glob"] for s in samples], [s["legal"] for s in samples], pad, device)
    B, A = b["amask"].shape
    pi = np.zeros((B, A), dtype=np.float32)
    for i, s in enumerate(samples):
        if "pi" in s:
            pi[i, :len(s["pi"])] = s["pi"]
        else:
            pi[i, s["target"]] = 1.0
    z = np.array([s["z"] for s in samples], dtype=np.float32)
    vs = np.array([s["v_search"] for s in samples], dtype=np.float32)
    vt = np.where(np.isnan(vs), z, (1.0 - value_mix) * z + value_mix * vs)
    b["pi"] = torch.from_numpy(pi).to(device)
    b["pw"] = torch.from_numpy(np.array([s["pw"] for s in samples], dtype=np.float32)).to(device)
    b["v_target"] = torch.from_numpy(vt.astype(np.float32)).to(device)
    return b


def losses(net, b: dict, value_weight: float = 1.0) -> tuple[torch.Tensor, dict]:
    logits, v = net(b["tiles"], b["glob"], b["act"], b["amask"])
    logp = torch.log_softmax(logits, -1)
    pl = -(b["pi"] * logp).sum(-1)
    pw = b["pw"]
    policy = (pw * pl).sum() / pw.sum().clamp(min=1.0)
    value = ((v - b["v_target"]) ** 2).mean()
    loss = policy + value_weight * value
    with torch.no_grad():
        sel = pw > 0
        top = logits.argmax(-1, keepdim=True)
        # top1: the network's favourite is the target's favourite; hit: it has target mass (warm start: the bot takes
        # that action this turn)
        top1 = (top.squeeze(1) == b["pi"].argmax(-1))[sel].float().mean() if sel.any() else torch.tensor(float("nan"))
        hit = (b["pi"].gather(1, top).squeeze(1) > 0)[sel].float().mean() if sel.any() else torch.tensor(float("nan"))
        ent = -(logp.exp() * logp.clamp(min=-30)).sum(-1).mean()
    return loss, {"loss": loss.item(), "policy": policy.item(), "value": value.item(), "top1": top1.item(), "hit": hit.item(), "entropy": ent.item()}
