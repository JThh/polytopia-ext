"""End to end on CPU with a tiny network: bot data -> warm start -> self-play iterations (league) -> evaluation.
Checks the plumbing, not playing strength (about a minute)."""

import json
import subprocess
from pathlib import Path

import pytest

from polyzero import train

ZERO = Path(__file__).resolve().parent.parent
TINY = "{sizes: {tiny: 1}, players: [2, 2], modes: {score: 1}, turnLimits: [5]}"


@pytest.mark.slow
def test_warm_start_selfplay_eval(tmp_path):
    bc = tmp_path / "bc"
    r = subprocess.run(["node", str(ZERO / "sim" / "gen_bc.js"), "--games", "6", "--workers", "2", "--keep", "0.3", "--out", str(bc),
                        "--constraints", '{"sizes":{"tiny":1},"players":[2,2],"turnLimits":[8],"modes":{"score":1}}'],
                       capture_output=True, text=True, check=True)
    assert json.loads(r.stdout.strip().splitlines()[-1])["samples"] > 50

    out = tmp_path / "run"
    args = [f"output_dir={out}", f"warm_start.data={bc}", "warm_start.epochs=1", "warm_start.val_every=3", "optim.batch_size=32",
            "net.channels=16", "net.blocks=1", "net.policy_hidden=16", "net.value_hidden=16",
            "iterations=2", "workers=0", "min_buffer=1", "eval_every=2", "device=cpu",
            "selfplay.games_per_iter=3", "selfplay.snapshot_every=1", "selfplay.search.simulations=4", "selfplay.play.fast_simulations=2",
            "selfplay.play.concurrent=3", "selfplay.opponents={self: 1, past: 1, 'bot:crazy': 1}",
            f"selfplay.curriculum=[{{until: null, sample: {TINY}}}]",
            f"eval.suites=[{{name: duel_tiny, games: 2, sample: {TINY}}}]", "eval.search.simulations=4"]
    train.main(args)

    rows = [json.loads(l) for l in (out / "log.jsonl").read_text().splitlines()]
    assert rows[0]["phase"] == "warm_start"
    sp = [r for r in rows if r["phase"] == "selfplay"]
    assert len(sp) == 2 and all(r["positions"] > 0 for r in sp) and sp[-1]["steps"] > 0
    assert (out / "warm_start.pt").exists() and (out / "latest.pt").exists() and len(list((out / "league").glob("*.pt"))) == 2
    ev = json.loads((out / "eval.jsonl").read_text().splitlines()[-1])
    suite = ev["suites"]["duel_tiny"]
    assert set(suite) == {"net:eval", "bot:crazy", "bot:hard"}
    assert suite["net:eval"]["games"] == 2 and "vs_bot:crazy" in suite["net:eval"]

    # resuming continues from the saved iteration
    train.main([a.replace("iterations=2", "iterations=3") for a in args])
    rows = [json.loads(l) for l in (out / "log.jsonl").read_text().splitlines()]
    assert [r["iteration"] for r in rows if r["phase"] == "selfplay"] == [1, 2, 3]
