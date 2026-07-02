import pytest

from edgecast.pipeline import aggregate, analyze, analyze_scenario
from edgecast.types import EnsembleForecast, MarketQuote, Observation, Scenario


def make_scenario(
    scenario_id: str = "s1",
    yes_price: float = 0.72,
    members: list[float] | None = None,
    observed: float | None = 93.1,
) -> Scenario:
    if members is None:
        # 24 of 30 >= 90 -> model prob 0.8
        members = [88.0] * 6 + [91.0] * 24
    return Scenario(
        scenario_id=scenario_id,
        market=MarketQuote(
            market_id=f"MOCK-{scenario_id}",
            question="NYC high temp >= 90F on 2026-07-05?",
            location="NYC",
            variable="high_temp_f",
            comparator=">=",
            threshold=90.0,
            event_date="2026-07-05",
            yes_price=yes_price,
        ),
        forecast=EnsembleForecast(
            source="mock-ensemble",
            issued_at="2026-07-03T12:00:00Z",
            members=tuple(members),
        ),
        observation=Observation(observed) if observed is not None else None,
    )


def test_analyze_scenario_settled():
    r = analyze_scenario(make_scenario())
    assert r.scenario_id == "s1"
    assert r.market_prob == 0.72
    assert r.model_prob == pytest.approx(0.8)
    assert r.model_prob_raw == pytest.approx(0.8)
    assert r.n_members == 30
    assert r.edge.value == pytest.approx(0.08)
    assert r.edge.flag == "model_higher"
    assert r.settlement is not None
    assert r.settlement.outcome == 1
    assert r.settlement.brier_model == pytest.approx(0.04)


def test_analyze_scenario_unsettled_has_null_settlement():
    r = analyze_scenario(make_scenario(observed=None))
    assert r.settlement is None
    assert r.edge.flag == "model_higher"  # edge analysis still runs


def test_edge_threshold_is_passed_through():
    r = analyze_scenario(make_scenario(), edge_threshold=0.10)
    assert r.edge.flag == "agreement"  # 0.08 < 0.10


def test_aggregate_over_settled_only():
    results, agg = analyze(
        [
            make_scenario("s1", observed=93.1),   # outcome 1
            make_scenario("s2", observed=85.0),   # outcome 0
            make_scenario("s3", observed=None),   # unsettled
        ]
    )
    assert agg.n_scenarios == 3
    assert agg.n_settled == 2
    # market briers: (0.72-1)^2=0.0784, (0.72-0)^2=0.5184 -> mean 0.2984
    assert agg.mean_brier_market == pytest.approx(0.2984)
    # model briers: (0.8-1)^2=0.04, (0.8-0)^2=0.64 -> mean 0.34
    assert agg.mean_brier_model == pytest.approx(0.34)
    assert agg.better_calibrated == "market"


def test_aggregate_no_settled_scenarios():
    _, agg = analyze([make_scenario(observed=None)])
    assert agg.n_settled == 0
    assert agg.mean_brier_market is None
    assert agg.mean_brier_model is None
    assert agg.better_calibrated is None


def test_aggregate_tie():
    agg = aggregate(
        [
            analyze_scenario(make_scenario("a", yes_price=0.8, observed=93.1)),
        ]
    )
    # market prob 0.8 == model prob 0.8 -> identical briers -> tie
    assert agg.better_calibrated == "tie"
