"""Game-playing workers: each owns one Node simulator and plays a list of game specs with checkpoints from disk.

Specs travel as plain dicts so they can be sent to other processes: {seats | plan, seed, sample, max_turns, tag}, as
in play.GameSpec. Net seats are labelled "net:<agent>": "net:learner" (current weights, samples recorded),
"net:eval" (current weights, full deterministic search, nothing recorded) and "net:past:<checkpoint path>" (an older
snapshot, nothing recorded).
"""

from __future__ import annotations

import os
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict
import multiprocessing as mp

import numpy as np

_STATE: dict = {}


def _init(rules: str, threads: int) -> None:
    import torch

    torch.set_num_threads(threads)
    from .sim import Sim

    _STATE["sim"] = Sim(rules=rules)
    _STATE["nets"] = {}


def _evaluator(path: str, device: str):
    from .net import Evaluator, load

    key = (path, os.path.getmtime(path), device)
    nets = _STATE["nets"]
    if key not in nets:
        for k in [k for k in nets if k[0] == path]:
            del nets[k]
        if len(nets) > 12:
            nets.pop(next(iter(nets)))
        net, _ = load(path, device)
        rules = _STATE["sim"].spec["rules"]
        if net.spec.get("rules") != rules or net.spec["fields"] != _STATE["sim"].spec["fields"]:
            raise ValueError(f"{path} was trained under the {net.spec.get('rules')} rules, the simulator runs {rules}")
        nets[key] = Evaluator(net, device)
    return nets[key]


def run_specs(job: dict) -> list[dict]:
    """job = {specs, weights, device, search, eval_search, play, seed}"""
    from .mcts import SearchConfig
    from .play import Agent, GameSpec, PlayConfig, play

    if "sim" not in _STATE:
        _init(job.get("rules", "polytopia_live"), job.get("threads", 1))
    dev = job.get("device", "cpu")
    search, eval_search, pcfg = SearchConfig(**job["search"]), SearchConfig(**job["eval_search"]), PlayConfig(**job["play"])
    agents = {}

    def agent(label: str) -> Agent:
        if label not in agents:
            name = label[4:]
            if name == "learner":
                agents[label] = Agent(_evaluator(job["weights"], dev), search, record=True, name=name)
            elif name == "eval":
                agents[label] = Agent(_evaluator(job["weights"], dev), eval_search, record=False, full=True, name=name)
            elif name.startswith("past:"):
                agents[label] = Agent(_evaluator(name[5:], dev), search, record=False, name=name)
            else:
                raise ValueError(f"unknown agent {label}")
        return agents[label]

    specs = []
    for s in job["specs"]:
        labels = list(s.get("seats") or []) + [v for k, v in (s.get("plan") or {}).items() if k != "main_seat"]
        specs.append(GameSpec(agents={l: agent(l) for l in labels if l.startswith("net")}, seed=s["seed"], seats=s.get("seats"), plan=s.get("plan"),
                              sample=s.get("sample"), settings=s.get("settings"), max_turns=s.get("max_turns"), tag=s.get("tag", {})))
    return play(_STATE["sim"], specs, pcfg, np.random.default_rng(job["seed"]))


class Pool:
    """`workers` processes (0: play in this process). Spawned, not forked, so it behaves the same on macOS."""

    def __init__(self, workers: int, rules: str = "polytopia_live", threads: int = 1):
        self.workers, self.rules, self.threads = workers, rules, threads
        self.ex = ProcessPoolExecutor(workers, mp_context=mp.get_context("spawn"), initializer=_init, initargs=(rules, threads)) if workers > 0 else None

    def run(self, specs: list[dict], weights: str, search, eval_search, play, device: str = "cpu", seed: int = 0) -> list[dict]:
        base = {"weights": weights, "device": device, "search": asdict(search), "eval_search": asdict(eval_search), "play": asdict(play),
                "rules": self.rules, "threads": self.threads}
        if self.ex is None:
            return run_specs(dict(base, specs=specs, seed=seed))
        n = max(1, min(self.workers, len(specs)))
        chunks = [specs[i::n] for i in range(n)]
        futs = [self.ex.submit(run_specs, dict(base, specs=c, seed=seed * 1000 + i)) for i, c in enumerate(chunks) if c]
        out = []
        for f in futs:
            out.extend(f.result())
        return out

    def close(self) -> None:
        if self.ex is not None:
            self.ex.shutdown(cancel_futures=True)
        elif "sim" in _STATE:
            _STATE.pop("sim").close()
            _STATE.pop("nets", None)
