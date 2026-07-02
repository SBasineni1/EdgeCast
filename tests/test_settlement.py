import pytest

from edgecast.settlement import settle
from edgecast.types import MarketQuote, Observation


def make_quote(comparator: str = ">=", threshold: float = 90.0) -> MarketQuote:
    return MarketQuote(
        market_id="MOCK-1",
        question="test",
        location="NYC",
        variable="high_temp_f",
        comparator=comparator,
        threshold=threshold,
        event_date="2026-07-05",
        yes_price=0.72,
    )


def test_settles_yes_and_scores():
    s = settle(make_quote(), Observation(93.1), market_prob=0.72, model_prob=0.80)
    assert s.outcome == 1
    assert s.observed_value == 93.1
    assert s.brier_market == pytest.approx((0.72 - 1) ** 2)  # 0.0784
    assert s.brier_model == pytest.approx((0.80 - 1) ** 2)   # 0.04
    assert s.brier_diff == pytest.approx(0.04 - 0.0784)


def test_settles_no():
    s = settle(make_quote(), Observation(87.0), market_prob=0.72, model_prob=0.80)
    assert s.outcome == 0
    assert s.brier_market == pytest.approx(0.72**2)
    assert s.brier_model == pytest.approx(0.80**2)


def test_boundary_equality_settles_per_comparator():
    # observed exactly at threshold: >= settles YES, > settles NO
    at = Observation(90.0)
    assert settle(make_quote(">="), at, 0.5, 0.5).outcome == 1
    assert settle(make_quote(">"), at, 0.5, 0.5).outcome == 0


def test_perfect_and_worst_brier():
    s = settle(make_quote(), Observation(95.0), market_prob=0.5, model_prob=0.5)
    assert s.brier_market == pytest.approx(0.25)
    assert s.brier_diff == pytest.approx(0.0)
