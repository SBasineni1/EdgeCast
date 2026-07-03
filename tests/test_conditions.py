import pytest

from edgecast.conditions import COMPARATORS, satisfies, satisfies_market
from edgecast.types import MarketQuote


def test_comparator_whitelist():
    assert COMPARATORS == (">=", ">", "<=", "<", "between")


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


def make_quote(**kw) -> MarketQuote:
    base = dict(
        market_id="M", question="q", location="NYC", variable="high_temp_f",
        comparator=">=", event_date="2026-07-05", yes_price=0.5, threshold=90.0,
    )
    base.update(kw)
    return MarketQuote(**base)


@pytest.mark.parametrize(
    ("value", "expected"),
    [(87.9, False), (88.0, True), (88.5, True), (89.0, True), (89.1, False)],
)
def test_between_inclusive_both_ends(value, expected):
    q = make_quote(comparator="between", threshold=None, threshold_low=88.0, threshold_high=89.0)
    assert satisfies_market(value, q) is expected


def test_between_low_equals_high():
    q = make_quote(comparator="between", threshold=None, threshold_low=90.0, threshold_high=90.0)
    assert satisfies_market(90.0, q) is True
    assert satisfies_market(90.1, q) is False


def test_satisfies_market_binary_delegates():
    assert satisfies_market(93.0, make_quote()) is True
    assert satisfies_market(89.0, make_quote()) is False


def test_satisfies_rejects_between_without_market():
    with pytest.raises(ValueError, match="between"):
        satisfies(90.0, "between", 90.0)
