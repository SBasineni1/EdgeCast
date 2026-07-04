"""Forecast stage: ensemble members or consensus normal -> model-implied probability."""

from edgecast.conditions import satisfies_market
from edgecast.consensus import normal_mass
from edgecast.types import (
    EnsembleForecast,
    MarketQuote,
    ModelProbability,
    NormalForecast,
)

NORMAL_CLAMP = 0.001  # a fitted normal cannot certify 0 or 1 either


def model_implied_probability(
    forecast: EnsembleForecast | NormalForecast, market: MarketQuote
) -> ModelProbability:
    """Probability the market condition holds under the forecast.

    Ensemble: fraction of members satisfying the condition, clamped to
    [1/(n+1), n/(n+1)] — a finite ensemble cannot certify probability 0 or 1,
    and unclamped extremes break log-odds math downstream. Normal consensus:
    integer-settlement bucket mass, clamped to [0.001, 0.999] for the same
    log-odds reason; n_members reports the number of blended models.
    """
    if isinstance(forecast, NormalForecast):
        raw = normal_mass(market, forecast.mu, forecast.sigma)
        clamped = min(max(raw, NORMAL_CLAMP), 1.0 - NORMAL_CLAMP)
        return ModelProbability(raw=raw, clamped=clamped, n_members=forecast.n_models)
    n = len(forecast.members)
    if n == 0:
        raise ValueError("ensemble has no members")
    hits = sum(1 for m in forecast.members if satisfies_market(m, market))
    raw = hits / n
    lo, hi = 1 / (n + 1), n / (n + 1)
    clamped = min(max(raw, lo), hi)
    return ModelProbability(raw=raw, clamped=clamped, n_members=n)
