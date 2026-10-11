"""Sampling action lists from the policy: Hugging Face generate (default) or vLLM (much faster rollouts).

Both return, per prompt, n Samples holding the exact sampled token ids (RL trains on these, never on re-tokenized
text) and the decoded text that goes to the simulator.
"""

from __future__ import annotations

from dataclasses import dataclass

import torch

from .formatting import STOP


@dataclass
class Sample:
    ids: list[int]   # completion tokens as sampled (ends with EOS when the model emitted it)
    text: str
    finished: bool   # stopped by EOS or the closing ")]" rather than the token limit


@dataclass
class GenConfig:
    backend: str = "hf"              # "hf" or "vllm"
    max_new_tokens: int = 768
    temperature: float = 1.0
    top_p: float = 1.0
    # vLLM only
    gpu_memory_utilization: float = 0.3
    max_model_len: int = 8192
    max_lora_rank: int = 64


def _trim(ids: list[int], text: str, eos: int, tok) -> Sample:
    if eos in ids:
        ids = ids[: ids.index(eos) + 1]
        return Sample(ids, tok.decode(ids, skip_special_tokens=True), True)
    if STOP in text:  # cut right after the closing ")]": shortest prefix whose text contains it (binary search)
        lo, hi = 1, len(ids)
        while lo < hi:
            mid = (lo + hi) // 2
            if STOP in tok.decode(ids[:mid], skip_special_tokens=True):
                hi = mid
            else:
                lo = mid + 1
        ids = ids[:lo]
        return Sample(ids, tok.decode(ids, skip_special_tokens=True), True)
    return Sample(ids, text, False)


class HFGenerator:
    """One prompt at a time with n return sequences: no padding, which keeps recurrent / linear-attention layers
    (Qwen3.5) exact."""

    def __init__(self, model, tok, cfg: GenConfig):
        self.model, self.tok, self.cfg = model, tok, cfg

    @torch.no_grad()
    def generate(self, prompts: list[list[int]], n: int = 1, greedy: bool = False) -> list[list[Sample]]:
        was_training = self.model.training
        self.model.eval()
        dev = next(self.model.parameters()).device
        out = []
        for ids in prompts:
            x = torch.tensor([ids], device=dev)
            kw = dict(max_new_tokens=self.cfg.max_new_tokens, pad_token_id=self.tok.pad_token_id, eos_token_id=self.tok.eos_token_id,
                      use_cache=True, stop_strings=[STOP], tokenizer=self.tok)
            if greedy:
                kw.update(do_sample=False, num_return_sequences=1)
            else:
                # plain sampling at the trained temperature (no top-k / penalties), so RL log-probs match what was sampled
                kw.update(do_sample=True, temperature=self.cfg.temperature, top_p=self.cfg.top_p, top_k=0, repetition_penalty=1.0, num_return_sequences=n)
            gen = self.model.generate(input_ids=x, attention_mask=torch.ones_like(x), **kw)[:, len(ids):]
            samples = []
            for row in gen.tolist():
                while row and row[-1] == self.tok.pad_token_id and self.tok.pad_token_id != self.tok.eos_token_id:
                    row.pop()
                samples.append(_trim(row, self.tok.decode(row, skip_special_tokens=True), self.tok.eos_token_id, self.tok))
            if greedy and n > 1:
                samples = samples * n
            out.append(samples)
        if was_training:
            self.model.train()
        return out

    def set_adapter(self, path: str | None, version: int) -> None:
        pass  # generates with the live training model


class VLLMGenerator:
    """vLLM engine on the merged SFT model; the RL adapter is saved each iteration and loaded as a LoRA request."""

    def __init__(self, model_path: str, tok, cfg: GenConfig, enable_lora: bool = True, seed: int = 0):
        from vllm import LLM

        self.tok, self.cfg = tok, cfg
        self.llm = LLM(model=model_path, dtype="bfloat16", gpu_memory_utilization=cfg.gpu_memory_utilization, max_model_len=cfg.max_model_len,
                       enable_lora=enable_lora, max_lora_rank=cfg.max_lora_rank, enable_prefix_caching=True, seed=seed)
        self.lora = None

    def set_adapter(self, path: str | None, version: int) -> None:
        from vllm.lora.request import LoRARequest

        self.lora = LoRARequest(f"policy-{version}", version, path) if path else None

    def generate(self, prompts: list[list[int]], n: int = 1, greedy: bool = False) -> list[list[Sample]]:
        from vllm import SamplingParams

        sp = SamplingParams(n=1 if greedy else n, temperature=0.0 if greedy else self.cfg.temperature, top_p=1.0 if greedy else self.cfg.top_p,
                            max_tokens=self.cfg.max_new_tokens, stop=[STOP], include_stop_str_in_output=True)
        outs = self.llm.generate([{"prompt_token_ids": p} for p in prompts], sp, lora_request=self.lora, use_tqdm=False)
        res = []
        for o in outs:
            samples = []
            for c in o.outputs:
                ids = list(c.token_ids)
                samples.append(Sample(ids, c.text, c.finish_reason == "stop"))
            res.append(samples * n if greedy and n > 1 else samples)
        return res


def make_generator(cfg: GenConfig, model, tok, model_path: str | None = None, seed: int = 0):
    if cfg.backend == "vllm":
        return VLLMGenerator(model_path, tok, cfg, seed=seed)
    return HFGenerator(model, tok, cfg)
