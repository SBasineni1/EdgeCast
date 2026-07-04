"""Consensus math: trailing-bias blend of deterministic models + normal bucket mass."""

import math

from edgecast.types import MarketQuote

BIAS_WINDOW = 15        # trailing graded days used for bias and sigma
MIN_GRADED_DAYS = 5     # below this: bias 0, sigma default
SIGMA_FLOOR = 1.0       # deg F; a finite sample cannot certify near-zero spread
SIGMA_DEFAULT = 2.5     # deg F; ~raw-model MAE, deliberately wide until calibrated


def trailing_bias(errors: list[float]) -> float:
    if len(errors) < MIN_GRADED_DAYS:
        return 0.0
    return sum(errors) / len(errors)


def consensus_sigma(errors: list[float]) -> float:
    if len(errors) < MIN_GRADED_DAYS:
        return SIGMA_DEFAULT
    mean = sum(errors) / len(errors)
    var = sum((e - mean) ** 2 for e in errors) / len(errors)
    return max(math.sqrt(var), SIGMA_FLOOR)


def consensus_point(predictions: dict[str, float], biases: dict[str, float]) -> float:
    if not predictions:
        raise ValueError("consensus needs at least one model prediction")
    return sum(p - biases.get(m, 0.0) for m, p in predictions.items()) / len(predictions)


def _phi(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def normal_mass(market: MarketQuote, mu: float, sigma: float) -> float:
    """P(the settled integer high satisfies the market) under Normal(mu, sigma).

    Kalshi settles on integer temps with strict comparators, so each bucket's
    continuous range extends 0.5 past its integer edges: 'greater 100' = 101+
    -> (100.5, inf); 'less 93' = 92- -> (-inf, 92.5); between 95 96 -> [94.5, 96.5).
    """
    if market.comparator == "between":
        assert market.threshold_low is not None and market.threshold_high is not None
        return _phi((market.threshold_high + 0.5 - mu) / sigma) - _phi(
            (market.threshold_low - 0.5 - mu) / sigma
        )
    t = market.threshold
    assert t is not None
    if market.comparator == ">":
        return 1.0 - _phi((t + 0.5 - mu) / sigma)
    if market.comparator == ">=":
        return 1.0 - _phi((t - 0.5 - mu) / sigma)
    if market.comparator == "<":
        return _phi((t - 0.5 - mu) / sigma)
    if market.comparator == "<=":
        return _phi((t + 0.5 - mu) / sigma)
    raise ValueError(f"unknown comparator: {market.comparator!r}")
