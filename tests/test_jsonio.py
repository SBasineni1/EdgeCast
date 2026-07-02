import copy

import pytest

from edgecast.jsonio import (
    SCHEMA_VERSION,
    ScenarioValidationError,
    build_output,
    load_scenarios,
)
from edgecast.pipeline import analyze

VALID = {
    "schema_version": "1.0",
    "scenarios": [
        {
            "scenario_id": "nyc-high-2026-07-05",
            "market": {
                "market_id": "MOCK-KXHIGHNY-90",
                "question": "NYC high temp >= 90F on 2026-07-05?",
                "location": "NYC",
                "variable": "high_temp_f",
                "comparator": ">=",
                "threshold": 90.0,
                "event_date": "2026-07-05",
                "yes_price": 0.72,
            },
            "forecast": {
                "source": "mock-ensemble",
                "issued_at": "2026-07-03T12:00:00Z",
                "members": [88.0, 88.5, 91.0, 91.5, 92.0],
            },
            "observation": {"observed_value": 93.1},
        }
    ],
}


def invalid(mutate):
    data = copy.deepcopy(VALID)
    mutate(data["scenarios"][0])
    return data


def test_loads_valid_scenario():
    scenarios = load_scenarios(VALID)
    assert len(scenarios) == 1
    s = scenarios[0]
    assert s.scenario_id == "nyc-high-2026-07-05"
    assert s.market.yes_price == 0.72
    assert s.forecast.members == (88.0, 88.5, 91.0, 91.5, 92.0)
    assert s.observation is not None
    assert s.observation.observed_value == 93.1


def test_observation_is_optional():
    data = invalid(lambda s: s.pop("observation"))
    assert load_scenarios(data)[0].observation is None


@pytest.mark.parametrize(
    ("mutate", "field"),
    [
        (lambda s: s["market"].update(yes_price=1.0), "yes_price"),
        (lambda s: s["market"].update(yes_price=0.0), "yes_price"),
        (lambda s: s["market"].update(yes_price=1.5), "yes_price"),
        (lambda s: s["market"].update(comparator="=="), "comparator"),
        (lambda s: s["market"].update(event_date="July 5"), "event_date"),
        (lambda s: s["market"].pop("threshold"), "threshold"),
        (lambda s: s["forecast"].update(members=[]), "members"),
        (lambda s: s["forecast"].update(members=[88.0, "hot"]), "members"),
        (lambda s: s["forecast"].update(members=[88.0, True]), "members"),
        (lambda s: s["forecast"].update(issued_at="yesterday"), "issued_at"),
        (lambda s: s.update(scenario_id=""), "scenario_id"),
    ],
)
def test_invalid_scenarios_rejected_with_field_named(mutate, field):
    with pytest.raises(ScenarioValidationError) as exc:
        load_scenarios(invalid(mutate))
    assert field in str(exc.value)


def test_duplicate_scenario_ids_rejected():
    data = copy.deepcopy(VALID)
    data["scenarios"].append(copy.deepcopy(data["scenarios"][0]))
    with pytest.raises(ScenarioValidationError, match="scenario_id"):
        load_scenarios(data)


def test_empty_scenarios_rejected():
    with pytest.raises(ScenarioValidationError, match="scenarios"):
        load_scenarios({"schema_version": "1.0", "scenarios": []})


def test_build_output_shape_and_rounding():
    scenarios = load_scenarios(VALID)
    results, agg = analyze(scenarios)
    out = build_output(results, agg, generated_at="2026-07-02T18:00:00+00:00")
    assert out["schema_version"] == SCHEMA_VERSION
    assert out["generated_at"] == "2026-07-02T18:00:00+00:00"
    r = out["results"][0]
    assert r["scenario_id"] == "nyc-high-2026-07-05"
    assert r["market_prob"] == 0.72
    # 3 of 5 members >= 90 -> raw 0.6, clamp bounds [1/6, 5/6] leave it alone
    assert r["model_prob"] == 0.6
    assert r["model_prob_raw"] == 0.6
    assert r["n_members"] == 5
    assert r["edge"]["flag"] == "market_higher"
    # log-odds diff rounded to 6 decimal places
    assert isinstance(r["edge"]["log_odds_diff"], float)
    assert r["edge"]["log_odds_diff"] == round(r["edge"]["log_odds_diff"], 6)
    assert r["settlement"]["outcome"] == 1
    assert out["aggregate"]["n_settled"] == 1
    assert out["aggregate"]["better_calibrated"] == "market"


def test_build_output_null_settlement_and_aggregate():
    data = invalid(lambda s: s.pop("observation"))
    results, agg = analyze(load_scenarios(data))
    out = build_output(results, agg, generated_at="2026-07-02T18:00:00+00:00")
    assert out["results"][0]["settlement"] is None
    assert out["aggregate"]["mean_brier_market"] is None
    assert out["aggregate"]["better_calibrated"] is None
