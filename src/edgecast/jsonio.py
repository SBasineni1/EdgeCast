"""JSON boundary: parse and validate input scenarios, serialize results.

Validation is strict and fail-fast: fixtures are hand-authored, so any
invalid field means a typo, and silence would hide it. Every error names
the scenario and field.
"""

import json
from datetime import date, datetime
from pathlib import Path

from edgecast.conditions import COMPARATORS
from edgecast.types import (
    Aggregate,
    EnsembleForecast,
    MarketQuote,
    Observation,
    Scenario,
    ScenarioResult,
)

SCHEMA_VERSION = "1.0"
OUTPUT_SCHEMA_VERSION = "1.1"

_MARKET_STR_FIELDS = ("market_id", "question", "location", "variable")


class ScenarioValidationError(ValueError):
    """Invalid scenario input; message names the scenario and field."""


def _fail(scenario_id: str, field: str, message: str) -> None:
    raise ScenarioValidationError(f"scenario '{scenario_id}': field '{field}' {message}")


def _require_number(scenario_id: str, field: str, value: object) -> float:
    # bool is a subclass of int; reject it explicitly
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _fail(scenario_id, field, f"must be a number (got {value!r})")
    return float(value)


def _require_str(scenario_id: str, field: str, value: object) -> str:
    if not isinstance(value, str) or not value:
        _fail(scenario_id, field, f"must be a non-empty string (got {value!r})")
    return value


def _parse_market(scenario_id: str, raw: object) -> MarketQuote:
    if not isinstance(raw, dict):
        _fail(scenario_id, "market", "must be an object")
    for key in (*_MARKET_STR_FIELDS, "comparator", "threshold", "event_date", "yes_price"):
        if key not in raw:
            _fail(scenario_id, f"market.{key}", "is required")
    comparator = _require_str(scenario_id, "market.comparator", raw["comparator"])
    if comparator not in COMPARATORS:
        _fail(
            scenario_id,
            "market.comparator",
            f"must be one of {COMPARATORS} (got {comparator!r})",
        )
    threshold = _require_number(scenario_id, "market.threshold", raw["threshold"])
    yes_price = _require_number(scenario_id, "market.yes_price", raw["yes_price"])
    if not 0.0 < yes_price < 1.0:
        _fail(
            scenario_id,
            "market.yes_price",
            f"must be strictly between 0 and 1 (got {yes_price})",
        )
    event_date = _require_str(scenario_id, "market.event_date", raw["event_date"])
    try:
        date.fromisoformat(event_date)
    except ValueError:
        _fail(scenario_id, "market.event_date", f"must be an ISO date (got {event_date!r})")
    return MarketQuote(
        market_id=_require_str(scenario_id, "market.market_id", raw["market_id"]),
        question=_require_str(scenario_id, "market.question", raw["question"]),
        location=_require_str(scenario_id, "market.location", raw["location"]),
        variable=_require_str(scenario_id, "market.variable", raw["variable"]),
        comparator=comparator,
        threshold=threshold,
        event_date=event_date,
        yes_price=yes_price,
    )


def _parse_forecast(scenario_id: str, raw: object) -> EnsembleForecast:
    if not isinstance(raw, dict):
        _fail(scenario_id, "forecast", "must be an object")
    for key in ("source", "issued_at", "members"):
        if key not in raw:
            _fail(scenario_id, f"forecast.{key}", "is required")
    issued_at = _require_str(scenario_id, "forecast.issued_at", raw["issued_at"])
    try:
        datetime.fromisoformat(issued_at)
    except ValueError:
        _fail(
            scenario_id,
            "forecast.issued_at",
            f"must be an ISO datetime (got {issued_at!r})",
        )
    members_raw = raw["members"]
    if not isinstance(members_raw, list) or not members_raw:
        _fail(scenario_id, "forecast.members", "must be a non-empty list of numbers")
    members = tuple(
        _require_number(scenario_id, "forecast.members", m) for m in members_raw
    )
    return EnsembleForecast(
        source=_require_str(scenario_id, "forecast.source", raw["source"]),
        issued_at=issued_at,
        members=members,
    )


def _parse_observation(scenario_id: str, raw: object) -> Observation:
    if not isinstance(raw, dict) or "observed_value" not in raw:
        _fail(scenario_id, "observation.observed_value", "is required")
    return Observation(
        observed_value=_require_number(
            scenario_id, "observation.observed_value", raw["observed_value"]
        )
    )


def load_scenarios(data: dict) -> list[Scenario]:
    if not isinstance(data, dict):
        _fail("<input>", "data", "must be an object")
    if data.get("schema_version") != SCHEMA_VERSION:
        _fail(
            "<input>",
            "schema_version",
            f"must be {SCHEMA_VERSION!r} (got {data.get('schema_version')!r})",
        )
    raw_scenarios = data.get("scenarios")
    if not isinstance(raw_scenarios, list) or not raw_scenarios:
        _fail("<input>", "scenarios", "must be a non-empty list")
    scenarios: list[Scenario] = []
    seen_ids: set[str] = set()
    for raw in raw_scenarios:
        if not isinstance(raw, dict):
            _fail("<unknown>", "scenario", "must be an object")
        scenario_id = raw.get("scenario_id")
        if not isinstance(scenario_id, str) or not scenario_id:
            _fail(str(scenario_id), "scenario_id", "must be a non-empty string")
        if scenario_id in seen_ids:
            _fail(scenario_id, "scenario_id", "is duplicated; ids must be unique")
        seen_ids.add(scenario_id)
        for key in ("market", "forecast"):
            if key not in raw:
                _fail(scenario_id, key, "is required")
        observation = None
        if "observation" in raw and raw["observation"] is not None:
            observation = _parse_observation(scenario_id, raw["observation"])
        scenarios.append(
            Scenario(
                scenario_id=scenario_id,
                market=_parse_market(scenario_id, raw["market"]),
                forecast=_parse_forecast(scenario_id, raw["forecast"]),
                observation=observation,
            )
        )
    return scenarios


def read_scenarios_file(path: str | Path) -> list[Scenario]:
    with open(path, encoding="utf-8") as f:
        return load_scenarios(json.load(f))


def _round6(x: float) -> float:
    return round(x, 6)


def _result_dict(r: ScenarioResult) -> dict:
    settlement = None
    if r.settlement is not None:
        settlement = {
            "outcome": r.settlement.outcome,
            "observed_value": _round6(r.settlement.observed_value),
            "brier_market": _round6(r.settlement.brier_market),
            "brier_model": _round6(r.settlement.brier_model),
            "brier_diff": _round6(r.settlement.brier_diff),
        }
    return {
        "scenario_id": r.scenario_id,
        "market": {
            "question": r.market.question,
            "location": r.market.location,
            "variable": r.market.variable,
            "comparator": r.market.comparator,
            "threshold": r.market.threshold,
            "event_date": r.market.event_date,
        },
        "market_prob": _round6(r.market_prob),
        "model_prob": _round6(r.model_prob),
        "model_prob_raw": _round6(r.model_prob_raw),
        "n_members": r.n_members,
        "edge": {
            "value": _round6(r.edge.value),
            "log_odds_diff": _round6(r.edge.log_odds_diff),
            "flag": r.edge.flag,
        },
        "settlement": settlement,
    }


def build_output(
    results: list[ScenarioResult], agg: Aggregate, generated_at: str
) -> dict:
    return {
        "schema_version": OUTPUT_SCHEMA_VERSION,
        "generated_at": generated_at,
        "results": [_result_dict(r) for r in results],
        "aggregate": {
            "n_scenarios": agg.n_scenarios,
            "n_settled": agg.n_settled,
            "mean_brier_market": (
                _round6(agg.mean_brier_market)
                if agg.mean_brier_market is not None
                else None
            ),
            "mean_brier_model": (
                _round6(agg.mean_brier_model)
                if agg.mean_brier_model is not None
                else None
            ),
            "better_calibrated": agg.better_calibrated,
        },
    }
