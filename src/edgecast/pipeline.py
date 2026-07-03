"""Pipeline orchestration: scenarios -> results -> aggregate."""

from edgecast.edge import DEFAULT_EDGE_THRESHOLD, compute_edge
from edgecast.forecast import model_implied_probability
from edgecast.market import market_implied_probability
from edgecast.settlement import settle
from edgecast.types import Aggregate, Scenario, ScenarioResult


def analyze_scenario(
    scenario: Scenario, edge_threshold: float = DEFAULT_EDGE_THRESHOLD
) -> ScenarioResult:
    market_prob = market_implied_probability(scenario.market)
    model = model_implied_probability(scenario.forecast, scenario.market)
    edge = compute_edge(market_prob, model.clamped, edge_threshold)
    settlement = None
    if scenario.observation is not None:
        settlement = settle(
            scenario.market, scenario.observation, market_prob, model.clamped
        )
    return ScenarioResult(
        scenario_id=scenario.scenario_id,
        market=scenario.market,
        market_prob=market_prob,
        model_prob=model.clamped,
        model_prob_raw=model.raw,
        n_members=model.n_members,
        edge=edge,
        settlement=settlement,
    )


def aggregate(results: list[ScenarioResult]) -> Aggregate:
    settled = [r for r in results if r.settlement is not None]
    n_settled = len(settled)
    if n_settled == 0:
        return Aggregate(
            n_scenarios=len(results),
            n_settled=0,
            mean_brier_market=None,
            mean_brier_model=None,
            better_calibrated=None,
        )
    mean_market = sum(r.settlement.brier_market for r in settled) / n_settled
    mean_model = sum(r.settlement.brier_model for r in settled) / n_settled
    if mean_model < mean_market:
        better = "model"
    elif mean_model > mean_market:
        better = "market"
    else:
        better = "tie"
    return Aggregate(
        n_scenarios=len(results),
        n_settled=n_settled,
        mean_brier_market=mean_market,
        mean_brier_model=mean_model,
        better_calibrated=better,
    )


def analyze(
    scenarios: list[Scenario], edge_threshold: float = DEFAULT_EDGE_THRESHOLD
) -> tuple[list[ScenarioResult], Aggregate]:
    results = [analyze_scenario(s, edge_threshold) for s in scenarios]
    return results, aggregate(results)
