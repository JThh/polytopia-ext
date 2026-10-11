import sys
from pathlib import Path

import pytest

ML = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML))


@pytest.fixture(scope="session")
def sim():
    from polyrl.sim import SimClient

    c = SimClient(rules="polytopia")
    yield c
    c.close()
