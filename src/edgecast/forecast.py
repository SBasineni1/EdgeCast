"""Forecast stage: ensemble members -> model-implied probability."""

from edgecast.conditions import satisfies
from edgecast.types import EnsembleForecast, ModelProbability


def model_implied_probability(
    forecast: EnsembleForecast, comparator: str, threshold: float
) -> ModelProbability:
    """Fraction of ensemble members satisfying the market condition.

    The raw fraction is clamped to [1/(n+1), n/(n+1)]: a finite ensemble
    cannot certify probability 0 or 1, and unclamped extremes break
    log-odds math downstream.
    """
    n = len(forecast.members)
    if n == 0:
        raise ValueError("ensemble has no members")
    hits = sum(1 for m in forecast.members if satisfies(m, comparator, threshold))
    raw = hits / n
    lo, hi = 1 / (n + 1), n / (n + 1)
    clamped = min(max(raw, lo), hi)
    return ModelProbability(raw=raw, clamped=clamped, n_members=n)
