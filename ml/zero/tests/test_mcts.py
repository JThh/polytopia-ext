"""Gumbel search on toy trees (no simulator): it finds the best action and its policy target follows the values."""

import numpy as np

from polyzero.mcts import Node, SearchConfig, handles, search


def drive(gen, expand):
    """Run a search generator to completion, answering each expansion request with expand(parent, action)."""
    try:
        req = next(gen)
        while True:
            req = gen.send([expand(p, a) for p, a in req])
    except StopIteration as stop:
        return stop.value


def leaf(value, h=None):
    return Node(h, np.zeros((0, 4), np.int16), [], value, terminal=True)


def test_picks_best_terminal_action():
    values = np.array([-0.5, 0.1, 0.8, 0.3, -0.2, 0.0])
    root = Node(1, np.zeros((6, 4), np.int16), np.zeros(6), 0.0)
    cfg = SearchConfig(simulations=16, max_considered=6, gumbel_scale=0.0)
    a, pi, v, used = drive(search(root, cfg, np.random.default_rng(0)), lambda p, a: leaf(values[a]))
    assert a == 2
    assert pi.argmax() == 2 and abs(pi.sum() - 1) < 1e-5
    assert used >= 6 and v > 0


def test_prior_and_value_combine():
    # the prior prefers action 0, but action 1 is clearly better once searched
    values = np.array([-0.6, 0.9, -0.1])
    root = Node(1, np.zeros((3, 4), np.int16), np.array([2.0, 0.0, 0.0]), 0.0)
    cfg = SearchConfig(simulations=12, max_considered=3, gumbel_scale=0.0)
    a, pi, _, _ = drive(search(root, cfg, np.random.default_rng(0)), lambda p, a: leaf(values[a]))
    assert a == 1 and pi[1] > pi[0]


def test_two_levels_and_handles():
    # action 0 leads to a state whose best child is worth 0.9; action 1 is a terminal 0.5
    ids = iter(range(100, 1000))

    def expand(parent, a):
        if parent.h == 1 and a == 0:
            return Node(next(ids), np.zeros((3, 4), np.int16), np.zeros(3), 0.0)
        if parent.h == 1:
            return leaf(0.5, next(ids))
        return leaf([0.9, -0.9, -0.9][a], next(ids))

    root = Node(1, np.zeros((2, 4), np.int16), np.zeros(2), 0.0)
    cfg = SearchConfig(simulations=32, max_considered=2, gumbel_scale=0.0)
    a, pi, _, _ = drive(search(root, cfg, np.random.default_rng(0)), expand)
    assert a == 0
    hs = handles(root)
    assert hs[0] == 1 and len(hs) == len(set(hs)) > 3


def test_single_action_needs_no_search():
    root = Node(1, np.zeros((1, 4), np.int16), np.zeros(1), 0.2)
    a, pi, v, used = drive(search(root, SearchConfig(), np.random.default_rng(0)), lambda p, a: None)
    assert (a, used) == (0, 0) and pi[0] == 1.0
