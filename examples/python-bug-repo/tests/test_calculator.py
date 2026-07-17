from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from calculator import add


def test_adds_two_numbers() -> None:
    assert add(2, 3) == 5
