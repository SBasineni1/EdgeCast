import pytest

from edgecast.conditions import COMPARATORS, satisfies


def test_comparator_whitelist():
    assert COMPARATORS == (">=", ">", "<=", "<")


@pytest.mark.parametrize(
    ("value", "comparator", "threshold", "expected"),
    [
        (90.0, ">=", 90.0, True),   # boundary equality satisfies >=
        (89.9, ">=", 90.0, False),
        (90.0, ">", 90.0, False),   # boundary equality does NOT satisfy >
        (90.1, ">", 90.0, True),
        (75.0, "<=", 75.0, True),
        (75.1, "<=", 75.0, False),
        (60.0, "<", 60.0, False),
        (59.9, "<", 60.0, True),
    ],
)
def test_satisfies(value, comparator, threshold, expected):
    assert satisfies(value, comparator, threshold) is expected


def test_satisfies_rejects_unknown_comparator():
    with pytest.raises(ValueError, match="comparator"):
        satisfies(1.0, "==", 1.0)
