"""Edge stage: market vs model probabilities -> disagreement metrics.

Metrics describe disagreement only; nothing here recommends action.
"""

import math

from edgecast.types import EdgeMetrics

DEFAULT_EDGE_THRESHOLD = 0.05


def _logit(p: float) -> float:
    return math.log(p / (1.0 - p))


def compute_edge(
    market_prob: float, model_prob: float, threshold: float = DEFAULT_EDGE_THRESHOLD
) -> EdgeMetrics:
    """Signed disagreement between model and market.

    Positive value = model considers YES more likely than the market does.
    Callers must pass probabilities strictly inside (0, 1); the market
    price is validated at load time and the model probability is clamped.
    """
    value = model_prob - market_prob
    log_odds_diff = _logit(model_prob) - _logit(market_prob)
    if abs(value) < threshold:
        flag = "agreement"
    elif value > 0:
        flag = "model_higher"
    else:
        flag = "market_higher"
    return EdgeMetrics(value=value, log_odds_diff=log_odds_diff, flag=flag)
