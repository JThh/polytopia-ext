"""Stage 1, supervised fine-tuning: teach the model to answer a Polytopia state with an action list and nothing else.

    python -m polyrl.sft --config ml/configs/sft.yaml [key=value ...]

Loss is token-level cross-entropy on the completion (the action list + EOS) only; prompts are context.
Writes <output_dir>/adapter (LoRA), <output_dir>/merged (base + LoRA folded, what RL and vLLM load), log.jsonl.
"""

from __future__ import annotations

import json
import math
import random
import time
from dataclasses import dataclass, field
from pathlib import Path

import torch

from . import config as C
from .formatting import encode_completion, encode_prompt, parse_actions, save_format
from .modeling import LoraConfig, ModelConfig, load_tokenizer, pad_batch, prepare, save_merged, token_batches, token_logprobs


@dataclass
class DataConfig:
    train_file: str = "ml/data/sft/train.jsonl"
    val_file: str | None = "ml/data/sft/val.jsonl"
    max_train_samples: int | None = None
    max_val_samples: int = 400
    gen_eval_samples: int = 16      # greedy answers on validation prompts: parse rate and overlap with the bot's actions
    chat_template: bool = False


@dataclass
class TrainConfig:
    lr: float = 1e-4
    weight_decay: float = 0.0
    warmup_ratio: float = 0.03
    min_lr_ratio: float = 0.1
    epochs: float = 1.0
    max_steps: int = -1
    max_tokens_per_batch: int = 16384  # padded tokens per micro-batch
    grad_accum: int = 4                # micro-batches per optimizer step
    max_grad_norm: float = 1.0
    log_every: int = 10
    eval_every: int = 200
    save_every: int = 1000
    seed: int = 0


@dataclass
class SFTConfig:
    model: ModelConfig = field(default_factory=ModelConfig)
    lora: LoraConfig = field(default_factory=LoraConfig)
    data: DataConfig = field(default_factory=DataConfig)
    train: TrainConfig = field(default_factory=TrainConfig)
    output_dir: str = "runs/sft"
    merge_at_end: bool = True
    wandb_project: str | None = None


def load_samples(path: str, tok, cfg: SFTConfig, limit: int | None, seed: int):
    rows = [json.loads(l) for l in open(path) if l.strip()]
    if limit and len(rows) > limit:
        random.Random(seed).shuffle(rows)
        rows = rows[:limit]
    out, dropped = [], 0
    for r in rows:
        p = encode_prompt(tok, r["prompt"], cfg.data.chat_template)
        c = encode_completion(tok, r["completion"])
        if len(p) + len(c) > cfg.model.max_length:
            dropped += 1
            continue
        out.append({"ids": p + c, "tgt": [0] * len(p) + [1] * len(c), "prompt_len": len(p), "row": r})
    return out, dropped


class Logger:
    def __init__(self, out: Path, wandb_project: str | None, cfg):
        self.f = open(out / "log.jsonl", "a")
        self.wb = None
        if wandb_project:
            try:
                import wandb

                self.wb = wandb.init(project=wandb_project, config=C.to_dict(cfg), dir=str(out))
            except Exception as e:  # logging must never stop training
                print("wandb disabled:", e)

    def __call__(self, step: int, **kv):
        kv = {"step": step, **{k: (round(v, 6) if isinstance(v, float) else v) for k, v in kv.items()}}
        print(json.dumps(kv), flush=True)
        self.f.write(json.dumps(kv) + "\n")
        self.f.flush()
        if self.wb:
            self.wb.log(kv, step=step)


def lr_at(step: int, total: int, t: TrainConfig) -> float:
    warm = max(1, int(total * t.warmup_ratio))
    if step < warm:
        return t.lr * (step + 1) / warm
    p = min(1.0, (step - warm) / max(1, total - warm))
    return t.lr * (t.min_lr_ratio + (1 - t.min_lr_ratio) * 0.5 * (1 + math.cos(math.pi * p)))


@torch.no_grad()
def evaluate(model, tok, val, cfg: SFTConfig, device) -> dict:
    model.eval()
    nll, n = 0.0, 0
    for b in token_batches([len(s["ids"]) for s in val], cfg.train.max_tokens_per_batch):
        ids, att, tgt = pad_batch([val[i]["ids"] for i in b], [val[i]["tgt"] for i in b], tok.pad_token_id, device)
        logp, mask = token_logprobs(model, ids, att, tgt)
        nll -= float((logp * mask).sum())
        n += int(mask.sum())
    res = {"val_loss": nll / max(1, n)}
    k = min(cfg.data.gen_eval_samples, len(val))
    if k:
        from .generation import GenConfig, HFGenerator

        gen = HFGenerator(model, tok, GenConfig(max_new_tokens=1024))
        parsed = ended = 0
        overlap = []
        for s in val[:k]:
            text = gen.generate([s["ids"][: s["prompt_len"]]], greedy=True)[0][0].text
            acts, ok = parse_actions(text)
            parsed += ok
            ended += bool(acts) and acts[-1] == ("tribe", "end_turn")
            ref, _ = parse_actions(s["row"]["completion"])
            ref_set = {repr(t) for t in ref}
            overlap.append(len([t for t in acts if repr(t) in ref_set]) / max(1, len(set(map(repr, acts)) | ref_set)))
        res.update(gen_parse_rate=parsed / k, gen_end_turn_rate=ended / k, gen_action_jaccard=sum(overlap) / k)
    model.train()
    return res


def main(cfg: SFTConfig) -> None:
    t = cfg.train
    random.seed(t.seed)
    torch.manual_seed(t.seed)
    out = Path(cfg.output_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "config.json").write_text(json.dumps(C.to_dict(cfg), indent=1))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    tok = load_tokenizer(cfg.model.name, cfg.model.trust_remote_code)
    train, dropped = load_samples(cfg.data.train_file, tok, cfg, cfg.data.max_train_samples, t.seed)
    val = []
    if cfg.data.val_file and Path(cfg.data.val_file).exists():
        val, _ = load_samples(cfg.data.val_file, tok, cfg, cfg.data.max_val_samples, t.seed)
    ntok = sum(len(s["ids"]) for s in train)
    print(f"train samples {len(train)} (dropped {dropped} over {cfg.model.max_length} tokens), {ntok / 1e6:.1f}M tokens; val {len(val)}")

    model = prepare(cfg.model, cfg.lora, device)
    model.train()
    params = [p for p in model.parameters() if p.requires_grad]
    print(f"trainable parameters: {sum(p.numel() for p in params) / 1e6:.1f}M")
    opt = torch.optim.AdamW(params, lr=t.lr, weight_decay=t.weight_decay, betas=(0.9, 0.99), fused=device.type == "cuda")

    lengths = [len(s["ids"]) for s in train]
    per_epoch = len(token_batches(lengths, t.max_tokens_per_batch, 0))
    total = t.max_steps if t.max_steps > 0 else max(1, math.ceil(per_epoch * t.epochs / min(t.grad_accum, per_epoch)))
    log = Logger(out, cfg.wandb_project, cfg)
    step, epoch, t0, seen_tok = 0, 0, time.time(), 0
    if not train:
        raise SystemExit("no training samples")
    while step < total:
        batches = token_batches(lengths, t.max_tokens_per_batch, t.seed + epoch)
        ga = min(t.grad_accum, len(batches))
        for g in range(0, len(batches) - ga + 1, ga):
            group = batches[g: g + ga]
            n_tgt = sum(sum(train[i]["tgt"]) for b in group for i in b)
            loss_sum = 0.0
            for b in group:
                ids, att, tgt = pad_batch([train[i]["ids"] for i in b], [train[i]["tgt"] for i in b], tok.pad_token_id, device)
                logp, mask = token_logprobs(model, ids, att, tgt)
                loss = -(logp * mask).sum() / n_tgt
                loss.backward()
                loss_sum += float(loss.detach())
                seen_tok += int(att.sum())
            gn = torch.nn.utils.clip_grad_norm_(params, t.max_grad_norm)
            for pg in opt.param_groups:
                pg["lr"] = lr_at(step, total, t)
            opt.step()
            opt.zero_grad(set_to_none=True)
            step += 1
            if step % t.log_every == 0 or step == 1:
                log(step, loss=loss_sum, grad_norm=float(gn), lr=opt.param_groups[0]["lr"], epoch=epoch, tok_per_s=seen_tok / (time.time() - t0))
            if val and (step % t.eval_every == 0 or step == total):
                log(step, **evaluate(model, tok, val, cfg, device))
            if step % t.save_every == 0:
                model.save_pretrained(out / f"checkpoint-{step}")
            if step >= total:
                break
        epoch += 1

    fmt = dict(chat_template=cfg.data.chat_template, base_model=cfg.model.name, stage="sft")
    if cfg.lora.enabled:
        model.save_pretrained(out / "adapter")
        tok.save_pretrained(out / "adapter")
        save_format(out / "adapter", **fmt)
        if cfg.merge_at_end:
            save_merged(model, tok, str(out / "merged"))
            save_format(out / "merged", **fmt)
    else:
        model.save_pretrained(out / "merged")
        tok.save_pretrained(out / "merged")
        save_format(out / "merged", **fmt)
    print("done:", out)


if __name__ == "__main__":
    main(C.cli(SFTConfig, description=__doc__))
