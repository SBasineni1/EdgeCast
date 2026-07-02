import pytest

from edgecast.forecast import model_implied_probability
from edgecast.types import EnsembleForecast


def make_forecast(members: list[float]) -> EnsembleForecast:
    return EnsembleForecast(
        source="mock-ensemble",
        issued_at="2026-07-03T12:00:00Z",
        members=tuple(members),
    )


def test_fraction_of_members_satisfying():
    # 3 of 4 members >= 90
    fc = make_forecast([88.0, 90.0, 91.0, 95.0])
    mp = model_implied_probability(fc, ">=", 90.0)
    assert mp.raw == 0.75
    assert mp.clamped == 0.75  # inside [0.2, 0.8] for n=4
    assert mp.n_members == 4


def test_all_members_yes_clamps_below_one():
    fc = make_forecast([91.0] * 30)
    mp = model_implied_probability(fc, ">=", 90.0)
    assert mp.raw == 1.0
    assert mp.clamped == pytest.approx(30 / 31)


def test_no_members_yes_clamps_above_zero():
    fc = make_forecast([85.0] * 30)
    mp = model_implied_probability(fc, ">=", 90.0)
    assert mp.raw == 0.0
    assert mp.clamped == pytest.approx(1 / 31)


def test_empty_ensemble_rejected():
    fc = make_forecast([])
    with pytest.raises(ValueError, match="members"):
        model_implied_probability(fc, ">=", 90.0)
