"""Stage 2, simulation-based online RL: play against the built-in bots and climb on score.

    python -m polyrl.rl --config ml/configs/rl.yaml [key=value ...]

One iteration:
  1. Rollout. `trunks` copies of one game (same map, tribes and seat) are played by the model against bots. At each
     of the model's turns it samples `group_size` action lists for the same state. Each list is scored on its own
     copy of the game (apply it, let the rivals reply, optionally let the bot continue for us) with the turn reward
     (rewards.py), and one list is played for real in the trunk (the best one, with epsilon exploration).
  2. Advantages. Turn level: the group's rewards relative to the group mean (GRPO). Game level: each trunk's final
     reward (score, win, rank) relative to the other trunks, added to the lists that trunk actually played.
  3. Update. PPO-style clipped policy gradient on the sampled tokens with a KL penalty to the SFT model (the LoRA
     adapter switched off), token-level normalisation (DAPO style), asymmetric clipping.
The prompt asks for rank 1 and a high score (decision-transformer goal), so RL improves the goal-conditioned policy.
"""

from __future__ import annotations

import json
import math
import random
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import torch

from . import config as C
from .formatting import encode_completion, encode_prompt, load_format, save_format
from .generation import GenConfig, Sample, make_generator
from .modeling import LoraConfig, ModelConfig, load_tokenizer, pad_batch, prepare, save_merged, token_batches, token_logprobs
from .rewards import RewardConfig, final_reward, turn_reward
from .sim import SimPool
from .sft import Logger


@dataclass
class Stage:
    until: int | None = None   # last iteration of this stage (None: until the end)
    sample: dict = field(default_factory=dict)  # game constraints for ml/sim/configs.js: sizes, players, difficulties, modes, turnLimits, mapTypes
    max_turns: int | None = None


DEFAULT_CURRICULUM = [
    {"until": 40, "sample": {"sizes": {"tiny": 1, "small": 1}, "players": [2, 3], "difficulties": {"easy": 1, "normal": 1}, "modes": {"score": 1}, "turnLimits": [15, 20]}},
    {"until": 120, "sample": {"sizes": {"small": 1, "normal": 1}, "players": [2, 4], "difficulties": {"normal": 1, "hard": 1}, "modes": {"score": 1}, "turnLimits": [20, 25, 30]}},
    {"until": None, "sample": {"sizes": {"small": 1, "normal": 2, "large": 1}, "players": [2, 6], "difficulties": {"hard": 2, "crazy": 1}, "modes": {"score": 4, "domination": 1}, "turnLimits": [25, 30, 35]}, "max_turns": 40},
]


@dataclass
class RLConfig:
    model: ModelConfig = field(default_factory=lambda: ModelConfig(name="runs/sft/merged"))
    lora: LoraConfig = field(default_factory=lambda: LoraConfig(r=32, alpha=64, dropout=0.0))
    gen: GenConfig = field(default_factory=GenConfig)
    reward: RewardConfig = field(default_factory=RewardConfig)
    rules: str = "polytopia"
    targets: str | None = "ml/data/sft/targets.json"
    output_dir: str = "runs/rl"
    iterations: int = 200
    trunks: int = 2                 # parallel games of the same setup per iteration
    group_size: int = 6             # action lists sampled per model turn
    branch_prob: float = 1.0        # chance a turn is branched into a group (else 1 sample, game-level credit only)
    horizon: int = 1                # my turns the bot plays after the sampled one before measuring (1 = rivals reply)
    trunk_greedy: bool = True       # the trunk plays the group's best list ...
    trunk_epsilon: float = 0.15     # ... except with this chance a random one
    teacher_in_group: bool = False  # add the bot's own plan to each group as an extra (off-policy) candidate
    goal_boost: float = 1.0         # multiplies the goal score in the prompt
    lr: float = 2e-5
    kl_coef: float = 0.02
    clip_low: float = 0.2
    clip_high: float = 0.28
    ppo_epochs: int = 1
    minibatches: int = 2            # optimizer steps per epoch over the iteration's samples
    max_tokens_per_batch: int = 12288
    max_grad_norm: float = 1.0
    adv_norm: bool = True           # divide turn advantages by the group's std
    episode_weight: float = 0.5
    max_prompt_tokens: int = 5120   # longer states are played by the bot and not trained on
    sim_procs: int = 4
    save_every: int = 10
    eval_every: int = 25
    eval_games: int = 8
    seed: int = 0
    curriculum: list = field(default_factory=lambda: [dict(s) for s in DEFAULT_CURRICULUM])
    wandb_project: str | None = None


@dataclass
class Item:
    prompt: list[int]
    completion: list[int]
    adv: float = 0.0
    teacher: bool = False


def stage_for(it: int, stages: list[Stage]) -> Stage:
    for s in stages:
        if s.until is None or it <= s.until:
            return s
    return stages[-1]


def rollout(it: int, cfg: RLConfig, stage: Stage, pool: SimPool, gen, tok, chat: bool):
    seed = (cfg.seed * 100003 + it * 7919) & 0x7FFFFFFF
    rng = random.Random(seed)
    games = [pool.new_game(sample=stage.sample, seed=seed, random_model_seat=True, max_turns=stage.max_turns) for _ in range(cfg.trunks)]
    seat = games[0].model_seats[0]
    ex = ThreadPoolExecutor(max_workers=len(games))
    items: list[Item] = []
    chosen_by_trunk: list[list[Item]] = [[] for _ in games]
    st = {"turns": 0, "samples": 0, "parsed": 0, "complete": 0, "ended": 0, "valid": 0, "invalid": 0, "bot_turns": 0, "reward": [], "progress": [],
          "rules": [], "d_score": [], "comp_len": [], "teacher_wins": 0, "groups": 0}
    examples = []
    turn_no = 0
    while True:
        active = [e for e, g in enumerate(games) if not g.over and g.model_turn]
        if not active:
            break
        turn_no += 1
        obs = list(ex.map(lambda e: games[e].observe(boost=cfg.goal_boost), active))
        prompts = [encode_prompt(tok, o["prompt"], chat) for o in obs]
        branch = [rng.random() < cfg.branch_prob for _ in active]
        fits = [len(p) <= cfg.max_prompt_tokens for p in prompts]
        groups: dict[int, list[Sample]] = {}
        for want, n in ((True, cfg.group_size), (False, 1)):
            idx = [i for i in range(len(active)) if fits[i] and branch[i] == want]
            if idx:
                for i, ss in zip(idx, gen.generate([prompts[i] for i in idx], n=n)):
                    groups[i] = ss
        teachers = {}
        if cfg.teacher_in_group:
            for i in groups:
                if branch[i]:
                    teachers[i] = games[active[i]].botplan()

        texts = {i: [s.text for s in groups[i]] + ([teachers[i]] if i in teachers else []) for i in groups}
        evals = dict(zip(groups, ex.map(lambda i: games[active[i]].evaluate(texts[i], horizon=cfg.horizon, seed=seed + turn_no), list(groups))))
        picks, outs = {}, {}
        for i in groups:  # choose in the main thread so runs are reproducible
            rw = [turn_reward(r, cfg.reward) for r in evals[i]]
            k_model = len(groups[i])
            explore = not cfg.trunk_greedy or rng.random() < cfg.trunk_epsilon
            picks[i] = rng.randrange(k_model) if explore else max(range(k_model), key=lambda k: rw[k][0])
            outs[i] = (evals[i], rw, picks[i])
        # states too long for the model are played by the bot
        list(ex.map(lambda i: games[active[i]].step(texts[i][picks[i]] if i in picks else games[active[i]].botplan()), range(len(active))))
        st["bot_turns"] += len(active) - len(groups)
        for i, (res, rw, pick) in outs.items():
            e = active[i]
            samples = groups[i]
            rs = [r for r, _ in rw]
            cands = [s.ids for s in samples] + ([encode_completion(tok, teachers[i])] if i in teachers else [])
            mean = sum(rs) / len(rs)
            sd = statistics.pstdev(rs) if len(rs) > 1 else 0.0
            for k, ids in enumerate(cands):
                adv = 0.0
                if len(rs) > 1 and sd > 1e-6:
                    adv = (rs[k] - mean) / (sd + 1e-4) if cfg.adv_norm else rs[k] - mean
                it_ = Item(prompts[i], ids, adv, teacher=k >= len(samples))
                items.append(it_)
                if k == pick:
                    chosen_by_trunk[e].append(it_)
            st["groups"] += len(rs) > 1
            if i in teachers and max(range(len(rs)), key=lambda k: rs[k]) == len(rs) - 1:
                st["teacher_wins"] += 1
            for k, s in enumerate(samples):
                rep = res[k]["report"]
                st["samples"] += 1
                st["parsed"] += rep["parsed"] > 0
                st["complete"] += rep["complete"]
                st["ended"] += rep["endedExplicitly"]
                st["valid"] += rep["valid"]
                st["invalid"] += rep["invalid"]
                st["reward"].append(rs[k])
                st["progress"].append(rw[k][1]["progress"])
                st["rules"].append(rw[k][1]["rules"])
                st["d_score"].append(rw[k][1]["d_score"])
                st["comp_len"].append(len(s.ids))
            st["turns"] += 1
            if e == 0 and len(examples) < 3 and turn_no % 5 == 1:
                examples.append({"turn": obs[i]["meta"]["turn"], "reward": rs[pick], "plan": samples[pick].text[:2000], "report": res[pick]["report"]})

    results = [g.result() for g in games]
    finals = [final_reward(r, seat, cfg.reward) for r in results]
    if len(finals) > 1:
        m, sd = sum(finals) / len(finals), statistics.pstdev(finals)
        for e, chosen in enumerate(chosen_by_trunk):
            a = (finals[e] - m) / (sd + 1e-4) if sd > 1e-6 else 0.0
            for x in chosen:
                x.adv += cfg.episode_weight * a
    for g in games:
        g.close()
    ex.shutdown()
    mean = lambda v: sum(v) / len(v) if v else 0.0
    n = max(1, st["samples"])
    stats = {
        "settings": {k: games[0].settings[k] for k in ("size", "mapType", "mode", "turnLimit")} | {"players": len(games[0].tribes), "seat": seat},
        "model_turns": st["turns"], "bot_turns": st["bot_turns"], "samples": st["samples"],
        "parse_rate": st["parsed"] / n, "complete_rate": st["complete"] / n, "end_turn_rate": st["ended"] / n,
        "valid_action_rate": st["valid"] / max(1, st["valid"] + st["invalid"]), "invalid_per_sample": st["invalid"] / n,
        "turn_reward": mean(st["reward"]), "progress": mean(st["progress"]), "rules_penalty": mean(st["rules"]), "d_score": mean(st["d_score"]),
        "completion_tokens": mean(st["comp_len"]), "teacher_best_rate": st["teacher_wins"] / max(1, st["groups"]) if cfg.teacher_in_group else None,
        "final_score": mean([r["scores"][seat] for r in results]), "win_rate": mean([r["ranks"][seat] == 1 for r in results]),
        "final_rank": mean([r["ranks"][seat] for r in results]), "game_turns": mean([r["turn"] for r in results]), "final_reward": mean(finals),
    }
    return items, stats, examples


def per_item_logprobs(model, tok, items: list[Item], max_tokens: int, device, temperature: float, no_grad=True) -> list[torch.Tensor]:
    out: list[torch.Tensor | None] = [None] * len(items)
    lengths = [len(x.prompt) + len(x.completion) for x in items]
    ctx = torch.no_grad() if no_grad else torch.enable_grad()
    with ctx:
        for b in token_batches(lengths, max_tokens):
            ids, att, tgt = pad_batch([items[i].prompt + items[i].completion for i in b], [[0] * len(items[i].prompt) + [1] * len(items[i].completion) for i in b],
                                      tok.pad_token_id, device)
            logp, mask = token_logprobs(model, ids, att, tgt, temperature)
            for r, i in enumerate(b):
                out[i] = logp[r][mask[r].bool()].float().cpu()
    return out


def train_step(model, tok, items: list[Item], cfg: RLConfig, opt, params, device, it: int = 0) -> dict:
    model.train()
    T = cfg.gen.temperature
    ref = None
    if cfg.kl_coef > 0 and hasattr(model, "disable_adapter"):  # the SFT model = this model with the RL adapter switched off
        with model.disable_adapter():
            ref = per_item_logprobs(model, tok, items, cfg.max_tokens_per_batch, device, T)
    old = per_item_logprobs(model, tok, items, cfg.max_tokens_per_batch, device, T) if cfg.ppo_epochs > 1 else None
    stats = {"loss": 0.0, "kl": 0.0, "clip_frac": 0.0, "grad_norm": 0.0, "tokens": 0, "steps": 0}
    rng = random.Random(cfg.seed * 1009 + it)
    order = list(range(len(items)))
    for _ in range(cfg.ppo_epochs):
        rng.shuffle(order)
        mbs = [order[k::cfg.minibatches] for k in range(cfg.minibatches)]
        for mb in mbs:
            if not mb:
                continue
            n_tgt = sum(len(items[i].completion) for i in mb)
            lengths = [len(items[i].prompt) + len(items[i].completion) for i in mb]
            for b in token_batches(lengths, cfg.max_tokens_per_batch):
                sel = [mb[j] for j in b]
                ids, att, tgt = pad_batch([items[i].prompt + items[i].completion for i in sel], [[0] * len(items[i].prompt) + [1] * len(items[i].completion) for i in sel],
                                          tok.pad_token_id, device)
                logp, mask = token_logprobs(model, ids, att, tgt, T)
                loss = torch.zeros((), device=device)
                for r, i in enumerate(sel):
                    cur = logp[r][mask[r].bool()]
                    o = old[i].to(device) if old else cur.detach()
                    ratio = torch.exp(cur - o)
                    a = items[i].adv
                    pg = -torch.minimum(ratio * a, torch.clamp(ratio, 1 - cfg.clip_low, 1 + cfg.clip_high) * a)
                    if ref is not None:  # k3 estimator of KL(policy || SFT)
                        rf = ref[i].to(device)
                        kl = torch.exp(rf - cur) - (rf - cur) - 1
                    else:
                        kl = torch.zeros_like(cur)
                    loss = loss + (pg + cfg.kl_coef * kl).sum()
                    stats["kl"] += float(kl.detach().sum())
                    stats["clip_frac"] += float(((ratio - 1).abs() > cfg.clip_low).float().sum())
                    stats["tokens"] += cur.numel()
                (loss / n_tgt).backward()
                stats["loss"] += float(loss.detach()) / n_tgt
            gn = torch.nn.utils.clip_grad_norm_(params, cfg.max_grad_norm)
            opt.step()
            opt.zero_grad(set_to_none=True)
            stats["grad_norm"] += float(gn)
            stats["steps"] += 1
    n = max(1, stats["tokens"])
    return {"loss": stats["loss"] / max(1, stats["steps"]), "kl": stats["kl"] / n, "clip_frac": stats["clip_frac"] / n,
            "grad_norm": stats["grad_norm"] / max(1, stats["steps"]), "trained_tokens": stats["tokens"]}


def main(cfg: RLConfig) -> None:
    random.seed(cfg.seed)
    torch.manual_seed(cfg.seed)
    out = Path(cfg.output_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "config.json").write_text(json.dumps(C.to_dict(cfg), indent=1))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    stages = [s if isinstance(s, Stage) else Stage(**s) for s in cfg.curriculum]
    fmt = load_format(cfg.model.name)
    chat = bool(fmt.get("chat_template", False))

    tok = load_tokenizer(cfg.model.name, cfg.model.trust_remote_code)
    model = prepare(cfg.model, cfg.lora, device)
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=cfg.lr, weight_decay=0.0, betas=(0.9, 0.99), fused=device.type == "cuda")
    gen = make_generator(cfg.gen, model, tok, model_path=cfg.model.name, seed=cfg.seed)
    gen.set_adapter(None, 0)
    pool = SimPool(cfg.sim_procs, rules=cfg.rules, targets=cfg.targets)
    log = Logger(out, cfg.wandb_project, cfg)
    ro_log = open(out / "rollouts.jsonl", "a")

    for it in range(1, cfg.iterations + 1):
        stage = stage_for(it, stages)
        t0 = time.time()
        items, rstats, examples = rollout(it, cfg, stage, pool, gen, tok, chat)
        t1 = time.time()
        train_items = [x for x in items if abs(x.adv) > 1e-6]
        tstats = train_step(model, tok, train_items, cfg, opt, params, device, it) if train_items else {}
        t2 = time.time()
        if cfg.gen.backend == "vllm":
            path = out / "adapter-latest"
            model.save_pretrained(path)
            gen.set_adapter(str(path), it)
        log(it, **{k: v for k, v in rstats.items() if k != "settings"}, **tstats, trained_samples=len(train_items), rollout_s=t1 - t0, train_s=t2 - t1)
        ro_log.write(json.dumps({"it": it, "settings": rstats["settings"], "examples": examples}) + "\n")
        ro_log.flush()
        if it % cfg.save_every == 0:
            model.save_pretrained(out / f"checkpoint-{it}")
        if cfg.eval_every and it % cfg.eval_every == 0 and cfg.eval_games:
            from .evaluate import ModelPolicy, play_games, summarize

            pol = ModelPolicy(gen, tok, chat, greedy=True, goal_boost=cfg.goal_boost, max_prompt_tokens=cfg.max_prompt_tokens)
            res = play_games(pool, cfg.eval_games, stages[-1].sample, 10_000, pol, stages[-1].max_turns)
            log(it, **{"eval_" + k: v for k, v in summarize(res).items()})

    fmt_out = dict(chat_template=chat, base_model=cfg.model.name, stage="rl")
    model.save_pretrained(out / "adapter")
    tok.save_pretrained(out / "adapter")
    save_format(out / "adapter", **fmt_out)
    save_merged(model, tok, str(out / "merged"))
    save_format(out / "merged", **fmt_out)
    pool.close()
    print("done:", out)


if __name__ == "__main__":
    main(C.cli(RLConfig, description=__doc__))
