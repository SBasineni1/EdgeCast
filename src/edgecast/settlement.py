"""Settlement stage: observation -> outcome, Brier scores for both sides."""

from edgecast.conditions import satisfies
from edgecast.types import MarketQuote, Observation, Settlement


def settle(
    market: MarketQuote,
    observation: Observation,
    market_prob: float,
    model_prob: float,
) -> Settlement:
    """Resolve the market condition against the observed value and score it.

    Brier score per side is (prob - outcome)^2; lower is better. The
    clamped model probability is scored, keeping scoring consistent with
    the probability reported upstream.
    """
    outcome = (
        1
        if satisfies(observation.observed_value, market.comparator, market.threshold)
        else 0
    )
    brier_market = (market_prob - outcome) ** 2
    brier_model = (model_prob - outcome) ** 2
    return Settlement(
        outcome=outcome,
        observed_value=observation.observed_value,
        brier_market=brier_market,
        brier_model=brier_model,
        brier_diff=brier_model - brier_market,
    )
