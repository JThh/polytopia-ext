"""Fit the long-horizon value model V(state) ~ E[final game reward | state] on bot games from ml/sim/gen_value.js.

The target is the RL game reward computed from how the seat's game ended (weights below, matching
ml/configs/rl_longterm_v4.yaml), so a change in V over a turn is that turn's contribution to the final outcome.
Model: signed-log + standardized features -> MLP. Games are split into train / held-out, never states.

    PYTHONPATH=ml python ml/scripts/fit_value.py --data runs/value/data --out runs/value/value_v1.npz
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import random
from pathlib import Path

import numpy as np
import torch

W = {"win": 3.0, "rank": 1.5, "survive": 1.0, "score": 0.5, "final_scale": 3000.0}


def target(r: dict) -> float:
    n = r["n"]
    return (W["win"] * r["won"] + W["rank"] * (n - r["rank"]) / max(1, n - 1) + W["survive"] * r["alive"]
            + W["score"] * r["score"] / W["final_scale"])


def slog(x: np.ndarray) -> np.ndarray:
    return np.sign(x) * np.log1p(np.abs(x))


def load(data: str):
    rows = []
    for f in sorted(glob.glob(str(Path(data) / "*shard-*.jsonl"))):
        src = Path(f).name.split("shard-")[0]  # several generator runs can share a folder (prefix-shard-N.jsonl)
        for l in open(f):
            r = json.loads(l)
            r["g"] = f"{src}{r['g']}"
            rows.append(r)
    names = json.loads((Path(data) / "features.json").read_text())["names"]
    X = np.array([r["f"] for r in rows], dtype=np.float64)
    y = np.array([target(r) for r in rows], dtype=np.float64)
    meta = {k: np.array([r[k] for r in rows]) for k in ("g", "won", "rank", "n", "alive", "pert", "setup", "turn")}
    return names, X, y, meta


def auc(score: np.ndarray, label: np.ndarray) -> float:
    order = np.argsort(score)
    ranks = np.empty(len(score))
    ranks[order] = np.arange(1, len(score) + 1)
    pos = label == 1
    n1, n0 = pos.sum(), (~pos).sum()
    return float((ranks[pos].sum() - n1 * (n1 + 1) / 2) / max(1, n1 * n0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="runs/value/data")
    ap.add_argument("--out", default="runs/value/value_v1.npz")
    ap.add_argument("--hidden", type=int, default=128)
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--threads", type=int, default=4)
    a = ap.parse_args()
    torch.set_num_threads(a.threads)
    torch.manual_seed(a.seed)
    names, X, y, meta = load(a.data)
    games = sorted(set(meta["g"].tolist()))
    random.Random(a.seed).shuffle(games)
    held = set(games[: len(games) * 15 // 100])
    te = np.array([g in held for g in meta["g"]])
    Z = slog(X)
    mu, sd = Z[~te].mean(0), Z[~te].std(0) + 1e-6
    Z = (Z - mu) / sd
    Xt, yt = torch.tensor(Z[~te], dtype=torch.float32), torch.tensor(y[~te], dtype=torch.float32)
    Xv, yv = torch.tensor(Z[te], dtype=torch.float32), torch.tensor(y[te], dtype=torch.float32)
    h = a.hidden
    net = torch.nn.Sequential(torch.nn.Linear(Z.shape[1], h), torch.nn.SiLU(), torch.nn.Linear(h, h), torch.nn.SiLU(), torch.nn.Linear(h, 1))
    opt = torch.optim.AdamW(net.parameters(), lr=1e-3, weight_decay=1e-4)
    steps = a.epochs * math.ceil(len(Xt) / 1024)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=steps)
    for ep in range(a.epochs):
        perm = torch.randperm(len(Xt))
        net.train()
        for i in range(0, len(Xt), 1024):
            idx = perm[i: i + 1024]
            loss = torch.nn.functional.mse_loss(net(Xt[idx]).squeeze(-1), yt[idx])
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
        net.eval()
        with torch.no_grad():
            pv = net(Xv).squeeze(-1)
            mse = float(((pv - yv) ** 2).mean())
        print(json.dumps({"epoch": ep + 1, "val_mse": round(mse, 4), "val_r2": round(1 - mse / float(yv.var()), 4)}), flush=True)

    with torch.no_grad():
        p = net(Xv).squeeze(-1).numpy()
    yh = y[te]
    rep = {"rows_train": int((~te).sum()), "rows_heldout": int(te.sum()), "games_heldout": len(held),
           "r2": 1 - float(((p - yh) ** 2).mean() / yh.var()), "win_auc": auc(p, meta["won"][te]),
           "target_weights": W}
    frac = X[te][:, names.index("frac_elapsed")]
    rep["by_phase"] = {}
    for lo, hi in ((0, 0.25), (0.25, 0.5), (0.5, 0.75), (0.75, 1.01)):
        m = (frac >= lo) & (frac < hi)
        rep["by_phase"][f"{lo:.2f}-{min(hi, 1):.2f}"] = {"rows": int(m.sum()), "r2": round(1 - float(((p[m] - yh[m]) ** 2).mean() / yh[m].var()), 3),
                                                        "win_auc": round(auc(p[m], meta["won"][te][m]), 3)}
    print(json.dumps(rep, indent=1))
    layers = [m for m in net if isinstance(m, torch.nn.Linear)]
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    np.savez(a.out, names=np.array(names), mu=mu, sd=sd, target_weights=json.dumps(W), report=json.dumps(rep),
             **{f"w{i}": l.weight.detach().numpy().astype(np.float64) for i, l in enumerate(layers)},
             **{f"b{i}": l.bias.detach().numpy().astype(np.float64) for i, l in enumerate(layers)})
    print("saved", a.out)


if __name__ == "__main__":
    main()
