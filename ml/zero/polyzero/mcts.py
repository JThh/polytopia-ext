"""Gumbel AlphaZero search over one player's atomic actions (Danihelka et al., "Policy improvement by planning with
Gumbel", ICLR 2022), with the real simulator as the model.

The tree spans the searching player's own turn: every edge is one of its atomic actions, and end_turn leads to an
afterstate leaf that the value network scores (rivals' replies are folded into that value, which is trained on game
outcomes). There are no intermediate rewards and no discounting: a leaf's value is the expected final outcome.

    root     Gumbel-top-k sampling picks k candidate actions, sequential halving spends the simulation budget on
             them and keeps the better half each round; the action played is argmax(g + logits + sigma(q)).
    interior deterministic selection: argmax(pi'(a) - N(a) / (1 + sum N)), pi' = softmax(logits + sigma(q)).
    target   pi' at the root (softmax of logits plus transformed completed Q-values) is the policy target.

It works with a handful of simulations (8 to 32), which is what keeps self-play cheap. The search is a generator:
it yields lists of (parent, action) expansions and receives the evaluated child nodes, so a driver can batch the
leaves of many concurrent searches into one simulator call and one network call.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


@dataclass
class SearchConfig:
    simulations: int = 16       # budget per decision (full search)
    max_considered: int = 8     # root candidates (Gumbel top-k)
    c_visit: float = 50.0       # sigma(q) = (c_visit + max N) * c_scale * q01, the Gumbel MuZero transform
    c_scale: float = 1.0
    rescale: bool = False       # q01 = min-max over the node's Q-values (mctx default) instead of (q + 1) / 2. Min-max
                                # turns any Q gap, however small, into the full range: with an early, noisy value net
                                # that drowns the prior, so values are mapped by their known bounds [-1, 1] instead
    gumbel_scale: float = 1.0   # 1 for self-play (exploration), 0 for evaluation (deterministic)
    heuristic: float = 0.0      # leaf value = (1 - h) * value net + h * score-margin heuristic (applied in play.py;
                                # annealed during training: real credit for score gains while the value net is noisy)


def softmax(x: np.ndarray) -> np.ndarray:
    z = np.exp(x - x.max())
    return z / z.sum()


class Node:
    __slots__ = ("h", "legal", "logits", "prior", "value", "terminal", "N", "W", "children", "tiles", "glob")

    def __init__(self, h, legal, logits, value, terminal=False, tiles=None, glob=None):
        n = len(legal)
        self.h, self.legal, self.value, self.terminal = h, legal, float(value), terminal
        self.logits = np.asarray(logits, dtype=np.float64) if n else np.zeros(0)
        self.prior = softmax(self.logits) if n else self.logits
        self.N = np.zeros(n, dtype=np.int64)
        self.W = np.zeros(n, dtype=np.float64)
        self.children: list[Node | None] = [None] * n
        self.tiles, self.glob = tiles, glob


def completed_q(node: Node) -> np.ndarray:
    """Q for visited actions, the mixed value estimate for the rest (Gumbel MuZero, appendix D)."""
    visited = node.N > 0
    q = np.divide(node.W, node.N, out=np.zeros_like(node.W), where=visited)
    if not visited.any():
        return np.full(len(node.N), node.value)
    p = node.prior
    pv = p[visited].sum()
    sum_n = node.N.sum()
    mix = (node.value + sum_n * (p[visited] * q[visited]).sum() / max(pv, 1e-12)) / (1 + sum_n)
    return np.where(visited, q, mix)


def sigma(node: Node, cfg: SearchConfig) -> np.ndarray:
    cq = completed_q(node)
    if cfg.rescale:
        lo, hi = cq.min(), cq.max()
        cq = (cq - lo) / max(hi - lo, 1e-8)
    else:
        cq = (cq + 1.0) / 2.0
    return (cfg.c_visit + node.N.max(initial=0)) * cfg.c_scale * cq


def improved_policy(node: Node, cfg: SearchConfig) -> np.ndarray:
    return softmax(node.logits + sigma(node, cfg))


def mixed_value(node: Node) -> float:
    visited = node.N > 0
    if not visited.any():
        return node.value
    q = node.W[visited] / node.N[visited]
    p = node.prior[visited]
    sum_n = node.N.sum()
    return float((node.value + sum_n * (p * q).sum() / max(p.sum(), 1e-12)) / (1 + sum_n))


def _select(node: Node, cfg: SearchConfig) -> int:
    pi = improved_policy(node, cfg)
    return int(np.argmax(pi - node.N / (1.0 + node.N.sum())))


def _backup(path, v: float) -> None:
    for nd, a in path:
        nd.N[a] += 1
        nd.W[a] += v


def search(root: Node, cfg: SearchConfig, rng: np.random.Generator, simulations: int | None = None):
    """Generator: yields [(parent, action), ...], receives [child Node, ...] in the same order.
    Returns (action index, policy target over root.legal, root value estimate, simulations used)."""
    n_sims = cfg.simulations if simulations is None else simulations
    n = len(root.legal)
    g = rng.gumbel(size=n) * cfg.gumbel_scale if cfg.gumbel_scale > 0 else np.zeros(n)
    if n == 1 or n_sims <= 0:
        return int(np.argmax(g + root.logits)), root.prior.astype(np.float32), root.value, 0
    k = min(cfg.max_considered, n, n_sims)
    cand = list(np.argsort(-(g + root.logits), kind="stable")[:k])
    phases = max(1, math.ceil(math.log2(k)))
    used = 0
    for phase in range(phases):
        per = max(1, n_sims // (phases * len(cand)))
        if phase == phases - 1:
            per = max(per, (n_sims - used) // len(cand))
        for _ in range(per):
            # one simulation below each candidate; their subtrees are disjoint, so they run as one batch
            paths, jobs = [], []
            for a in cand:
                path, node = [(root, a)], root.children[a]
                while node is not None and not node.terminal:
                    b = _select(node, cfg)
                    path.append((node, b))
                    node = node.children[b]
                if node is None:
                    paths.append(path)
                    jobs.append(path[-1])
                else:
                    _backup(path, node.value)
            if jobs:
                children = yield jobs
                for path, (parent, a), ch in zip(paths, jobs, children):
                    parent.children[a] = ch
                    _backup(path, ch.value)
            used += len(cand)
        if len(cand) > 1:
            s = sigma(root, cfg)
            cand.sort(key=lambda a: -(g[a] + root.logits[a] + s[a]))
            cand = cand[: max(1, math.ceil(len(cand) / 2))]
    s = sigma(root, cfg)
    best = max(cand, key=lambda a: g[a] + root.logits[a] + s[a])
    return int(best), improved_policy(root, cfg).astype(np.float32), mixed_value(root), used


def handles(root: Node) -> list[int]:
    """Every simulator handle in the tree (to free them once the search is done)."""
    out, stack = [], [root]
    while stack:
        nd = stack.pop()
        if nd.h is not None:
            out.append(nd.h)
        stack.extend(c for c in nd.children if c is not None)
    return out
