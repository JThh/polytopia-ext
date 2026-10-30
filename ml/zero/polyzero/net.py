"""PolyNet: a small convolutional network over the board with a pointer-style policy head and a value head.

    tiles [B, H, W, F] (categorical bytes) + glob [B, G] -> per-tile features h [B, H*W + 1, C] (last = tribe token)
    policy: logit(verb, src, dst, arg) = MLP(Ws h[src] + Wd h[dst] + E[verb] + E[arg] + Wg g)   for each legal action
    value:  tanh(MLP(g)), g = pooled board + globals: the expected outcome for the player to move, in [-1, 1]

Scoring legal actions instead of a fixed output layer keeps the head tiny and lets one network cover every map size
and every action the game has. The default size (48 channels, 4 residual blocks, about 0.25M parameters) runs at
self-play speed on a laptop CPU; Apple-silicon Macs can train it on the GPU through PyTorch's "mps" device.
Residual blocks use a learned zero-initialised gain instead of batch norm, so batches of mixed map sizes (cropped to
the largest map in the batch, see `collate`) behave the same at training and inference time.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class NetConfig:
    channels: int = 48
    blocks: int = 4
    policy_hidden: int = 96
    value_hidden: int = 96


def pick_device(name: str = "auto") -> torch.device:
    if name != "auto":
        return torch.device(name)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


class ResBlock(nn.Module):
    def __init__(self, c: int):
        super().__init__()
        self.c1 = nn.Conv2d(c, c, 3, padding=1)
        self.c2 = nn.Conv2d(c, c, 3, padding=1)
        self.gain = nn.Parameter(torch.zeros(1))

    def forward(self, x, m):
        y = self.c2(F.relu(self.c1(x)) * m)
        return F.relu(x + self.gain * y) * m


class PolyNet(nn.Module):
    def __init__(self, spec: dict, cfg: NetConfig):
        super().__init__()
        self.spec, self.cfg = spec, cfg
        sizes = [s for _, s in spec["fields"]]
        C, H, Hv, G = cfg.channels, cfg.policy_hidden, cfg.value_hidden, len(spec["glob"])
        self.register_buffer("offsets", torch.tensor(np.cumsum([0] + sizes[:-1]), dtype=torch.long), persistent=False)
        self.embed = nn.Embedding(sum(sizes), C)
        self.glob_in = nn.Linear(G, C)
        self.stem = nn.Conv2d(C, C, 3, padding=1)
        self.blocks = nn.ModuleList(ResBlock(C) for _ in range(cfg.blocks))
        self.pool = nn.Linear(2 * C + G, C)
        self.g_tok = nn.Linear(C, C)
        self.p_src = nn.Linear(C, H)
        self.p_dst = nn.Linear(C, H, bias=False)
        self.p_g = nn.Linear(C, H, bias=False)
        self.p_verb = nn.Embedding(len(spec["verbs"]), H)
        self.p_arg = nn.Embedding(len(spec["args"]), H)
        self.p_out = nn.Sequential(nn.ReLU(), nn.Linear(H, H), nn.ReLU(), nn.Linear(H, 1))
        self.v = nn.Sequential(nn.Linear(C, Hv), nn.ReLU(), nn.Linear(Hv, 1))

    def forward(self, tiles, glob, act, amask):
        B, Hc, Wc, _ = tiles.shape
        C = self.cfg.channels
        x = self.embed(tiles + self.offsets).sum(3) + self.glob_in(glob)[:, None, None, :]
        x = x.permute(0, 3, 1, 2).contiguous()
        m = (tiles[..., 0] != 0).unsqueeze(1).to(x.dtype)
        x = F.relu(self.stem(x * m)) * m
        for b in self.blocks:
            x = b(x, m)
        cnt = m.sum((2, 3)).clamp(min=1.0)
        mean = x.sum((2, 3)) / cnt
        mx = (x - (1.0 - m) * 1e4).amax((2, 3))
        g = F.relu(self.pool(torch.cat([mean, mx, glob], 1)))
        h = torch.cat([x.flatten(2).transpose(1, 2), self.g_tok(g)[:, None, :]], 1)
        gs = torch.gather(h, 1, act[..., 1:2].expand(-1, -1, C))
        gd = torch.gather(h, 1, act[..., 2:3].expand(-1, -1, C))
        z = self.p_src(gs) + self.p_dst(gd) + self.p_verb(act[..., 0]) + self.p_arg(act[..., 3]) + self.p_g(g)[:, None, :]
        logits = self.p_out(z).squeeze(-1).masked_fill(~amask, -1e9)
        value = torch.tanh(self.v(g).squeeze(-1))
        return logits, value


def collate(tiles: list[np.ndarray], globs: list[np.ndarray], legals: list[np.ndarray], pad: int, device) -> dict:
    """Stack samples into tensors, cropped to the largest map in the batch (maps sit in the top-left corner of the
    PAD x PAD grid). Action positions are re-indexed to the crop; the tribe token goes last."""
    B = len(tiles)
    t = np.stack(tiles).reshape(B, pad, pad, -1)
    on = t[..., 0] != 0
    rows, cols = on.any(axis=(0, 2)), on.any(axis=(0, 1))
    Hc, Wc = (int(rows.nonzero()[0].max()) + 1, int(cols.nonzero()[0].max()) + 1) if on.any() else (1, 1)
    t = t[:, :Hc, :Wc]
    A = max(1, max(len(l) for l in legals))
    act = np.zeros((B, A, 4), dtype=np.int64)
    amask = np.zeros((B, A), dtype=bool)
    glob_tok = pad * pad
    for i, l in enumerate(legals):
        if not len(l):
            continue
        q = l.astype(np.int64)
        for c in (1, 2):
            p = q[:, c]
            q[:, c] = np.where(p == glob_tok, Hc * Wc, (p // pad) * Wc + p % pad)
        act[i, :len(q)] = q
        amask[i, :len(q)] = True
    return {
        "tiles": torch.from_numpy(np.ascontiguousarray(t).astype(np.int64)).to(device),
        "glob": torch.from_numpy(np.stack(globs).astype(np.float32)).to(device),
        "act": torch.from_numpy(act).to(device),
        "amask": torch.from_numpy(amask).to(device),
    }


class Evaluator:
    """Batched inference for the search: items of (tiles, glob, legal) -> per-item logits (numpy) and values."""

    def __init__(self, net: PolyNet, device):
        self.net, self.device = net.eval(), device
        self.pad = net.spec["pad"]
        self.calls = self.items = 0

    @torch.no_grad()
    def __call__(self, tiles, globs, legals):
        if not tiles:
            return [], np.zeros(0, dtype=np.float32)
        b = collate(tiles, globs, legals, self.pad, self.device)
        logits, value = self.net(b["tiles"], b["glob"], b["act"], b["amask"])
        logits, value = logits.float().cpu().numpy(), value.float().cpu().numpy()
        self.calls += 1
        self.items += len(tiles)
        return [logits[i, :len(l)] for i, l in enumerate(legals)], value


def save(net: PolyNet, path, **extra) -> None:
    torch.save({"state_dict": net.state_dict(), "net": asdict(net.cfg), "spec": net.spec, **extra}, path)


def load(path, device="cpu") -> tuple[PolyNet, dict]:
    ck = torch.load(path, map_location="cpu", weights_only=False)
    net = PolyNet(ck["spec"], NetConfig(**ck["net"]))
    net.load_state_dict(ck["state_dict"])
    return net.to(device), ck


def n_params(net: nn.Module) -> int:
    return sum(p.numel() for p in net.parameters())
