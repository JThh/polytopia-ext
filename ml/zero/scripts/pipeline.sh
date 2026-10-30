#!/usr/bin/env bash
# PolyZero end to end: warm-start data -> training (warm start, then self-play iterations) -> evaluation.
# Run from the repository root. CONFIG defaults to the MacBook Air recipe.
set -euo pipefail
CONFIG=${CONFIG:-ml/zero/configs/macbook.yaml}
OUT=${OUT:-runs/zero}
WORKERS=${WORKERS:-6}
export PYTHONPATH=ml/zero${PYTHONPATH:+:$PYTHONPATH}

if [ ! -f "$OUT/bc/bc-0.json" ]; then
  node ml/zero/sim/gen_bc.js --games "${BC_GAMES:-2000}" --workers "$WORKERS" --keep 0.08 --out "$OUT/bc"
fi
python -m polyzero.train --config "$CONFIG" output_dir="$OUT" warm_start.data="$OUT/bc" workers="$WORKERS" "$@"
python -m polyzero.evaluate --config ml/zero/configs/eval.yaml weights="$OUT/latest.pt" out="$OUT/eval-final.jsonl" workers="$WORKERS"
