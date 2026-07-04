"""Frozen dataclasses shared across pipeline stages."""

from dataclasses import dataclass


@dataclass(frozen=True)
class MarketQuote:
    market_id: str
    question: str
    location: str
    variable: str
    comparator: str  # one of edgecast.conditions.COMPARATORS
    event_date: str  # ISO date, e.g. "2026-07-05"
    yes_price: float  # strictly between 0 and 1
    threshold: float | None = None       # binary comparators only
    threshold_low: float | None = None   # between only, inclusive
    threshold_high: float | None = None  # between only, inclusive


@dataclass(frozen=True)
class EnsembleForecast:
    source: str
    issued_at: str  # ISO datetime
    members: tuple[float, ...]


@dataclass(frozen=True)
class NormalForecast:
    source: str
    issued_at: str  # ISO datetime
    mu: float       # consensus predicted high, deg F
    sigma: float    # calibrated error spread, deg F
    n_models: int   # source models blended


@dataclass(frozen=True)
class Observation:
    observed_value: float


@dataclass(frozen=True)
class Scenario:
    scenario_id: str
    market: MarketQuote
    forecast: EnsembleForecast | NormalForecast
    observation: Observation | None = None


@dataclass(frozen=True)
class ModelProbability:
    raw: float      # exact member fraction; may be 0.0 or 1.0
    clamped: float  # raw clamped to [1/(n+1), n/(n+1)]
    n_members: int


@dataclass(frozen=True)
class EdgeMetrics:
    value: float          # model_prob - market_prob
    log_odds_diff: float  # logit(model_prob) - logit(market_prob)
    flag: str             # "model_higher" | "market_higher" | "agreement"


@dataclass(frozen=True)
class Settlement:
    outcome: int  # 1 if the market condition held, else 0
    observed_value: float
    brier_market: float
    brier_model: float
    brier_diff: float  # brier_model - brier_market; negative = model better


@dataclass(frozen=True)
class ScenarioResult:
    scenario_id: str
    market: MarketQuote
    market_prob: float
    model_prob: float      # clamped
    model_prob_raw: float
    n_members: int
    edge: EdgeMetrics
    settlement: Settlement | None


@dataclass(frozen=True)
class Aggregate:
    n_scenarios: int
    n_settled: int
    mean_brier_market: float | None  # None when n_settled == 0
    mean_brier_model: float | None
    better_calibrated: str | None    # "model" | "market" | "tie" | None
