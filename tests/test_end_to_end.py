import json
from pathlib import Path

import pytest

from edgecast.cli import main

FIXTURE = Path(__file__).parent.parent / "fixtures" / "scenarios_sample.json"


@pytest.fixture(scope="module")
def output():
    import io
    import contextlib

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = main(["analyze", str(FIXTURE)])
    assert rc == 0
    return json.loads(buf.getvalue())


def by_id(output, scenario_id):
    return next(r for r in output["results"] if r["scenario_id"] == scenario_id)


def test_all_scenarios_present(output):
    assert len(output["results"]) == 6
    assert output["aggregate"]["n_scenarios"] == 6
    assert output["aggregate"]["n_settled"] == 4


def test_s1_model_higher_settled_yes(output):
    r = by_id(output, "nyc-high-2026-07-05")
    assert r["market_prob"] == 0.72
    assert r["model_prob"] == 0.8           # 24/30
    assert r["edge"]["value"] == 0.08
    assert r["edge"]["flag"] == "model_higher"
    assert r["settlement"]["outcome"] == 1  # 93.1 >= 90
    assert r["settlement"]["brier_market"] == 0.0784
    assert r["settlement"]["brier_model"] == 0.04
    assert r["settlement"]["brier_diff"] == -0.0384


def test_s2_market_higher_settled_no(output):
    r = by_id(output, "chi-high-2026-07-06")
    assert r["model_prob"] == 0.333333      # 10/30, rounded
    assert r["edge"]["flag"] == "market_higher"
    assert r["settlement"]["outcome"] == 0  # 76.2 <= 75 is false
    assert r["settlement"]["brier_market"] == 0.36
    assert r["settlement"]["brier_model"] == 0.111111


def test_s3_agreement(output):
    r = by_id(output, "mia-high-2026-07-06")
    assert r["model_prob"] == 0.533333      # 16/30
    assert r["edge"]["flag"] == "agreement" # |0.0333| < 0.05
    assert r["settlement"]["outcome"] == 1  # 92.4 >= 92


def test_s4_model_confidently_wrong(output):
    r = by_id(output, "phx-high-2026-07-07")
    assert r["model_prob"] == 0.9           # 27/30
    assert r["edge"]["flag"] == "model_higher"
    assert r["settlement"]["outcome"] == 0  # 108.5 >= 110 is false
    assert r["settlement"]["brier_model"] == 0.81
    assert r["settlement"]["brier_market"] == 0.09


def test_s5_unsettled_with_clamping(output):
    r = by_id(output, "sea-high-2026-07-08")
    assert r["model_prob_raw"] == 1.0       # all 30 members < 60
    assert r["model_prob"] == 0.967742      # clamped to 30/31
    assert r["settlement"] is None


def test_s6_unsettled_market_higher(output):
    r = by_id(output, "den-high-2026-07-08")
    assert r["model_prob"] == 0.4           # 12/30 strictly > 95
    assert r["edge"]["flag"] == "market_higher"
    assert r["settlement"] is None


def test_aggregate_values(output):
    agg = output["aggregate"]
    # market briers: 0.0784, 0.36, 0.25, 0.09 -> mean 0.1946
    assert agg["mean_brier_market"] == 0.1946
    # model briers: 0.04, 0.111111..., 0.217777..., 0.81 -> mean 0.294722
    assert agg["mean_brier_model"] == 0.294722
    assert agg["better_calibrated"] == "market"
