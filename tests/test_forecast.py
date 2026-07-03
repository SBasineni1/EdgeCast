import pytest

from edgecast.forecast import model_implied_probability
from edgecast.types import EnsembleForecast, MarketQuote


def make_forecast(members: list[float]) -> EnsembleForecast:
    return EnsembleForecast(
        source="mock-ensemble",
        issued_at="2026-07-03T12:00:00Z",
        members=tuple(members),
    )


def make_quote(**kw) -> MarketQuote:
    base = dict(
        market_id="M", question="q", location="NYC", variable="high_temp_f",
        comparator=">=", event_date="2026-07-05", yes_price=0.5, threshold=90.0,
    )
    base.update(kw)
    return MarketQuote(**base)


def test_fraction_of_members_satisfying():
    # 3 of 4 members >= 90
    fc = make_forecast([88.0, 90.0, 91.0, 95.0])
    mp = model_implied_probability(fc, make_quote(comparator=">=", threshold=90.0))
    assert mp.raw == 0.75
    assert mp.clamped == 0.75  # inside [0.2, 0.8] for n=4
    assert mp.n_members == 4


def test_all_members_yes_clamps_below_one():
    fc = make_forecast([91.0] * 30)
    mp = model_implied_probability(fc, make_quote(comparator=">=", threshold=90.0))
    assert mp.raw == 1.0
    assert mp.clamped == pytest.approx(30 / 31)


def test_no_members_yes_clamps_above_zero():
    fc = make_forecast([85.0] * 30)
    mp = model_implied_probability(fc, make_quote(comparator=">=", threshold=90.0))
    assert mp.raw == 0.0
    assert mp.clamped == pytest.approx(1 / 31)


def test_empty_ensemble_rejected():
    fc = make_forecast([])
    with pytest.raises(ValueError, match="members"):
        model_implied_probability(fc, make_quote(comparator=">=", threshold=90.0))


def test_between_fraction():
    fc = make_forecast([87.0, 88.0, 88.5, 89.0, 91.0])
    q = make_quote(comparator="between", threshold=None, threshold_low=88.0, threshold_high=89.0)
    mp = model_implied_probability(fc, q)
    assert mp.raw == 0.6  # 88.0, 88.5, 89.0
