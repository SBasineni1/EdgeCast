import pytest

from edgecast.consensus import (
    SIGMA_DEFAULT,
    consensus_point,
    consensus_sigma,
    normal_mass,
    trailing_bias,
)
from edgecast.forecast import model_implied_probability
from edgecast.types import MarketQuote, NormalForecast


def q(comparator, threshold=None, lo=None, hi=None):
    return MarketQuote(
        market_id="M", question="q", location="NYC", variable="high_temp_f",
        comparator=comparator, event_date="2026-07-05", yes_price=0.5,
        threshold=threshold, threshold_low=lo, threshold_high=hi,
    )


def test_trailing_bias_mean_and_min_days():
    assert trailing_bias([2.0, 2.0, 2.0, 2.0, 2.0]) == pytest.approx(2.0)
    assert trailing_bias([2.0, 2.0]) == 0.0          # < 5 graded days -> no correction
    assert trailing_bias([]) == 0.0


def test_sigma_population_stdev_with_floor_and_default():
    assert consensus_sigma([1.0, -1.0, 1.0, -1.0, 1.0]) == 1.0   # stdev 0.98 -> floored
    assert consensus_sigma([3.0, -3.0, 3.0, -3.0, 3.0]) == pytest.approx(2.94, abs=0.01)
    assert consensus_sigma([1.0, 2.0]) == SIGMA_DEFAULT           # < 5 days -> wide


def test_consensus_point_debiased_mean():
    # NBM 100 running +2 warm -> 98; HRRR 96 running -1 cool -> 97; mean 97.5
    mu = consensus_point({"a": 100.0, "b": 96.0}, {"a": 2.0, "b": -1.0})
    assert mu == pytest.approx(97.5)
    with pytest.raises(ValueError):
        consensus_point({}, {})


def test_normal_mass_integer_settlement_boundaries():
    # mu 96.0, sigma 1.5; between 95 96 covers [94.5, 96.5)
    assert normal_mass(q("between", lo=95.0, hi=96.0), 96.0, 1.5) == pytest.approx(0.472, abs=2e-3)
    # "greater 100" settles yes at 101+ -> boundary 100.5
    assert normal_mass(q(">", 100.0), 96.0, 1.5) == pytest.approx(0.00135, abs=2e-4)
    assert normal_mass(q(">=", 100.0), 96.0, 1.5) == pytest.approx(0.0098, abs=5e-4)
    # "less 93" settles yes at 92 and below -> boundary 92.5
    assert normal_mass(q("<", 93.0), 96.0, 1.5) == pytest.approx(0.0098, abs=5e-4)
    assert normal_mass(q("<=", 93.0), 96.0, 1.5) == pytest.approx(0.0478, abs=5e-4)


def test_normal_mass_contiguous_ladder_sums_to_one():
    ladder = [
        q("<", 93.0),
        q("between", lo=93.0, hi=94.0),
        q("between", lo=95.0, hi=96.0),
        q(">", 96.0),
    ]
    total = sum(normal_mass(m, 94.2, 1.8) for m in ladder)
    assert total == pytest.approx(1.0, abs=1e-9)


def test_model_implied_probability_normal_dispatch_and_clamp():
    f = NormalForecast(source="consensus(a,b)", issued_at="2026-07-04T00:00:00Z",
                       mu=96.0, sigma=1.5, n_models=2)
    p = model_implied_probability(f, q("between", lo=95.0, hi=96.0))
    assert p.raw == pytest.approx(0.472, abs=2e-3)
    assert p.clamped == p.raw
    assert p.n_members == 2
    far = model_implied_probability(f, q(">", 120.0))
    assert far.raw < 0.001 and far.clamped == 0.001
