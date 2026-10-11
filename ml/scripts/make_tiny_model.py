"""Build a tiny random-weight model with a real architecture (default: Qwen3.5, vision tower included) and a small BPE
tokenizer trained on SFT prompts, for CPU smoke tests of the whole pipeline without downloading anything.

    python ml/scripts/make_tiny_model.py --data ml/data/sft/train.jsonl --out runs/tiny-qwen3_5 [--arch qwen3_5|qwen3]
"""

import argparse
import json

from tokenizers import Tokenizer, decoders, models, pre_tokenizers, trainers
from transformers import AutoModelForCausalLM, PreTrainedTokenizerFast


def tokenizer_from(data: str, vocab: int):
    texts = []
    with open(data) as f:
        for i, line in enumerate(f):
            r = json.loads(line)
            texts += [r["prompt"], r["completion"]]
            if i > 400:
                break
    tk = Tokenizer(models.BPE(unk_token=None))
    tk.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tk.decoder = decoders.ByteLevel()
    tk.train_from_iterator(texts, trainers.BpeTrainer(vocab_size=vocab, special_tokens=["<|endoftext|>", "<|pad|>"], initial_alphabet=pre_tokenizers.ByteLevel.alphabet()))
    return PreTrainedTokenizerFast(tokenizer_object=tk, eos_token="<|endoftext|>", pad_token="<|pad|>")


def config_for(arch: str, vocab: int):
    if arch == "qwen3_5":
        from transformers import Qwen3_5Config

        return Qwen3_5Config(
            text_config=dict(vocab_size=vocab, hidden_size=64, intermediate_size=128, num_hidden_layers=4, num_attention_heads=4, num_key_value_heads=2, head_dim=16,
                             linear_num_key_heads=2, linear_num_value_heads=4, linear_key_head_dim=16, linear_value_head_dim=16,
                             layer_types=["linear_attention", "linear_attention", "linear_attention", "full_attention"], max_position_embeddings=8192),
            vision_config=dict(depth=1, hidden_size=32, intermediate_size=64, num_heads=2, out_hidden_size=64), tie_word_embeddings=False)
    from transformers import Qwen3Config

    return Qwen3Config(vocab_size=vocab, hidden_size=64, intermediate_size=128, num_hidden_layers=2, num_attention_heads=4, num_key_value_heads=2, head_dim=16, max_position_embeddings=8192)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--arch", default="qwen3_5")
    p.add_argument("--vocab", type=int, default=1024)
    p.add_argument("--multimodal", action="store_true", help="save the image-text-to-text model (vision tower included), like the real checkpoints")
    a = p.parse_args()
    tok = tokenizer_from(a.data, a.vocab)
    cfg = config_for(a.arch, len(tok))
    if a.multimodal:
        from transformers import AutoModelForImageTextToText

        model = AutoModelForImageTextToText.from_config(cfg)
    else:
        model = AutoModelForCausalLM.from_config(cfg)
    model.save_pretrained(a.out)
    tok.save_pretrained(a.out)
    n = sum(p.numel() for p in model.parameters())
    print(f"{type(model).__name__}: {n / 1e6:.2f}M parameters, vocab {len(tok)} -> {a.out}")


if __name__ == "__main__":
    main()
