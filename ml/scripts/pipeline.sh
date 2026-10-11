#!/usr/bin/env bash
# The full recipe on one A100 40GB, from the repository root:  bash ml/scripts/pipeline.sh
# Each stage can also be run on its own; see ml/README.md.
set -euo pipefail
export PYTHONPATH=ml
WORKERS=${WORKERS:-$(nproc)}

# 0. dependencies (once): Node 18+, then
#    pip install -e "ml[qwen35,dev]"      # add ,vllm for fast RL rollouts (gen.backend=vllm)

# 1. compact SFT set from bot-vs-bot games under Polytopia rules (CPU; ~3000 games)
node ml/sim/gen_sft.js --games 3000 --keep 0.25 --workers "$WORKERS" --out ml/data/sft --seed 1

# 2. supervised fine-tuning: state -> action list
python -m polyrl.sft --config ml/configs/sft.yaml

# 3. how the SFT model plays (paired with the hard bot on the same games)
python -m polyrl.evaluate --config ml/configs/eval.yaml model.name=runs/sft-qwen3.5-4b/merged out=runs/eval-sft.json

# 4. simulation-based RL against the bots
python -m polyrl.rl --config ml/configs/rl.yaml

# 5. final evaluation
python -m polyrl.evaluate --config ml/configs/eval.yaml
