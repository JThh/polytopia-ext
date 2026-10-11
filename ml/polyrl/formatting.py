"""How prompts and action lists become tokens, the same way in SFT, RL, evaluation and real-game play.

Default is plain text: tokens(prompt) + tokens(action list) + EOS, with no chat template, so the format does not
depend on the base model family. format.json, saved next to every checkpoint, records the choice so later stages
reuse it.
"""

from __future__ import annotations

import ast
import json
from pathlib import Path

STOP = ")]"  # every action list ends with ("tribe", "end_turn")]


def encode_prompt(tok, prompt: str, chat_template: bool = False) -> list[int]:
    if chat_template:
        msgs = [{"role": "user", "content": prompt}]
        try:
            ids = tok.apply_chat_template(msgs, add_generation_prompt=True, tokenize=True, enable_thinking=False)
        except TypeError:
            ids = tok.apply_chat_template(msgs, add_generation_prompt=True, tokenize=True)
        return list(ids["input_ids"] if isinstance(ids, dict) else ids)
    return tok(prompt, add_special_tokens=True)["input_ids"]


def encode_completion(tok, completion: str) -> list[int]:
    return tok(completion, add_special_tokens=False)["input_ids"] + [tok.eos_token_id]


def parse_actions(text: str):
    """Python-side parse of a model answer (the simulator's parser is the reference; this one needs no Node).
    Returns (list of tuples, complete)."""
    s = text.strip()
    end = s.find(STOP)
    if end >= 0:
        s = s[: end + len(STOP)]
    try:
        v = ast.literal_eval(s)
        if isinstance(v, list) and all(isinstance(t, tuple) for t in v):
            return v, True
    except (ValueError, SyntaxError, MemoryError, RecursionError):
        pass
    # salvage complete tuples from a cut-off list
    out = []
    for line in s.lstrip("[").split("\n"):
        line = line.strip().rstrip(",").rstrip("]")
        try:
            v = ast.literal_eval(line)
            if isinstance(v, tuple):
                out.append(v)
        except (ValueError, SyntaxError, MemoryError, RecursionError):
            break
    return out, False


def save_format(path: str | Path, **info) -> None:
    Path(path).mkdir(parents=True, exist_ok=True)
    (Path(path) / "format.json").write_text(json.dumps(info, indent=1))


def load_format(path: str | Path) -> dict:
    p = Path(path) / "format.json"
    return json.loads(p.read_text()) if p.exists() else {}
