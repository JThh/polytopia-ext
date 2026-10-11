"""Model loading, LoRA, and token log-probabilities.

Works for text-only causal LMs (Qwen3) and for the multimodal checkpoints of Qwen3.5 / Gemma 4 used text-only:
the loader tries the causal-LM auto class first and falls back to the image-text-to-text one, and LoRA only targets
linear layers of the language model (vision / audio towers and the LM head stay frozen).
"""

from __future__ import annotations

import inspect
import re
from dataclasses import dataclass, field

import torch
import torch.nn as nn


@dataclass
class ModelConfig:
    name: str = "Qwen/Qwen3.5-4B"          # HF id or local path (for RL: the merged SFT model)
    dtype: str = "bfloat16"
    attn_implementation: str | None = None  # e.g. "flash_attention_2" or "sdpa"; None = library default
    gradient_checkpointing: bool = True
    trust_remote_code: bool = False
    max_length: int = 6144                  # prompt + completion tokens


@dataclass
class LoraConfig:
    enabled: bool = True
    r: int = 64
    alpha: int = 128
    dropout: float = 0.05
    # linear layers whose qualified name matches any of these stay frozen
    exclude: list[str] = field(default_factory=lambda: ["vision", "visual", "audio", "image", "mm_projector", "multi_modal", "lm_head", "embed"])
    init_adapter: str | None = None         # start from an existing adapter (e.g. continue SFT)


DTYPES = {"bfloat16": torch.bfloat16, "float16": torch.float16, "float32": torch.float32}


def load_tokenizer(name: str, trust_remote_code: bool = False):
    from transformers import AutoTokenizer

    tok = AutoTokenizer.from_pretrained(name, trust_remote_code=trust_remote_code)
    if tok.pad_token_id is None:
        tok.pad_token = tok.eos_token
    return tok


def load_model(cfg: ModelConfig, device: str | torch.device | None = None):
    import transformers

    kw = dict(trust_remote_code=cfg.trust_remote_code)
    if cfg.attn_implementation:
        kw["attn_implementation"] = cfg.attn_implementation
    classes = [getattr(transformers, n) for n in ("AutoModelForCausalLM", "AutoModelForImageTextToText", "AutoModelForMultimodalLM") if hasattr(transformers, n)]
    errors = []
    model = None
    for cls in classes:
        try:
            try:
                model = cls.from_pretrained(cfg.name, dtype=DTYPES[cfg.dtype], **kw)
            except TypeError:  # older transformers
                model = cls.from_pretrained(cfg.name, torch_dtype=DTYPES[cfg.dtype], **kw)
            break
        except (ValueError, KeyError) as e:  # architecture not registered for this auto class
            errors.append(f"{cls.__name__}: {e}")
    if model is None:
        raise RuntimeError("could not load " + cfg.name + ":\n" + "\n".join(errors))
    if device is not None:
        model.to(device)
    model.config.use_cache = False
    return model


def lora_target_regex(model: nn.Module, exclude: list[str]) -> str:
    """Regex over module names: every nn.Linear outside the excluded parts (vision tower, LM head ...)."""
    bad = re.compile("|".join(re.escape(e) for e in exclude), re.I) if exclude else None
    suffixes = set()
    for name, mod in model.named_modules():
        if isinstance(mod, nn.Linear) and not (bad and bad.search(name)):
            suffixes.add(name.rsplit(".", 1)[-1])
    if not suffixes:
        raise RuntimeError("no linear layers found for LoRA")
    neg = "(?!.*(" + "|".join(re.escape(e) for e in exclude) + "))" if exclude else ""
    return r"^" + neg + r".*\.(" + "|".join(sorted(re.escape(s) for s in suffixes)) + r")$"


def apply_lora(model: nn.Module, cfg: LoraConfig, gradient_checkpointing: bool = True):
    from peft import LoraConfig as PeftLoraConfig, PeftModel, get_peft_model

    if gradient_checkpointing:
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
        model.enable_input_require_grads()
    if cfg.init_adapter:
        return PeftModel.from_pretrained(model, cfg.init_adapter, is_trainable=True)
    pc = PeftLoraConfig(r=cfg.r, lora_alpha=cfg.alpha, lora_dropout=cfg.dropout, target_modules=lora_target_regex(model, cfg.exclude),
                        bias="none", task_type="CAUSAL_LM")
    return get_peft_model(model, pc)


def prepare(model_cfg: ModelConfig, lora_cfg: LoraConfig, device):
    model = load_model(model_cfg, device)
    if lora_cfg.enabled:
        model = apply_lora(model, lora_cfg, model_cfg.gradient_checkpointing)
    elif model_cfg.gradient_checkpointing:
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    return model


def _base(model):
    m = model
    while hasattr(m, "get_base_model"):
        m = m.get_base_model()
    return m


def supports_logits_to_keep(model) -> bool:
    try:
        return "logits_to_keep" in inspect.signature(_base(model).forward).parameters
    except (TypeError, ValueError):
        return False


def token_logprobs(model, input_ids: torch.Tensor, attention_mask: torch.Tensor, target_mask: torch.Tensor, temperature: float = 1.0):
    """Log-probabilities of the target tokens (target_mask == 1) under the model, computing logits only for the tail
    of the sequence that holds them (prompts are long, vocabularies are big).

    input_ids, attention_mask, target_mask: [B, L], right-padded.
    Returns (logp [B, K], mask [B, K]) aligned to positions L-K .. L-1.
    """
    L = input_ids.shape[1]
    first = int(target_mask.float().argmax(dim=1)[target_mask.any(dim=1)].min().item()) if target_mask.any() else L - 1
    first = max(first, 1)  # token 0 has no prediction
    keep = L - first + 1   # logits at positions first-1 .. L-1
    kw = dict(input_ids=input_ids, attention_mask=attention_mask, use_cache=False)
    if supports_logits_to_keep(model):
        logits = model(**kw, logits_to_keep=keep).logits
    else:
        logits = model(**kw).logits[:, -keep:]
    logits = logits[:, :-1]                      # predicts tokens at positions first .. L-1
    targets = input_ids[:, L - keep + 1:]
    mask = target_mask[:, L - keep + 1:]
    out = torch.empty(targets.shape, dtype=torch.float32, device=logits.device)
    for b in range(logits.shape[0]):            # row by row keeps the float32 copy small
        lg = logits[b].float()
        if temperature != 1.0:
            lg = lg / temperature
        out[b] = lg.gather(-1, targets[b].unsqueeze(-1)).squeeze(-1) - torch.logsumexp(lg, dim=-1)
    return out, mask


def pad_batch(seqs: list[list[int]], targets: list[list[int]], pad_id: int, device):
    """Right-pad token lists; targets are 0/1 masks of the same lengths."""
    L = max(len(s) for s in seqs)
    ids = torch.full((len(seqs), L), pad_id, dtype=torch.long)
    att = torch.zeros((len(seqs), L), dtype=torch.long)
    tgt = torch.zeros((len(seqs), L), dtype=torch.long)
    for i, (s, t) in enumerate(zip(seqs, targets)):
        ids[i, : len(s)] = torch.tensor(s)
        att[i, : len(s)] = 1
        tgt[i, : len(t)] = torch.tensor(t)
    return ids.to(device), att.to(device), tgt.to(device)


def token_batches(lengths: list[int], max_tokens: int, shuffle_seed: int | None = None, window: int = 256) -> list[list[int]]:
    """Group sample indices into micro-batches of at most max_tokens padded tokens, sorting by length inside windows
    of `window` samples so padding stays low while order stays random."""
    import random

    idx = list(range(len(lengths)))
    rng = random.Random(shuffle_seed)
    if shuffle_seed is not None:
        rng.shuffle(idx)
    batches = []
    for w in range(0, len(idx), window):
        chunk = sorted(idx[w: w + window], key=lambda i: lengths[i])
        cur, longest = [], 0
        for i in chunk:
            n = max(longest, lengths[i])
            if cur and n * (len(cur) + 1) > max_tokens:
                batches.append(cur)
                cur, n = [], lengths[i]
            cur.append(i)
            longest = n
        if cur:
            batches.append(cur)
    if shuffle_seed is not None:
        rng.shuffle(batches)
    return batches


def save_merged(model, tokenizer, path: str) -> None:
    """Fold LoRA into the base weights and save a standalone model (what RL and vLLM load)."""
    merged = model.merge_and_unload() if hasattr(model, "merge_and_unload") else model
    merged.config.use_cache = True
    merged.save_pretrained(path, safe_serialization=True)
    tokenizer.save_pretrained(path)
