"""polyzero: learn to play The Battle of Polytopia by search and self-play (Gumbel AlphaZero with a small network).

The rules run in Node (ml/zero/sim on top of ml/sim's Polytopia ruleset); this package holds the network (net.py),
the search (mcts.py), the batched game driver (play.py), training (train.py: warm start, self-play iterations) and
evaluation against the built-in bots (evaluate.py).
"""

__version__ = "0.1.0"
