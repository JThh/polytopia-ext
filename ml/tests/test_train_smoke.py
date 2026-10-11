"""End-to-end CPU smoke test: tiny random Qwen3.5 (vision tower included, like the real checkpoint) -> SFT -> merge
-> RL iteration -> evaluation. Checks the plumbing, not playing strength. Skipped without torch/transformers."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("transformers")
pytest.importorskip("peft")

ML = Path(__file__).resolve().parent.parent
GAME = {"sizes": {"tiny": 1}, "players": [2, 2], "modes": {"score": 1}, "turnLimits": [3]}


def run(*args, cwd=None):
    r = subprocess.run([sys.executable, *args], cwd=cwd or ML, capture_output=True, text=True, env={"PYTHONPATH": str(ML), "PATH": "/usr/local/bin:/usr/bin:/bin"})
    assert r.returncode == 0, r.stdout[-3000:] + r.stderr[-3000:]
    return r.stdout


@pytest.mark.slow
def test_pipeline(tmp_path):
    data = tmp_path / "sft"
    subprocess.run(["node", str(ML / "sim" / "gen_sft.js"), "--games", "6", "--out", str(data), "--val-every", "3"], check=True, capture_output=True)
    run(str(ML / "scripts" / "make_tiny_model.py"), "--data", str(data / "train.jsonl"), "--out", str(tmp_path / "tiny"), "--multimodal")
    out = run("-m", "polyrl.sft", f"model.name={tmp_path / 'tiny'}", f"data.train_file={data / 'train.jsonl'}", f"data.val_file={data / 'val.jsonl'}",
              "data.max_train_samples=16", "data.max_val_samples=4", "data.gen_eval_samples=1", "train.max_steps=2", "train.eval_every=2",
              "train.max_tokens_per_batch=8192", "train.grad_accum=1", "lora.r=4", "lora.alpha=8", f"output_dir={tmp_path / 'sft-run'}")
    assert (tmp_path / "sft-run" / "merged" / "format.json").exists()
    losses = [json.loads(l)["loss"] for l in out.splitlines() if l.startswith('{"step"') and '"loss"' in l]
    assert losses and all(x == x for x in losses)  # finite
    out = run("-m", "polyrl.rl", f"model.name={tmp_path / 'sft-run' / 'merged'}", f"targets={data / 'targets.json'}", f"output_dir={tmp_path / 'rl-run'}",
              "iterations=1", "trunks=2", "group_size=2", "teacher_in_group=true", "gen.max_new_tokens=24", "sim_procs=1", "eval_every=0", "lora.r=4", "lora.alpha=8",
              "curriculum=" + json.dumps([{"until": None, "sample": GAME}]))
    log = [json.loads(l) for l in out.splitlines() if l.startswith('{"step"')]
    assert log and log[-1]["model_turns"] > 0 and log[-1]["trained_samples"] > 0
    assert (tmp_path / "rl-run" / "merged" / "format.json").exists()
    out = run("-m", "polyrl.evaluate", f"model.name={tmp_path / 'rl-run' / 'merged'}", f"targets={data / 'targets.json'}", "games=1", "gen.max_new_tokens=16",
              "sim_procs=1", "sample=" + json.dumps(GAME))
    assert '"baseline"' in out and '"paired"' in out
