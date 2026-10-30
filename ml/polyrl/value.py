"""Long-horizon value model: V(state) ~ expected final game reward for a seat (fit by ml/scripts/fit_value.py).

Features come from ml/sim/features.js through the simulator's metrics (`feat`). The model is a small MLP stored as a
.npz of numpy arrays, so scoring needs no extra dependencies.
"""

from __future__ import annotations

import json
from functools import lru_cache

import numpy as np


class ValueModel:
    def __init__(self, path: str):
        z = np.load(path)
        self.names = [str(n) for n in z["names"]]
        self.mu, self.sd = z["mu"], z["sd"]
        self.layers = []
        i = 0
        while f"w{i}" in z:
            self.layers.append((z[f"w{i}"], z[f"b{i}"]))
            i += 1
        self.target_weights = json.loads(str(z["target_weights"]))

    def __call__(self, feats) -> np.ndarray:
        x = np.atleast_2d(np.asarray(feats, dtype=np.float64))
        if x.shape[1] != len(self.names):
            raise ValueError(f"value model expects {len(self.names)} features, got {x.shape[1]}")
        h = (np.sign(x) * np.log1p(np.abs(x)) - self.mu) / self.sd
        for k, (w, b) in enumerate(self.layers):
            h = h @ w.T + b
            if k < len(self.layers) - 1:
                h = h / (1.0 + np.exp(-h))  # SiLU
        return h[:, 0]


@lru_cache(maxsize=4)
def load_value_model(path: str) -> ValueModel:
    return ValueModel(path)
