import math

import pytest

from edgecast.edge import DEFAULT_EDGE_THRESHOLD, compute_edge


def test_default_threshold():
    assert DEFAULT_EDGE_THRESHOLD == 0.05


def test_model_higher():
    e = compute_edge(market_prob=0.72, model_prob=0.80)
    assert e.value == pytest.approx(0.08)
    # logit(0.8) - logit(0.72) = 1.386294 - 0.944462 = 0.441833
    assert e.log_odds_diff == pytest.approx(
        math.log(0.8 / 0.2) - math.log(0.72 / 0.28)
    )
    assert e.flag == "model_higher"


def test_market_higher():
    e = compute_edge(market_prob=0.60, model_prob=0.40)
    assert e.value == pytest.approx(-0.20)
    assert e.flag == "market_higher"


def test_agreement_below_threshold():
    e = compute_edge(market_prob=0.50, model_prob=0.53)
    assert e.flag == "agreement"


def test_exactly_at_threshold_is_flagged():
    # spec: flagged when |edge| >= threshold
    e = compute_edge(market_prob=0.50, model_prob=0.55)
    assert e.flag == "model_higher"


def test_custom_threshold():
    e = compute_edge(market_prob=0.50, model_prob=0.53, threshold=0.02)
    assert e.flag == "model_higher"


def test_log_odds_magnifies_tail_moves():
    tail = compute_edge(market_prob=0.02, model_prob=0.05)
    mid = compute_edge(market_prob=0.50, model_prob=0.53)
    assert abs(tail.log_odds_diff) > abs(mid.log_odds_diff)
