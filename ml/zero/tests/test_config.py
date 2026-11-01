"""Config overrides: nested sections keep their defaults, plain dicts and lists are replaced whole."""

from polyzero import config as C
from polyzero.train import TrainConfig


def test_partial_section_override_keeps_section_defaults():
    c = C.load(TrainConfig, None, ["eval.search.simulations=4"])
    assert c.eval.search.simulations == 4 and c.eval.search.gumbel_scale == 0.0  # EvalConfig's own default


def test_opponent_mix_is_replaced_not_merged():
    c = C.load(TrainConfig, None, ["selfplay.opponents={self: 0.7, past: 0.3}"])
    assert c.selfplay.opponents == {"self": 0.7, "past": 0.3}


def test_yaml_then_override_replaces_the_mix(tmp_path):
    f = tmp_path / "c.yaml"
    f.write_text("selfplay:\n  opponents: {self: 0.3, 'bot:crazy': 0.7}\n  search: {simulations: 32}\n")
    c = C.load(TrainConfig, str(f), ["selfplay.opponents={self: 1.0}", "selfplay.search.c_scale=1.0"])
    assert c.selfplay.opponents == {"self": 1.0}
    assert c.selfplay.search.simulations == 32 and c.selfplay.search.c_scale == 1.0
