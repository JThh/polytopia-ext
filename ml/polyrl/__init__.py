"""polyrl: train a language model to play Polytopia from game state to typed actions (SFT, then simulation-based RL).

The game simulator runs in Node (ml/sim); this package drives it over JSON lines (sim.py) and holds the ML code:
modeling.py (model + LoRA + token log-probs), sft.py, rl.py, generation.py, rewards.py, evaluate.py, bridge.py.
"""

__version__ = "0.1.0"
