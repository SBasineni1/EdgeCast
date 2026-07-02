# EdgeCast Forecast MVP 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Python CLI that reads mock weather-market scenarios from JSON and emits market-implied probability, model-implied probability, disagreement metrics, and (where observations exist) settlement outcomes with Brier scores — plus an aggregate calibration comparison.

**Architecture:** Scenario-based batch pipeline. Each pipeline stage (market, forecast, edge, settlement) is a pure function over frozen dataclasses in its own module; `pipeline.py` orchestrates, `jsonio.py` owns the JSON boundary (parse/validate in, serialize out), `cli.py` is a thin argparse wrapper. Spec: `docs/superpowers/specs/2026-07-02-forecast-mvp1-design.md`.

**Tech Stack:** Python ≥ 3.12, stdlib only (no runtime dependencies). Tooling: `uv` for project/env management, `pytest` for tests, hatchling build backend.

## Global Constraints

- **No agent commits.** The user commits manually. Never run `git commit`/`git push`; never add `Co-Authored-By` trailers. Tasks end when their tests pass.
- Binary yes/no threshold markets only. No UI, no real APIs, no trading/sizing/Kelly/portfolio logic, no financial-advice language anywhere (code, comments, docstrings, CLI help).
- Runtime dependencies: none (stdlib only). Dev dependency: pytest ≥ 8.
- `requires-python = ">=3.12"`.
- Comparators: exactly `>=`, `>`, `<=`, `<`.
- `yes_price` must be strictly between 0 and 1, exclusive (refines the spec's [0,1]: price exactly 0/1 makes log-odds infinite and means a degenerate market).
- Model probability clamped to `[1/(n+1), n/(n+1)]`; both raw and clamped reported.
- Edge flag threshold default 0.05; flagged when `|edge| >= threshold`.
- All floats in output JSON rounded to 6 decimal places.
- Output JSON `schema_version` is `"1.0"`.
- All commands run from the repo root: `/Users/suchitbasineni/Documents/GitHub/EdgeCast`.

---

### Task 1: Project scaffold

**Files:**
- Create: `pyproject.toml`
- Create: `src/edgecast/__init__.py`
- Create: `.gitignore`
- Test: `tests/test_package.py`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: an installable `edgecast` package importable in tests; `uv run pytest` works.

- [ ] **Step 1: Write pyproject.toml**

```toml
[project]
name = "edgecast"
version = "0.1.0"
description = "Weather prediction-market intelligence: compares market-implied and model-implied probabilities and verifies them against observations"
requires-python = ">=3.12"
dependencies = []

[project.scripts]
edgecast = "edgecast.cli:main"

[dependency-groups]
dev = ["pytest>=8"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/edgecast"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 2: Create package init and .gitignore**

`src/edgecast/__init__.py`:

```python
"""EdgeCast Forecast: weather prediction-market vs forecast-model verification."""

__version__ = "0.1.0"
```

`.gitignore`:

```
__pycache__/
*.pyc
.venv/
dist/
.pytest_cache/
*.egg-info/
```

- [ ] **Step 3: Write the failing test**

`tests/test_package.py`:

```python
import edgecast


def test_package_importable():
    assert edgecast.__version__ == "0.1.0"
```

- [ ] **Step 4: Sync env and run the test**

Run: `uv sync && uv run pytest tests/test_package.py -v`
Expected: PASS (1 passed). If import fails, the src layout/hatchling config in Step 1 is wrong — fix before proceeding.

---

### Task 2: Domain types, comparators, market probability

**Files:**
- Create: `src/edgecast/types.py`
- Create: `src/edgecast/conditions.py`
- Create: `src/edgecast/market.py`
- Test: `tests/test_conditions.py`, `tests/test_market.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `edgecast.types`: frozen dataclasses `MarketQuote`, `EnsembleForecast`, `Observation`, `Scenario`, `ModelProbability`, `EdgeMetrics`, `Settlement`, `ScenarioResult`, `Aggregate` (exact fields below — later tasks rely on these names).
  - `edgecast.conditions.COMPARATORS: tuple[str, ...]` and `satisfies(value: float, comparator: str, threshold: float) -> bool`.
  - `edgecast.market.market_implied_probability(quote: MarketQuote) -> float`.

- [ ] **Step 1: Write the failing tests**

`tests/test_conditions.py`:

```python
import pytest

from edgecast.conditions import COMPARATORS, satisfies


def test_comparator_whitelist():
    assert COMPARATORS == (">=", ">", "<=", "<")


@pytest.mark.parametrize(
    ("value", "comparator", "threshold", "expected"),
    [
        (90.0, ">=", 90.0, True),   # boundary equality satisfies >=
        (89.9, ">=", 90.0, False),
        (90.0, ">", 90.0, False),   # boundary equality does NOT satisfy >
        (90.1, ">", 90.0, True),
        (75.0, "<=", 75.0, True),
        (75.1, "<=", 75.0, False),
        (60.0, "<", 60.0, False),
        (59.9, "<", 60.0, True),
    ],
)
def test_satisfies(value, comparator, threshold, expected):
    assert satisfies(value, comparator, threshold) is expected


def test_satisfies_rejects_unknown_comparator():
    with pytest.raises(ValueError, match="comparator"):
        satisfies(1.0, "==", 1.0)
```

`tests/test_market.py`:

```python
from edgecast.market import market_implied_probability
from edgecast.types import MarketQuote


def make_quote(yes_price: float) -> MarketQuote:
    return MarketQuote(
        market_id="MOCK-1",
        question="NYC high temp >= 90F on 2026-07-05?",
        location="NYC",
        variable="high_temp_f",
        comparator=">=",
        threshold=90.0,
        event_date="2026-07-05",
        yes_price=yes_price,
    )


def test_market_probability_is_yes_price():
    assert market_implied_probability(make_quote(0.72)) == 0.72
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_conditions.py tests/test_market.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'edgecast.conditions'` (and `edgecast.market`).

- [ ] **Step 3: Write the implementation**

`src/edgecast/conditions.py`:

```python
"""Threshold comparison shared by the forecast and settlement stages."""

COMPARATORS: tuple[str, ...] = (">=", ">", "<=", "<")


def satisfies(value: float, comparator: str, threshold: float) -> bool:
    """Return True when `value <comparator> threshold` holds."""
    if comparator == ">=":
        return value >= threshold
    if comparator == ">":
        return value > threshold
    if comparator == "<=":
        return value <= threshold
    if comparator == "<":
        return value < threshold
    raise ValueError(f"unknown comparator: {comparator!r}")
```

`src/edgecast/types.py`:

```python
"""Frozen dataclasses shared across pipeline stages."""

from dataclasses import dataclass


@dataclass(frozen=True)
class MarketQuote:
    market_id: str
    question: str
    location: str
    variable: str
    comparator: str  # one of edgecast.conditions.COMPARATORS
    threshold: float
    event_date: str  # ISO date, e.g. "2026-07-05"
    yes_price: float  # strictly between 0 and 1


@dataclass(frozen=True)
class EnsembleForecast:
    source: str
    issued_at: str  # ISO datetime
    members: tuple[float, ...]


@dataclass(frozen=True)
class Observation:
    observed_value: float


@dataclass(frozen=True)
class Scenario:
    scenario_id: str
    market: MarketQuote
    forecast: EnsembleForecast
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
```

`src/edgecast/market.py`:

```python
"""Market stage: quote -> market-implied probability."""

from edgecast.types import MarketQuote


def market_implied_probability(quote: MarketQuote) -> float:
    """Read the YES price directly as a probability.

    De-vigging (bid/ask, fees) is deliberately deferred; when real market
    data arrives, that adjustment lands here.
    """
    return quote.yes_price
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_conditions.py tests/test_market.py -v`
Expected: PASS (all tests).

---

### Task 3: Forecast stage — ensemble to model probability

**Files:**
- Create: `src/edgecast/forecast.py`
- Test: `tests/test_forecast.py`

**Interfaces:**
- Consumes: `edgecast.conditions.satisfies`, `edgecast.types.EnsembleForecast`, `edgecast.types.ModelProbability`.
- Produces: `edgecast.forecast.model_implied_probability(forecast: EnsembleForecast, comparator: str, threshold: float) -> ModelProbability`.

- [ ] **Step 1: Write the failing tests**

`tests/test_forecast.py`:

```python
import pytest

from edgecast.forecast import model_implied_probability
from edgecast.types import EnsembleForecast


def make_forecast(members: list[float]) -> EnsembleForecast:
    return EnsembleForecast(
        source="mock-ensemble",
        issued_at="2026-07-03T12:00:00Z",
        members=tuple(members),
    )


def test_fraction_of_members_satisfying():
    # 3 of 4 members >= 90
    fc = make_forecast([88.0, 90.0, 91.0, 95.0])
    mp = model_implied_probability(fc, ">=", 90.0)
    assert mp.raw == 0.75
    assert mp.clamped == 0.75  # inside [0.2, 0.8] for n=4
    assert mp.n_members == 4


def test_all_members_yes_clamps_below_one():
    fc = make_forecast([91.0] * 30)
    mp = model_implied_probability(fc, ">=", 90.0)
    assert mp.raw == 1.0
    assert mp.clamped == pytest.approx(30 / 31)


def test_no_members_yes_clamps_above_zero():
    fc = make_forecast([85.0] * 30)
    mp = model_implied_probability(fc, ">=", 90.0)
    assert mp.raw == 0.0
    assert mp.clamped == pytest.approx(1 / 31)


def test_empty_ensemble_rejected():
    fc = make_forecast([])
    with pytest.raises(ValueError, match="members"):
        model_implied_probability(fc, ">=", 90.0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_forecast.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'edgecast.forecast'`.

- [ ] **Step 3: Write the implementation**

`src/edgecast/forecast.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_forecast.py -v`
Expected: PASS (4 tests).

---

### Task 4: Edge stage — disagreement metrics

**Files:**
- Create: `src/edgecast/edge.py`
- Test: `tests/test_edge.py`

**Interfaces:**
- Consumes: `edgecast.types.EdgeMetrics`.
- Produces:
  - `edgecast.edge.DEFAULT_EDGE_THRESHOLD: float = 0.05`
  - `edgecast.edge.compute_edge(market_prob: float, model_prob: float, threshold: float = DEFAULT_EDGE_THRESHOLD) -> EdgeMetrics`

- [ ] **Step 1: Write the failing tests**

`tests/test_edge.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_edge.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'edgecast.edge'`.

- [ ] **Step 3: Write the implementation**

`src/edgecast/edge.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_edge.py -v`
Expected: PASS (7 tests).

---

### Task 5: Settlement stage — outcome and Brier scores

**Files:**
- Create: `src/edgecast/settlement.py`
- Test: `tests/test_settlement.py`

**Interfaces:**
- Consumes: `edgecast.conditions.satisfies`, `edgecast.types.MarketQuote`, `edgecast.types.Observation`, `edgecast.types.Settlement`.
- Produces: `edgecast.settlement.settle(market: MarketQuote, observation: Observation, market_prob: float, model_prob: float) -> Settlement`.

- [ ] **Step 1: Write the failing tests**

`tests/test_settlement.py`:

```python
import pytest

from edgecast.settlement import settle
from edgecast.types import MarketQuote, Observation


def make_quote(comparator: str = ">=", threshold: float = 90.0) -> MarketQuote:
    return MarketQuote(
        market_id="MOCK-1",
        question="test",
        location="NYC",
        variable="high_temp_f",
        comparator=comparator,
        threshold=threshold,
        event_date="2026-07-05",
        yes_price=0.72,
    )


def test_settles_yes_and_scores():
    s = settle(make_quote(), Observation(93.1), market_prob=0.72, model_prob=0.80)
    assert s.outcome == 1
    assert s.observed_value == 93.1
    assert s.brier_market == pytest.approx((0.72 - 1) ** 2)  # 0.0784
    assert s.brier_model == pytest.approx((0.80 - 1) ** 2)   # 0.04
    assert s.brier_diff == pytest.approx(0.04 - 0.0784)


def test_settles_no():
    s = settle(make_quote(), Observation(87.0), market_prob=0.72, model_prob=0.80)
    assert s.outcome == 0
    assert s.brier_market == pytest.approx(0.72**2)
    assert s.brier_model == pytest.approx(0.80**2)


def test_boundary_equality_settles_per_comparator():
    # observed exactly at threshold: >= settles YES, > settles NO
    at = Observation(90.0)
    assert settle(make_quote(">="), at, 0.5, 0.5).outcome == 1
    assert settle(make_quote(">"), at, 0.5, 0.5).outcome == 0


def test_perfect_and_worst_brier():
    s = settle(make_quote(), Observation(95.0), market_prob=0.5, model_prob=0.5)
    assert s.brier_market == pytest.approx(0.25)
    assert s.brier_diff == pytest.approx(0.0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_settlement.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'edgecast.settlement'`.

- [ ] **Step 3: Write the implementation**

`src/edgecast/settlement.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_settlement.py -v`
Expected: PASS (4 tests).

---

### Task 6: Pipeline — orchestration and aggregation

**Files:**
- Create: `src/edgecast/pipeline.py`
- Test: `tests/test_pipeline.py`

**Interfaces:**
- Consumes: everything from Tasks 2–5 (`market_implied_probability`, `model_implied_probability`, `compute_edge`, `settle`, `DEFAULT_EDGE_THRESHOLD`, all types).
- Produces:
  - `edgecast.pipeline.analyze_scenario(scenario: Scenario, edge_threshold: float = DEFAULT_EDGE_THRESHOLD) -> ScenarioResult`
  - `edgecast.pipeline.aggregate(results: list[ScenarioResult]) -> Aggregate`
  - `edgecast.pipeline.analyze(scenarios: list[Scenario], edge_threshold: float = DEFAULT_EDGE_THRESHOLD) -> tuple[list[ScenarioResult], Aggregate]`

- [ ] **Step 1: Write the failing tests**

`tests/test_pipeline.py`:

```python
import pytest

from edgecast.pipeline import aggregate, analyze, analyze_scenario
from edgecast.types import EnsembleForecast, MarketQuote, Observation, Scenario


def make_scenario(
    scenario_id: str = "s1",
    yes_price: float = 0.72,
    members: list[float] | None = None,
    observed: float | None = 93.1,
) -> Scenario:
    if members is None:
        # 24 of 30 >= 90 -> model prob 0.8
        members = [88.0] * 6 + [91.0] * 24
    return Scenario(
        scenario_id=scenario_id,
        market=MarketQuote(
            market_id=f"MOCK-{scenario_id}",
            question="NYC high temp >= 90F on 2026-07-05?",
            location="NYC",
            variable="high_temp_f",
            comparator=">=",
            threshold=90.0,
            event_date="2026-07-05",
            yes_price=yes_price,
        ),
        forecast=EnsembleForecast(
            source="mock-ensemble",
            issued_at="2026-07-03T12:00:00Z",
            members=tuple(members),
        ),
        observation=Observation(observed) if observed is not None else None,
    )


def test_analyze_scenario_settled():
    r = analyze_scenario(make_scenario())
    assert r.scenario_id == "s1"
    assert r.market_prob == 0.72
    assert r.model_prob == pytest.approx(0.8)
    assert r.model_prob_raw == pytest.approx(0.8)
    assert r.n_members == 30
    assert r.edge.value == pytest.approx(0.08)
    assert r.edge.flag == "model_higher"
    assert r.settlement is not None
    assert r.settlement.outcome == 1
    assert r.settlement.brier_model == pytest.approx(0.04)


def test_analyze_scenario_unsettled_has_null_settlement():
    r = analyze_scenario(make_scenario(observed=None))
    assert r.settlement is None
    assert r.edge.flag == "model_higher"  # edge analysis still runs


def test_edge_threshold_is_passed_through():
    r = analyze_scenario(make_scenario(), edge_threshold=0.10)
    assert r.edge.flag == "agreement"  # 0.08 < 0.10


def test_aggregate_over_settled_only():
    results, agg = analyze(
        [
            make_scenario("s1", observed=93.1),   # outcome 1
            make_scenario("s2", observed=85.0),   # outcome 0
            make_scenario("s3", observed=None),   # unsettled
        ]
    )
    assert agg.n_scenarios == 3
    assert agg.n_settled == 2
    # market briers: (0.72-1)^2=0.0784, (0.72-0)^2=0.5184 -> mean 0.2984
    assert agg.mean_brier_market == pytest.approx(0.2984)
    # model briers: (0.8-1)^2=0.04, (0.8-0)^2=0.64 -> mean 0.34
    assert agg.mean_brier_model == pytest.approx(0.34)
    assert agg.better_calibrated == "market"


def test_aggregate_no_settled_scenarios():
    _, agg = analyze([make_scenario(observed=None)])
    assert agg.n_settled == 0
    assert agg.mean_brier_market is None
    assert agg.mean_brier_model is None
    assert agg.better_calibrated is None


def test_aggregate_tie():
    agg = aggregate(
        [
            analyze_scenario(make_scenario("a", yes_price=0.8, observed=93.1)),
        ]
    )
    # market prob 0.8 == model prob 0.8 -> identical briers -> tie
    assert agg.better_calibrated == "tie"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_pipeline.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'edgecast.pipeline'`.

- [ ] **Step 3: Write the implementation**

`src/edgecast/pipeline.py`:

```python
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
    model = model_implied_probability(
        scenario.forecast, scenario.market.comparator, scenario.market.threshold
    )
    edge = compute_edge(market_prob, model.clamped, edge_threshold)
    settlement = None
    if scenario.observation is not None:
        settlement = settle(
            scenario.market, scenario.observation, market_prob, model.clamped
        )
    return ScenarioResult(
        scenario_id=scenario.scenario_id,
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_pipeline.py -v`
Expected: PASS (6 tests).

---

### Task 7: JSON boundary — load/validate input, build output

**Files:**
- Create: `src/edgecast/jsonio.py`
- Test: `tests/test_jsonio.py`

**Interfaces:**
- Consumes: `edgecast.conditions.COMPARATORS`, all types, `ScenarioResult`, `Aggregate`.
- Produces:
  - `edgecast.jsonio.ScenarioValidationError(ValueError)` — message always names the scenario and field.
  - `edgecast.jsonio.load_scenarios(data: dict) -> list[Scenario]`
  - `edgecast.jsonio.read_scenarios_file(path: str | Path) -> list[Scenario]`
  - `edgecast.jsonio.build_output(results: list[ScenarioResult], agg: Aggregate, generated_at: str) -> dict`
  - `edgecast.jsonio.SCHEMA_VERSION = "1.0"`

- [ ] **Step 1: Write the failing tests**

`tests/test_jsonio.py`:

```python
import copy

import pytest

from edgecast.jsonio import (
    SCHEMA_VERSION,
    ScenarioValidationError,
    build_output,
    load_scenarios,
)
from edgecast.pipeline import analyze

VALID = {
    "schema_version": "1.0",
    "scenarios": [
        {
            "scenario_id": "nyc-high-2026-07-05",
            "market": {
                "market_id": "MOCK-KXHIGHNY-90",
                "question": "NYC high temp >= 90F on 2026-07-05?",
                "location": "NYC",
                "variable": "high_temp_f",
                "comparator": ">=",
                "threshold": 90.0,
                "event_date": "2026-07-05",
                "yes_price": 0.72,
            },
            "forecast": {
                "source": "mock-ensemble",
                "issued_at": "2026-07-03T12:00:00Z",
                "members": [88.0, 88.5, 91.0, 91.5, 92.0],
            },
            "observation": {"observed_value": 93.1},
        }
    ],
}


def invalid(mutate):
    data = copy.deepcopy(VALID)
    mutate(data["scenarios"][0])
    return data


def test_loads_valid_scenario():
    scenarios = load_scenarios(VALID)
    assert len(scenarios) == 1
    s = scenarios[0]
    assert s.scenario_id == "nyc-high-2026-07-05"
    assert s.market.yes_price == 0.72
    assert s.forecast.members == (88.0, 88.5, 91.0, 91.5, 92.0)
    assert s.observation is not None
    assert s.observation.observed_value == 93.1


def test_observation_is_optional():
    data = invalid(lambda s: s.pop("observation"))
    assert load_scenarios(data)[0].observation is None


@pytest.mark.parametrize(
    ("mutate", "field"),
    [
        (lambda s: s["market"].update(yes_price=1.0), "yes_price"),
        (lambda s: s["market"].update(yes_price=0.0), "yes_price"),
        (lambda s: s["market"].update(yes_price=1.5), "yes_price"),
        (lambda s: s["market"].update(comparator="=="), "comparator"),
        (lambda s: s["market"].update(event_date="July 5"), "event_date"),
        (lambda s: s["market"].pop("threshold"), "threshold"),
        (lambda s: s["forecast"].update(members=[]), "members"),
        (lambda s: s["forecast"].update(members=[88.0, "hot"]), "members"),
        (lambda s: s["forecast"].update(members=[88.0, True]), "members"),
        (lambda s: s["forecast"].update(issued_at="yesterday"), "issued_at"),
        (lambda s: s.update(scenario_id=""), "scenario_id"),
    ],
)
def test_invalid_scenarios_rejected_with_field_named(mutate, field):
    with pytest.raises(ScenarioValidationError) as exc:
        load_scenarios(invalid(mutate))
    assert field in str(exc.value)


def test_duplicate_scenario_ids_rejected():
    data = copy.deepcopy(VALID)
    data["scenarios"].append(copy.deepcopy(data["scenarios"][0]))
    with pytest.raises(ScenarioValidationError, match="scenario_id"):
        load_scenarios(data)


def test_empty_scenarios_rejected():
    with pytest.raises(ScenarioValidationError, match="scenarios"):
        load_scenarios({"schema_version": "1.0", "scenarios": []})


def test_build_output_shape_and_rounding():
    scenarios = load_scenarios(VALID)
    results, agg = analyze(scenarios)
    out = build_output(results, agg, generated_at="2026-07-02T18:00:00+00:00")
    assert out["schema_version"] == SCHEMA_VERSION
    assert out["generated_at"] == "2026-07-02T18:00:00+00:00"
    r = out["results"][0]
    assert r["scenario_id"] == "nyc-high-2026-07-05"
    assert r["market_prob"] == 0.72
    # 3 of 5 members >= 90 -> raw 0.6, clamp bounds [1/6, 5/6] leave it alone
    assert r["model_prob"] == 0.6
    assert r["model_prob_raw"] == 0.6
    assert r["n_members"] == 5
    assert r["edge"]["flag"] == "market_higher"
    # log-odds diff rounded to 6 decimal places
    assert isinstance(r["edge"]["log_odds_diff"], float)
    assert r["edge"]["log_odds_diff"] == round(r["edge"]["log_odds_diff"], 6)
    assert r["settlement"]["outcome"] == 1
    assert out["aggregate"]["n_settled"] == 1
    assert out["aggregate"]["better_calibrated"] == "market"


def test_build_output_null_settlement_and_aggregate():
    data = invalid(lambda s: s.pop("observation"))
    results, agg = analyze(load_scenarios(data))
    out = build_output(results, agg, generated_at="2026-07-02T18:00:00+00:00")
    assert out["results"][0]["settlement"] is None
    assert out["aggregate"]["mean_brier_market"] is None
    assert out["aggregate"]["better_calibrated"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_jsonio.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'edgecast.jsonio'`.

- [ ] **Step 3: Write the implementation**

`src/edgecast/jsonio.py`:

```python
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
    raw_scenarios = data.get("scenarios")
    if not isinstance(raw_scenarios, list) or not raw_scenarios:
        raise ScenarioValidationError("'scenarios' must be a non-empty list")
    scenarios: list[Scenario] = []
    seen_ids: set[str] = set()
    for raw in raw_scenarios:
        if not isinstance(raw, dict):
            raise ScenarioValidationError("each scenario must be an object")
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
        "schema_version": SCHEMA_VERSION,
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_jsonio.py -v`
Expected: PASS (all tests, including all parametrized rejection cases).

---

### Task 8: CLI

**Files:**
- Create: `src/edgecast/cli.py`
- Test: `tests/test_cli.py`

**Interfaces:**
- Consumes: `edgecast.jsonio` (read_scenarios_file, build_output, ScenarioValidationError), `edgecast.pipeline.analyze`, `edgecast.edge.DEFAULT_EDGE_THRESHOLD`.
- Produces: `edgecast.cli.main(argv: list[str] | None = None) -> int` (exit code), wired to the `edgecast` console script from Task 1.

- [ ] **Step 1: Write the failing tests**

`tests/test_cli.py`:

```python
import json

import pytest

from edgecast.cli import main

SCENARIOS = {
    "schema_version": "1.0",
    "scenarios": [
        {
            "scenario_id": "s1",
            "market": {
                "market_id": "MOCK-1",
                "question": "NYC high temp >= 90F on 2026-07-05?",
                "location": "NYC",
                "variable": "high_temp_f",
                "comparator": ">=",
                "threshold": 90.0,
                "event_date": "2026-07-05",
                "yes_price": 0.72,
            },
            "forecast": {
                "source": "mock-ensemble",
                "issued_at": "2026-07-03T12:00:00Z",
                "members": [88.0, 91.0, 91.5, 92.0],
            },
            "observation": {"observed_value": 93.1},
        }
    ],
}


@pytest.fixture
def scenarios_file(tmp_path):
    p = tmp_path / "scenarios.json"
    p.write_text(json.dumps(SCENARIOS))
    return p


def test_analyze_writes_json_to_stdout(scenarios_file, capsys):
    rc = main(["analyze", str(scenarios_file)])
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    assert out["schema_version"] == "1.0"
    assert "generated_at" in out
    assert out["results"][0]["scenario_id"] == "s1"
    assert out["aggregate"]["n_settled"] == 1


def test_analyze_writes_output_file(scenarios_file, tmp_path):
    out_path = tmp_path / "out.json"
    rc = main(["analyze", str(scenarios_file), "--output", str(out_path)])
    assert rc == 0
    out = json.loads(out_path.read_text())
    assert out["results"][0]["market_prob"] == 0.72


def test_edge_threshold_flag(scenarios_file, capsys):
    # model prob 0.75 vs market 0.72 -> edge 0.03
    rc = main(["analyze", str(scenarios_file), "--edge-threshold", "0.02"])
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    assert out["results"][0]["edge"]["flag"] == "model_higher"


def test_invalid_input_exits_nonzero(tmp_path, capsys):
    bad = json.loads(json.dumps(SCENARIOS))
    bad["scenarios"][0]["market"]["yes_price"] = 2.0
    p = tmp_path / "bad.json"
    p.write_text(json.dumps(bad))
    rc = main(["analyze", str(p)])
    assert rc == 2
    err = capsys.readouterr().err
    assert "yes_price" in err
    assert "s1" in err


def test_missing_file_exits_nonzero(tmp_path, capsys):
    rc = main(["analyze", str(tmp_path / "nope.json")])
    assert rc == 2
    assert "error" in capsys.readouterr().err.lower()


def test_malformed_json_exits_nonzero(tmp_path, capsys):
    p = tmp_path / "broken.json"
    p.write_text("{not json")
    rc = main(["analyze", str(p)])
    assert rc == 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_cli.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'edgecast.cli'`.

- [ ] **Step 3: Write the implementation**

`src/edgecast/cli.py`:

```python
"""CLI: `edgecast analyze <scenarios.json> [--output PATH] [--edge-threshold X]`."""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from edgecast.edge import DEFAULT_EDGE_THRESHOLD
from edgecast.jsonio import ScenarioValidationError, build_output, read_scenarios_file
from edgecast.pipeline import analyze


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="edgecast",
        description=(
            "Compare weather prediction-market probabilities against "
            "forecast-model probabilities and verify against observations."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)
    p_analyze = sub.add_parser(
        "analyze", help="analyze a scenarios JSON file and emit results JSON"
    )
    p_analyze.add_argument("scenarios_file", help="path to input scenarios JSON")
    p_analyze.add_argument(
        "--output", help="write results JSON to this path instead of stdout"
    )
    p_analyze.add_argument(
        "--edge-threshold",
        type=float,
        default=DEFAULT_EDGE_THRESHOLD,
        help=f"|edge| at or above this is flagged (default {DEFAULT_EDGE_THRESHOLD})",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        scenarios = read_scenarios_file(args.scenarios_file)
    except (ScenarioValidationError, OSError, json.JSONDecodeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    results, agg = analyze(scenarios, edge_threshold=args.edge_threshold)
    out = build_output(
        results, agg, generated_at=datetime.now(timezone.utc).isoformat()
    )
    text = json.dumps(out, indent=2)
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_cli.py -v`
Expected: PASS (6 tests).

---

### Task 9: Sample fixtures and end-to-end test

**Files:**
- Create: `fixtures/scenarios_sample.json`
- Test: `tests/test_end_to_end.py`

**Interfaces:**
- Consumes: the CLI (`edgecast.cli.main`) and everything beneath it.
- Produces: the demo fixture and proof the whole pipeline works. Fixture design: S1 model_higher settled-model-right, S2 market_higher settled, S3 agreement settled, S4 model_higher settled-model-wrong, S5 unsettled with full clamping (all members satisfy), S6 unsettled market_higher.

- [ ] **Step 1: Write the fixture**

`fixtures/scenarios_sample.json` — exact content (member counts are load-bearing: S1 has 6 below / 24 at-or-above 90; S2 has 10 ≤ 75 / 20 above; S3 has 16 ≥ 92 / 14 below; S4 has 3 below / 27 at-or-above 110; S5 all 30 below 60; S6 has 12 above 95 / 18 at-or-below):

```json
{
  "schema_version": "1.0",
  "scenarios": [
    {
      "scenario_id": "nyc-high-2026-07-05",
      "market": {
        "market_id": "MOCK-KXHIGHNY-90",
        "question": "NYC high temp >= 90F on 2026-07-05?",
        "location": "NYC",
        "variable": "high_temp_f",
        "comparator": ">=",
        "threshold": 90.0,
        "event_date": "2026-07-05",
        "yes_price": 0.72
      },
      "forecast": {
        "source": "mock-ensemble",
        "issued_at": "2026-07-03T12:00:00Z",
        "members": [88.1, 88.7, 89.2, 89.5, 89.8, 89.9, 90.2, 90.4, 90.6, 90.8, 91.0, 91.2, 91.4, 91.6, 91.8, 92.0, 92.2, 92.4, 92.6, 92.8, 93.0, 93.2, 93.4, 93.6, 93.8, 94.0, 94.2, 94.4, 94.6, 94.8]
      },
      "observation": { "observed_value": 93.1 }
    },
    {
      "scenario_id": "chi-high-2026-07-06",
      "market": {
        "market_id": "MOCK-KXHIGHCHI-75",
        "question": "Chicago high temp <= 75F on 2026-07-06?",
        "location": "CHI",
        "variable": "high_temp_f",
        "comparator": "<=",
        "threshold": 75.0,
        "event_date": "2026-07-06",
        "yes_price": 0.60
      },
      "forecast": {
        "source": "mock-ensemble",
        "issued_at": "2026-07-04T12:00:00Z",
        "members": [71.0, 71.5, 72.0, 72.5, 73.0, 73.5, 74.0, 74.2, 74.5, 74.8, 75.2, 75.5, 75.8, 76.0, 76.4, 76.8, 77.0, 77.4, 77.8, 78.0, 78.4, 78.8, 79.0, 79.4, 79.8, 80.0, 80.4, 80.8, 81.0, 81.4]
      },
      "observation": { "observed_value": 76.2 }
    },
    {
      "scenario_id": "mia-high-2026-07-06",
      "market": {
        "market_id": "MOCK-KXHIGHMIA-92",
        "question": "Miami high temp >= 92F on 2026-07-06?",
        "location": "MIA",
        "variable": "high_temp_f",
        "comparator": ">=",
        "threshold": 92.0,
        "event_date": "2026-07-06",
        "yes_price": 0.50
      },
      "forecast": {
        "source": "mock-ensemble",
        "issued_at": "2026-07-04T12:00:00Z",
        "members": [90.2, 90.5, 90.8, 91.0, 91.2, 91.4, 91.5, 91.6, 91.7, 91.8, 91.85, 91.9, 91.95, 91.99, 92.0, 92.1, 92.2, 92.3, 92.4, 92.5, 92.6, 92.7, 92.8, 92.9, 93.0, 93.1, 93.2, 93.3, 93.4, 93.5]
      },
      "observation": { "observed_value": 92.4 }
    },
    {
      "scenario_id": "phx-high-2026-07-07",
      "market": {
        "market_id": "MOCK-KXHIGHPHX-110",
        "question": "Phoenix high temp >= 110F on 2026-07-07?",
        "location": "PHX",
        "variable": "high_temp_f",
        "comparator": ">=",
        "threshold": 110.0,
        "event_date": "2026-07-07",
        "yes_price": 0.30
      },
      "forecast": {
        "source": "mock-ensemble",
        "issued_at": "2026-07-05T12:00:00Z",
        "members": [108.0, 108.8, 109.5, 110.0, 110.2, 110.4, 110.6, 110.8, 111.0, 111.2, 111.4, 111.6, 111.8, 112.0, 112.2, 112.4, 112.6, 112.8, 113.0, 113.2, 113.4, 113.6, 113.8, 114.0, 114.2, 114.4, 114.6, 114.8, 115.0, 115.2]
      },
      "observation": { "observed_value": 108.5 }
    },
    {
      "scenario_id": "sea-high-2026-07-08",
      "market": {
        "market_id": "MOCK-KXHIGHSEA-60",
        "question": "Seattle high temp < 60F on 2026-07-08?",
        "location": "SEA",
        "variable": "high_temp_f",
        "comparator": "<",
        "threshold": 60.0,
        "event_date": "2026-07-08",
        "yes_price": 0.45
      },
      "forecast": {
        "source": "mock-ensemble",
        "issued_at": "2026-07-06T12:00:00Z",
        "members": [52.0, 52.5, 53.0, 53.5, 54.0, 54.3, 54.6, 55.0, 55.3, 55.6, 56.0, 56.2, 56.4, 56.6, 56.8, 57.0, 57.2, 57.4, 57.6, 57.8, 58.0, 58.2, 58.4, 58.6, 58.8, 59.0, 59.2, 59.4, 59.6, 59.8]
      }
    },
    {
      "scenario_id": "den-high-2026-07-08",
      "market": {
        "market_id": "MOCK-KXHIGHDEN-95",
        "question": "Denver high temp > 95F on 2026-07-08?",
        "location": "DEN",
        "variable": "high_temp_f",
        "comparator": ">",
        "threshold": 95.0,
        "event_date": "2026-07-08",
        "yes_price": 0.55
      },
      "forecast": {
        "source": "mock-ensemble",
        "issued_at": "2026-07-06T12:00:00Z",
        "members": [90.9, 91.0, 91.5, 91.9, 92.0, 92.4, 92.8, 92.9, 93.2, 93.6, 93.9, 94.0, 94.2, 94.4, 94.6, 94.8, 94.9, 95.0, 95.2, 95.5, 95.8, 96.0, 96.3, 96.6, 97.0, 97.3, 97.6, 98.0, 98.4, 98.8]
      }
    }
  ]
}
```

- [ ] **Step 2: Write the failing end-to-end test**

`tests/test_end_to_end.py`:

```python
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
```

- [ ] **Step 3: Run the end-to-end test**

Run: `uv run pytest tests/test_end_to_end.py -v`
Expected: PASS (8 tests). If a member-count assertion fails, recount the fixture arrays against the counts in this task's Interfaces note — the fixture is wrong, not the pipeline.

- [ ] **Step 4: Run the full suite and the real CLI**

Run: `uv run pytest -v`
Expected: all tests pass across all files.

Run: `uv run edgecast analyze fixtures/scenarios_sample.json`
Expected: pretty-printed JSON on stdout with 6 results and an aggregate block showing `"n_settled": 4` and `"better_calibrated": "market"`. This is the spec's success criterion.

---

## Model delegation notes (per global CLAUDE.md)

- Tasks 1–9 are bulk implementation with a complete spec: delegate each to **gpt-5.5 via `codex exec`** with the task text (including Global Constraints) as a self-contained prompt. Codex runs from the repo root and must run the task's test commands itself.
- Review each task's diff with **fable-5/opus-4.8** before moving on (two-stage review per subagent-driven-development).
- The user commits; agents never do.
