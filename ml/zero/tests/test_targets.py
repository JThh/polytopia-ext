"""TD(lambda) value targets over one seat's decisions (play.td_targets)."""

import numpy as np

from polyzero.play import td_targets


def pos(v, legal=2):
    return {"legal": np.zeros((legal, 4), np.int16), "v_search": np.float32(v)}


def after():  # an afterstate: no legal actions, no search value
    return {"legal": np.zeros((0, 4), np.int16), "v_search": np.float32(np.nan)}


def test_lambda_one_is_the_outcome():
    seq = [pos(0.3), pos(-0.2), after(), pos(0.5)]
    assert td_targets(seq, 0.8, 1.0) == [0.8, 0.8, 0.8, 0.8]


def test_lambda_zero_is_the_next_search_value():
    seq = [pos(0.3), pos(-0.2), pos(0.5)]
    assert np.allclose(td_targets(seq, 1.0, 0.0), [-0.2, 0.5, 1.0])


def test_afterstate_is_not_a_step():
    # the end_turn decision and its afterstate share a target: the blend of the next turn's first search value
    seq = [pos(0.1), after(), pos(0.6)]
    lam, z = 0.5, -1.0
    t = td_targets(seq, z, lam)
    assert np.isclose(t[2], z)
    assert np.isclose(t[1], (1 - lam) * 0.6 + lam * z)
    assert np.isclose(t[0], t[1])
