"""Simulator client, rewards, answer parsing, and the real-game bridge path (needs Node, not torch)."""

from polyrl.bridge import Agent, SimBridge
from polyrl.formatting import parse_actions
from polyrl.rewards import RewardConfig, final_reward, turn_reward
from polyrl.sim import Game

SMALL = {"sizes": {"tiny": 1, "small": 1}, "players": [2, 3], "modes": {"score": 1}, "turnLimits": [12]}


def test_spec_is_polytopia(sim):
    spec = sim.spec()
    assert spec["rules"] == "polytopia"
    assert "examine" in spec["verbs"] and "power" not in spec["verbs"]
    assert "forge" in spec["vocab"]["build"] and "free_spirit" in spec["vocab"]["tech"]


def test_full_game_with_bot_plans(sim):
    g = Game(sim, sample=SMALL, seed=3, random_model_seat=True)
    turns = 0
    while not g.over:
        assert g.model_turn
        r = g.step(g.botplan())
        assert r["report"]["invalid"] == 0 and r["report"]["endedExplicitly"]
        turns += 1
    res = g.result()
    assert turns > 3 and 1 in res["ranks"]
    g.close()


def test_turn_reward_prefers_valid_progress(sim):
    g = Game(sim, sample=SMALL, seed=5)
    plan = g.botplan()
    good, empty, junk, bad = g.evaluate([plan, '[("tribe", "end_turn")]', "hello", '[("warrior#999", "move", (0, 0)), ("tribe", "end_turn")]'], horizon=1)
    c = RewardConfig()
    rg, re_, rj, rb = (turn_reward(x, c)[0] for x in (good, empty, junk, bad))
    assert rj < re_ and rb < re_  # unparseable and invalid answers cost
    assert rg >= rj
    assert final_reward({"n": 3, "ranks": [1, 2, 3], "scores": [5000, 3000, 0]}, 0, c) > final_reward({"n": 3, "ranks": [1, 2, 3], "scores": [5000, 3000, 0]}, 1, c)
    g.close()


def test_parse_actions():
    acts, ok = parse_actions('[("rider#9", "move", (7, 5)),\n ("tribe", "end_turn")]<eos junk>')
    assert ok and acts == [("rider#9", "move", (7, 5)), ("tribe", "end_turn")]
    acts, ok = parse_actions('[("rider#9", "move", (7, 5)),\n ("tribe", "resea')
    assert not ok and acts == [("rider#9", "move", (7, 5))]
    assert parse_actions("nonsense") == ([], False)


def test_bridge_prompt_matches_training_prompt(sim):
    """A real-game bridge emits PolyState; rendering it must give exactly the prompt the model trained on."""
    g = Game(sim, sample=SMALL, seed=11, random_model_seat=True)
    for _ in range(4):
        g.step(g.botplan())
    obs = g.observe()
    state = g.snapshot(goal=obs["goal"])
    assert sim.render(state) == obs["prompt"]
    g.close()


def test_agent_plays_through_bridge(sim):
    """The agent loop: PolyState -> prompt -> answer -> PolyCommands executed one by one by the bridge."""
    g = Game(sim, sample=SMALL, seed=21, random_model_seat=True)
    reports = []
    agent = Agent(lambda prompt: g.botplan(), sim)  # the bot stands in for the model
    bridge = SimBridge(g, history=False)
    while not g.over:
        assert bridge.status()["my_turn"]
        if len(agent.memory) == 3:  # own-history lines rebuilt by the agent match the simulator's
            s = bridge.state()
            mine = [ln for ln in agent.prompt(s).splitlines() if ln.startswith(" me turn")]
            ref = [ln for ln in g.observe()["prompt"].splitlines() if ln.startswith(" me turn")]
            assert mine == ref and mine
        reports.append(agent.play_turn(bridge))
    assert reports and all(r["rejected"] == {} and r["ended_explicitly"] for r in reports)
    g.close()
