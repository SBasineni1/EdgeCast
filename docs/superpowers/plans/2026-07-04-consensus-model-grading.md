# EdgeCast v4: Consensus Prediction + Day-Ahead Model Grading — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grade NBM/HRRR/GFS day-ahead forecasts against official observations, and replace the ladder's GEFS-ensemble model probability with a per-city bias-corrected consensus whose bucket probabilities are calibrated by its own measured error spread.

**Architecture:** New Open-Meteo previous-runs/multi-model client + pure consensus math module + `model_days` SQLite store + grader feed the existing FastAPI server. The live path swaps `EnsembleForecast` for a new `NormalForecast` (mu/sigma) in `Scenario`; the pipeline dispatches on forecast type. Frontend: CityCard header/footer and AggregateStrip read the new `model_grades` and `live.model_highs` blocks.

**Tech Stack:** Python ≥3.12 (stdlib `sqlite3`, `math` — no new deps), FastAPI + httpx; React 19 + Vite 6 + Tailwind v4 + Vitest 3.

**Spec:** `docs/superpowers/specs/2026-07-03-model-verification-design.md` (read for rationale; this plan is self-contained).

## Global Constraints

- **Never run `git commit`, `git add`, or `git push`. The user commits.** Agents leave changes in the working tree.
- No new dependencies, Python or npm.
- Model ids exactly: `ncep_nbm_conus`, `gfs_hrrr`, `gfs_global`, `consensus`. Lead string exactly: `"day_ahead"`. Display names: `NBM`, `HRRR`, `GFS`, `CONSENSUS`.
- Consensus calibration constants: bias window **15** trailing graded days, minimum **5** days (else bias = 0.0 / sigma = default), sigma floor **1.0 °F**, sigma default **2.5 °F**, normal-probability clamp **0.001**.
- Integer settlement boundaries: a Kalshi bucket over integer temps maps to a continuous range with **±0.5** at each edge; comparators are strict per Kalshi semantics (`>` 100 = 101° or above; `<` 93 = 92° or below). Bucket-hit rounding: `predicted_int = math.floor(predicted_high + 0.5)`.
- `gfs_seamless` (GEFS ensemble) must not appear in any new code; it remains only in the untouched v3 verify path (`verify.py`, `openmeteo.py`).
- Anti-slop contract (frontend): green `#2ECC71` / red `#FF4D4D` only in edge cells + mismatch warning; no gradients, shadows (except the two sanctioned text glows in CityCard `EdgeCell`), emoji, rounded corners, or spinners; `⚠︎ ✓ ● ▲ ▼ ▸` are text glyphs; JetBrains Mono numerals (`tabular-nums`).
- Footer copy rule: plain words, no bare decimals without context (`OFF BY 1.4°F`, not `1.4`).
- Test commands: backend `uv run pytest -q` (workaround: `UV_CACHE_DIR=/private/tmp/uv-cache` if `~/.cache/uv` is unwritable); frontend `cd web && npx vitest run`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/edgecast/live/previous_runs.py` (new) | Open-Meteo previous-runs + multi-model live forecast client; per-model daily highs |
| `src/edgecast/consensus.py` (new) | Pure math: trailing bias, sigma, consensus point, normal bucket mass |
| `src/edgecast/types.py` (modify) | Add `NormalForecast`; widen `Scenario.forecast` |
| `src/edgecast/forecast.py` (modify) | `model_implied_probability` dispatches on forecast type |
| `src/edgecast/model_store.py` (new) | `model_days` table: rows, coverage, trailing errors, grade aggregates |
| `src/edgecast/grade.py` (new) | Day-ahead grading of the 3 source models + consensus into the store |
| `src/edgecast/cli.py` (modify) | `backfill` also grades models |
| `src/edgecast/live/assemble.py` (modify) | Live path: multi-model highs → NormalForecast consensus |
| `src/edgecast/server.py` (modify) | `model_grades` block, `live.model_highs`/`consensus_sigma`, trimmed verification, model top-up |
| `web/src/types.ts` (modify) | `ModelGradeStats`, `ModelGrades`, trimmed `VerificationInfo`, `LiveInfo` additions |
| `web/src/components/CityCard.tsx` (modify) | Consensus header + marker, per-model grade footer |
| `web/src/components/AggregateStrip.tsx` (modify) | Per-model grade strip + closest-model verdict |
| `web/src/App.tsx` (modify) | New prop wiring |

---

### Task 1: Previous-runs / multi-model forecast client

**Files:**
- Create: `src/edgecast/live/previous_runs.py`
- Create: `tests/fixtures_live/openmeteo_previous_runs.json` (recorded real response)
- Test: `tests/test_live_previous_runs.py`

**Interfaces:**
- Consumes: nothing new (httpx.Client passed in, mirrors `edgecast/live/openmeteo.py` style).
- Produces:
  - `SOURCE_MODELS: tuple[str, ...] = ("ncep_nbm_conus", "gfs_hrrr", "gfs_global")`
  - `fetch_previous_day1_highs(lat: float, lon: float, start_date: str, end_date: str, tz: str, client: httpx.Client, models: tuple[str, ...] = SOURCE_MODELS) -> dict[str, dict[str, float]]` — model → ISO date → day-ahead predicted high °F
  - `fetch_live_model_highs(lat: float, lon: float, event_date: str, tz: str, client: httpx.Client, models: tuple[str, ...] = SOURCE_MODELS) -> dict[str, float | None]` — model → predicted high for `event_date` (None if that model returned no data)

- [ ] **Step 1: Record the real fixture** (network, one-time):

```bash
curl -s "https://previous-runs-api.open-meteo.com/v1/forecast?latitude=40.783&longitude=-73.967&hourly=temperature_2m_previous_day1&models=ncep_nbm_conus,gfs_hrrr,gfs_global&start_date=2026-06-28&end_date=2026-06-30&temperature_unit=fahrenheit&timezone=America%2FNew_York" > tests/fixtures_live/openmeteo_previous_runs.json
python3 -c "import json; d=json.load(open('tests/fixtures_live/openmeteo_previous_runs.json'))['hourly']; print(sorted(k for k in d if k!='time'))"
```

Expected: three keys `temperature_2m_previous_day1_gfs_global`, `..._gfs_hrrr`, `..._ncep_nbm_conus` (multi-model responses suffix the variable with the model id).

- [ ] **Step 2: Write failing tests**

```python
# tests/test_live_previous_runs.py
import json
from pathlib import Path

import httpx
import pytest

from edgecast.live.previous_runs import (
    SOURCE_MODELS,
    _daily_highs_by_model,
    fetch_live_model_highs,
    fetch_previous_day1_highs,
)

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures_live" / "openmeteo_previous_runs.json").read_text()
)


def test_source_models_exact():
    assert SOURCE_MODELS == ("ncep_nbm_conus", "gfs_hrrr", "gfs_global")


def test_reduces_fixture_to_per_model_daily_highs():
    out = _daily_highs_by_model(FIXTURE, SOURCE_MODELS, "temperature_2m_previous_day1")
    assert set(out) == set(SOURCE_MODELS)
    for m in SOURCE_MODELS:
        assert set(out[m]) == {"2026-06-28", "2026-06-29", "2026-06-30"}
        # each high equals the max of that model's hourly values on the date
        key = f"temperature_2m_previous_day1_{m}"
        expected = max(
            v for t, v in zip(FIXTURE["hourly"]["time"], FIXTURE["hourly"][key])
            if t.startswith("2026-06-29") and v is not None
        )
        assert out[m]["2026-06-29"] == pytest.approx(expected)


def test_single_model_bare_key():
    payload = {"hourly": {"time": ["2026-07-01T00:00", "2026-07-01T12:00"],
                          "temperature_2m_previous_day1": [70.0, 88.5]}}
    out = _daily_highs_by_model(payload, ("gfs_hrrr",), "temperature_2m_previous_day1")
    assert out == {"gfs_hrrr": {"2026-07-01": 88.5}}


def test_all_null_model_yields_empty_dict():
    payload = {"hourly": {"time": ["2026-07-01T00:00"],
                          "temperature_2m_previous_day1_gfs_hrrr": [None],
                          "temperature_2m_previous_day1_gfs_global": [80.0]}}
    out = _daily_highs_by_model(payload, ("gfs_hrrr", "gfs_global"), "temperature_2m_previous_day1")
    assert out["gfs_hrrr"] == {}
    assert out["gfs_global"] == {"2026-07-01": 80.0}


def _transport(payload):
    return httpx.MockTransport(lambda req: httpx.Response(200, json=payload))


def test_fetch_previous_day1_highs_params_and_shape():
    seen = {}

    def handler(req):
        seen.update(dict(req.url.params))
        return httpx.Response(200, json=FIXTURE)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    out = fetch_previous_day1_highs(40.783, -73.967, "2026-06-28", "2026-06-30",
                                    "America/New_York", client)
    assert seen["models"] == "ncep_nbm_conus,gfs_hrrr,gfs_global"
    assert seen["hourly"] == "temperature_2m_previous_day1"
    assert seen["temperature_unit"] == "fahrenheit"
    assert seen["start_date"] == "2026-06-28" and seen["end_date"] == "2026-06-30"
    assert set(out) == set(SOURCE_MODELS)


def test_fetch_live_model_highs_returns_none_for_missing_model():
    payload = {"hourly": {"time": ["2026-07-05T00:00", "2026-07-05T14:00"],
                          "temperature_2m_ncep_nbm_conus": [80.0, 96.4],
                          "temperature_2m_gfs_hrrr": [None, None],
                          "temperature_2m_gfs_global": [82.0, 102.2]}}
    client = httpx.Client(transport=_transport(payload))
    out = fetch_live_model_highs(30.195, -97.670, "2026-07-05", "America/Chicago", client)
    assert out == {"ncep_nbm_conus": 96.4, "gfs_hrrr": None, "gfs_global": 102.2}
```

- [ ] **Step 3: Run to verify failure** — `uv run pytest tests/test_live_previous_runs.py -q`. Expected: FAIL, `ModuleNotFoundError: edgecast.live.previous_runs`.

- [ ] **Step 4: Implement**

```python
# src/edgecast/live/previous_runs.py
"""Open-Meteo deterministic clients: previous-runs archive + live multi-model highs."""

import httpx

PREVIOUS_RUNS_URL = "https://previous-runs-api.open-meteo.com/v1/forecast"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
TIMEOUT = 10.0

SOURCE_MODELS: tuple[str, ...] = ("ncep_nbm_conus", "gfs_hrrr", "gfs_global")


def _daily_highs_by_model(
    payload: dict, models: tuple[str, ...], variable: str
) -> dict[str, dict[str, float]]:
    """Per model, reduce hourly values to the max per local date.

    Multi-model responses key series as f"{variable}_{model}"; single-model
    responses use the bare variable name. All-null hours are skipped, so a
    model outside its archive window reduces to {}.
    """
    hourly = payload["hourly"]
    times = hourly["time"]
    out: dict[str, dict[str, float]] = {}
    for m in models:
        key = f"{variable}_{m}"
        if key not in hourly and len(models) == 1 and variable in hourly:
            key = variable
        by_date: dict[str, float] = {}
        for t, v in zip(times, hourly.get(key, [])):
            if v is not None:
                d = t[:10]
                by_date[d] = max(float(v), by_date.get(d, float(v)))
        out[m] = by_date
    return out


def fetch_previous_day1_highs(
    lat: float, lon: float, start_date: str, end_date: str, tz: str,
    client: httpx.Client, models: tuple[str, ...] = SOURCE_MODELS,
) -> dict[str, dict[str, float]]:
    resp = client.get(
        PREVIOUS_RUNS_URL,
        params={
            "latitude": lat, "longitude": lon,
            "hourly": "temperature_2m_previous_day1",
            "models": ",".join(models),
            "temperature_unit": "fahrenheit", "timezone": tz,
            "start_date": start_date, "end_date": end_date,
        },
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return _daily_highs_by_model(resp.json(), models, "temperature_2m_previous_day1")


def fetch_live_model_highs(
    lat: float, lon: float, event_date: str, tz: str,
    client: httpx.Client, models: tuple[str, ...] = SOURCE_MODELS,
) -> dict[str, float | None]:
    resp = client.get(
        FORECAST_URL,
        params={
            "latitude": lat, "longitude": lon,
            "hourly": "temperature_2m", "models": ",".join(models),
            "temperature_unit": "fahrenheit", "timezone": tz,
            "forecast_days": 2,
        },
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    highs = _daily_highs_by_model(resp.json(), models, "temperature_2m")
    return {m: highs[m].get(event_date) for m in models}
```

- [ ] **Step 5: Run tests** — `uv run pytest tests/test_live_previous_runs.py -q`. Expected: all PASS. Then full suite `uv run pytest -q`: no regressions.

---

### Task 2: Consensus math + NormalForecast pipeline support

**Files:**
- Create: `src/edgecast/consensus.py`
- Modify: `src/edgecast/types.py` (add `NormalForecast`, widen `Scenario.forecast`)
- Modify: `src/edgecast/forecast.py` (dispatch)
- Test: `tests/test_consensus.py`

**Interfaces:**
- Consumes: `MarketQuote` from `edgecast.types`.
- Produces:
  - `edgecast.consensus`: `BIAS_WINDOW = 15`, `MIN_GRADED_DAYS = 5`, `SIGMA_FLOOR = 1.0`, `SIGMA_DEFAULT = 2.5`; `trailing_bias(errors: list[float]) -> float`; `consensus_sigma(errors: list[float]) -> float`; `consensus_point(predictions: dict[str, float], biases: dict[str, float]) -> float`; `normal_mass(market: MarketQuote, mu: float, sigma: float) -> float`
  - `edgecast.types.NormalForecast(source: str, issued_at: str, mu: float, sigma: float, n_models: int)` (frozen dataclass); `Scenario.forecast: EnsembleForecast | NormalForecast`
  - `model_implied_probability(forecast, market)` now accepts either forecast type; for `NormalForecast` returns `ModelProbability(raw=mass, clamped=clamp(mass, 0.001, 0.999), n_members=forecast.n_models)`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_consensus.py
import pytest

from edgecast.consensus import (
    SIGMA_DEFAULT,
    consensus_point,
    consensus_sigma,
    normal_mass,
    trailing_bias,
)
from edgecast.forecast import model_implied_probability
from edgecast.types import MarketQuote, NormalForecast


def q(comparator, threshold=None, lo=None, hi=None):
    return MarketQuote(
        market_id="M", question="q", location="NYC", variable="high_temp_f",
        comparator=comparator, event_date="2026-07-05", yes_price=0.5,
        threshold=threshold, threshold_low=lo, threshold_high=hi,
    )


def test_trailing_bias_mean_and_min_days():
    assert trailing_bias([2.0, 2.0, 2.0, 2.0, 2.0]) == pytest.approx(2.0)
    assert trailing_bias([2.0, 2.0]) == 0.0          # < 5 graded days -> no correction
    assert trailing_bias([]) == 0.0


def test_sigma_population_stdev_with_floor_and_default():
    assert consensus_sigma([1.0, -1.0, 1.0, -1.0, 1.0]) == 1.0   # stdev 0.98 -> floored
    assert consensus_sigma([3.0, -3.0, 3.0, -3.0, 3.0]) == pytest.approx(2.94, abs=0.01)
    assert consensus_sigma([1.0, 2.0]) == SIGMA_DEFAULT           # < 5 days -> wide


def test_consensus_point_debiased_mean():
    # NBM 100 running +2 warm -> 98; HRRR 96 running -1 cool -> 97; mean 97.5
    mu = consensus_point({"a": 100.0, "b": 96.0}, {"a": 2.0, "b": -1.0})
    assert mu == pytest.approx(97.5)
    with pytest.raises(ValueError):
        consensus_point({}, {})


def test_normal_mass_integer_settlement_boundaries():
    # mu 96.0, sigma 1.5; between 95 96 covers [94.5, 96.5)
    assert normal_mass(q("between", lo=95.0, hi=96.0), 96.0, 1.5) == pytest.approx(0.472, abs=2e-3)
    # "greater 100" settles yes at 101+ -> boundary 100.5
    assert normal_mass(q(">", 100.0), 96.0, 1.5) == pytest.approx(0.00135, abs=2e-4)
    assert normal_mass(q(">=", 100.0), 96.0, 1.5) == pytest.approx(0.0098, abs=5e-4)
    # "less 93" settles yes at 92 and below -> boundary 92.5
    assert normal_mass(q("<", 93.0), 96.0, 1.5) == pytest.approx(0.0098, abs=5e-4)
    assert normal_mass(q("<=", 93.0), 96.0, 1.5) == pytest.approx(0.0478, abs=5e-4)


def test_normal_mass_contiguous_ladder_sums_to_one():
    ladder = [
        q("<", 93.0),
        q("between", lo=93.0, hi=94.0),
        q("between", lo=95.0, hi=96.0),
        q(">", 96.0),
    ]
    total = sum(normal_mass(m, 94.2, 1.8) for m in ladder)
    assert total == pytest.approx(1.0, abs=1e-9)


def test_model_implied_probability_normal_dispatch_and_clamp():
    f = NormalForecast(source="consensus(a,b)", issued_at="2026-07-04T00:00:00Z",
                       mu=96.0, sigma=1.5, n_models=2)
    p = model_implied_probability(f, q("between", lo=95.0, hi=96.0))
    assert p.raw == pytest.approx(0.472, abs=2e-3)
    assert p.clamped == p.raw
    assert p.n_members == 2
    far = model_implied_probability(f, q(">", 120.0))
    assert far.raw < 0.001 and far.clamped == 0.001
```

- [ ] **Step 2: Run to verify failure** — `uv run pytest tests/test_consensus.py -q`. Expected: FAIL, `ModuleNotFoundError: edgecast.consensus`.

- [ ] **Step 3: Implement `consensus.py`**

```python
# src/edgecast/consensus.py
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
```

- [ ] **Step 4: Add `NormalForecast` to `types.py`** — after the `EnsembleForecast` dataclass insert:

```python
@dataclass(frozen=True)
class NormalForecast:
    source: str
    issued_at: str  # ISO datetime
    mu: float       # consensus predicted high, deg F
    sigma: float    # calibrated error spread, deg F
    n_models: int   # source models blended
```

and change `Scenario.forecast`'s annotation to `EnsembleForecast | NormalForecast` (declare `NormalForecast` before `Scenario`).

- [ ] **Step 5: Dispatch in `forecast.py`** — replace the module with:

```python
# src/edgecast/forecast.py
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
```

- [ ] **Step 6: Run tests** — `uv run pytest tests/test_consensus.py -q` PASS, then `uv run pytest -q` — full suite green (existing ensemble tests unaffected).

---

### Task 3: `model_days` store

**Files:**
- Create: `src/edgecast/model_store.py`
- Test: `tests/test_model_store.py`

**Interfaces:**
- Consumes: nothing from other v4 tasks (pure sqlite, mirrors `store.py` patterns).
- Produces:
  - `ModelDayRow(model, lead, city, series, event_date, predicted_high, observed_high, error, abs_error, bucket_hit, observed_source, model_source, verified_at)` — frozen dataclass; `bucket_hit: int | None`
  - `GradeStats(n_days: int, mae: float, bias: float, bucket_hit_rate: float | None)` — frozen dataclass
  - `ModelStore(path)` with: `upsert(rows: list[ModelDayRow]) -> None`; `covered(model: str, lead: str, dates: list[str]) -> set[tuple[str, str]]` ((city, date) pairs); `dates_missing(lead: str, dates: list[str]) -> list[str]` (dates lacking any `consensus` row, newest first); `trailing_errors(model: str, lead: str, city: str, before_date: str, limit: int = 15) -> list[float]` (signed errors, event_date strictly < before_date, newest first); `overall_grades(lead: str, since_date: str) -> dict[str, GradeStats]`; `city_grades(lead: str, since_date: str) -> dict[str, dict[str, GradeStats]]` (city → model → stats)

- [ ] **Step 1: Write failing tests**

```python
# tests/test_model_store.py
import pytest

from edgecast.model_store import GradeStats, ModelDayRow, ModelStore


def row(model="gfs_hrrr", city="NYC", d="2026-07-01", pred=95.0, obs=94.0, hit=1):
    err = pred - obs
    return ModelDayRow(
        model=model, lead="day_ahead", city=city, series="KXHIGHNY",
        event_date=d, predicted_high=pred, observed_high=obs,
        error=err, abs_error=abs(err), bucket_hit=hit,
        observed_source="ACIS KNYC", model_source=f"open-meteo {model} previous_day1",
        verified_at="2026-07-04T00:00:00Z",
    )


@pytest.fixture
def store(tmp_path):
    return ModelStore(tmp_path / "t.db")


def test_upsert_idempotent_and_covered(store):
    store.upsert([row(d="2026-07-01"), row(d="2026-07-02")])
    store.upsert([row(d="2026-07-01", pred=96.0)])  # replace, not duplicate
    assert store.covered("gfs_hrrr", "day_ahead", ["2026-07-01", "2026-07-02", "2026-07-03"]) == {
        ("NYC", "2026-07-01"), ("NYC", "2026-07-02"),
    }


def test_dates_missing_keyed_on_consensus(store):
    store.upsert([row(model="gfs_hrrr", d="2026-07-01")])           # sources alone don't count
    store.upsert([row(model="consensus", d="2026-07-02")])
    missing = store.dates_missing("day_ahead", ["2026-07-01", "2026-07-02", "2026-07-03"])
    assert missing == ["2026-07-03", "2026-07-01"]                   # newest first


def test_trailing_errors_ordering_exclusivity_limit(store):
    store.upsert([row(d=f"2026-06-{dd:02d}", pred=90.0 + dd, obs=90.0) for dd in range(1, 21)])
    errs = store.trailing_errors("gfs_hrrr", "day_ahead", "NYC", "2026-06-15", limit=3)
    assert errs == [14.0, 13.0, 12.0]      # newest first, strictly before the 15th
    assert store.trailing_errors("gfs_hrrr", "day_ahead", "OTHER", "2026-06-15") == []


def test_grades_aggregate_and_null_bucket_hits(store):
    store.upsert([
        row(d="2026-07-01", pred=96.0, obs=94.0, hit=0),   # error +2
        row(d="2026-07-02", pred=93.0, obs=94.0, hit=1),   # error -1
        row(d="2026-07-03", pred=94.0, obs=94.0, hit=None), # ungraded bucket
        row(model="ncep_nbm_conus", d="2026-07-01", pred=95.0, obs=94.0, hit=None),
    ])
    overall = store.overall_grades("day_ahead", "2026-07-01")
    hrrr = overall["gfs_hrrr"]
    assert hrrr == GradeStats(n_days=3, mae=pytest.approx(4 / 3), bias=pytest.approx(1 / 3),
                              bucket_hit_rate=pytest.approx(0.5))   # mean of non-NULL hits
    assert overall["ncep_nbm_conus"].bucket_hit_rate is None        # all NULL -> None
    by_city = store.city_grades("day_ahead", "2026-07-01")
    assert by_city["NYC"]["gfs_hrrr"].n_days == 3
    assert store.overall_grades("day_ahead", "2027-01-01") == {}
```

- [ ] **Step 2: Run to verify failure** — `uv run pytest tests/test_model_store.py -q`. Expected: FAIL, `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

```python
# src/edgecast/model_store.py
"""SQLite model-grading store: day-ahead predictions scored per model."""

import sqlite3
from dataclasses import dataclass, fields
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS model_days (
  model TEXT NOT NULL,
  lead TEXT NOT NULL,
  city TEXT NOT NULL,
  series TEXT NOT NULL,
  event_date TEXT NOT NULL,
  predicted_high REAL NOT NULL,
  observed_high REAL NOT NULL,
  error REAL NOT NULL,
  abs_error REAL NOT NULL,
  bucket_hit INTEGER,
  observed_source TEXT NOT NULL,
  model_source TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  PRIMARY KEY (model, lead, city, event_date)
);
CREATE INDEX IF NOT EXISTS idx_model_days_date ON model_days(lead, event_date);
"""


@dataclass(frozen=True)
class ModelDayRow:
    model: str
    lead: str
    city: str
    series: str
    event_date: str
    predicted_high: float
    observed_high: float
    error: float
    abs_error: float
    bucket_hit: int | None
    observed_source: str
    model_source: str
    verified_at: str


_COLS = [f.name for f in fields(ModelDayRow)]


@dataclass(frozen=True)
class GradeStats:
    n_days: int
    mae: float
    bias: float
    bucket_hit_rate: float | None


def _stats(rows: list[ModelDayRow]) -> GradeStats:
    n = len(rows)
    hits = [r.bucket_hit for r in rows if r.bucket_hit is not None]
    return GradeStats(
        n_days=n,
        mae=sum(r.abs_error for r in rows) / n,
        bias=sum(r.error for r in rows) / n,
        bucket_hit_rate=(sum(hits) / len(hits)) if hits else None,
    )


class ModelStore:
    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._path)
        self._conn.executescript(_SCHEMA)

    def upsert(self, rows: list[ModelDayRow]) -> None:
        placeholders = ", ".join("?" for _ in _COLS)
        with self._conn:
            self._conn.executemany(
                f"INSERT OR REPLACE INTO model_days ({', '.join(_COLS)}) "
                f"VALUES ({placeholders})",
                [tuple(getattr(r, c) for c in _COLS) for r in rows],
            )

    def _select(self, where: str, params: tuple) -> list[ModelDayRow]:
        cur = self._conn.execute(
            f"SELECT {', '.join(_COLS)} FROM model_days WHERE {where}", params
        )
        return [ModelDayRow(**dict(zip(_COLS, row))) for row in cur.fetchall()]

    def covered(self, model: str, lead: str, dates: list[str]) -> set[tuple[str, str]]:
        if not dates:
            return set()
        marks = ", ".join("?" for _ in dates)
        cur = self._conn.execute(
            f"SELECT DISTINCT city, event_date FROM model_days "
            f"WHERE model = ? AND lead = ? AND event_date IN ({marks})",
            (model, lead, *dates),
        )
        return set(cur.fetchall())

    def dates_missing(self, lead: str, dates: list[str]) -> list[str]:
        have = {d for _, d in self.covered("consensus", lead, dates)}
        return sorted((d for d in dates if d not in have), reverse=True)

    def trailing_errors(
        self, model: str, lead: str, city: str, before_date: str, limit: int = 15
    ) -> list[float]:
        cur = self._conn.execute(
            "SELECT error FROM model_days "
            "WHERE model = ? AND lead = ? AND city = ? AND event_date < ? "
            "ORDER BY event_date DESC LIMIT ?",
            (model, lead, city, before_date, limit),
        )
        return [row[0] for row in cur.fetchall()]

    def overall_grades(self, lead: str, since_date: str) -> dict[str, GradeStats]:
        rows = self._select("lead = ? AND event_date >= ?", (lead, since_date))
        by_model: dict[str, list[ModelDayRow]] = {}
        for r in rows:
            by_model.setdefault(r.model, []).append(r)
        return {m: _stats(rs) for m, rs in by_model.items()}

    def city_grades(self, lead: str, since_date: str) -> dict[str, dict[str, GradeStats]]:
        rows = self._select("lead = ? AND event_date >= ?", (lead, since_date))
        by_city: dict[str, dict[str, list[ModelDayRow]]] = {}
        for r in rows:
            by_city.setdefault(r.city, {}).setdefault(r.model, []).append(r)
        return {
            city: {m: _stats(rs) for m, rs in models.items()}
            for city, models in by_city.items()
        }
```

- [ ] **Step 4: Run tests** — `uv run pytest tests/test_model_store.py -q` PASS; full suite green.

---

### Task 4: Grader + backfill CLI

**Files:**
- Create: `src/edgecast/grade.py`
- Modify: `src/edgecast/cli.py` (`_backfill`)
- Test: `tests/test_grade.py`, extend `tests/test_cli.py`

**Interfaces:**
- Consumes: `fetch_previous_day1_highs`, `SOURCE_MODELS` (Task 1); `trailing_bias`, `consensus_point` (Task 2); `ModelStore`, `ModelDayRow` (Task 3); existing `fetch_observed_highs`/`AcisUnavailable` (`edgecast.live.acis`), `event_ticker_for`/`fetch_event_markets`/`to_quote`/`to_result` (`edgecast.live.kalshi`), `satisfies_market` (`edgecast.conditions`), `STATIONS`.
- Produces:
  - `LEAD = "day_ahead"`
  - `bucket_hit(predicted_high: float, yes_quote: MarketQuote | None) -> int | None`
  - `GradeReport(dates_attempted: list[str], n_rows: int = 0, failures: list[dict] = ...)`
  - `grade_days(dates: list[str], model_store: ModelStore, kalshi_client, meteo_client) -> GradeReport`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_grade.py
import pytest

import edgecast.grade as grade_mod
from edgecast.grade import GradeReport, bucket_hit, grade_days
from edgecast.model_store import ModelStore
from edgecast.types import MarketQuote


def q_between(lo, hi, city="NYC"):
    return MarketQuote(
        market_id="M", question="q", location=city, variable="high_temp_f",
        comparator="between", event_date="2026-07-01", yes_price=0.99,
        threshold_low=lo, threshold_high=hi,
    )


def test_bucket_hit_rounds_half_up_to_integer_bins():
    assert bucket_hit(95.5, q_between(95.0, 96.0)) == 1   # floor(96.0) = 96 in [95,96]
    assert bucket_hit(96.6, q_between(95.0, 96.0)) == 0   # floor(97.1) = 97 outside
    assert bucket_hit(94.4, q_between(95.0, 96.0)) == 0   # floor(94.9) = 94 outside
    assert bucket_hit(95.5, None) is None


@pytest.fixture
def store(tmp_path):
    return ModelStore(tmp_path / "g.db")


def _patch_sources(monkeypatch, observed, preds, yes_markets=None):
    """observed: {sid: {date: high}}; preds: {model: {date: high}} (same for all cities)."""
    monkeypatch.setattr(
        grade_mod, "fetch_observed_highs",
        lambda sid, start, end, client: observed.get(sid, {}),
    )
    monkeypatch.setattr(
        grade_mod, "fetch_previous_day1_highs",
        lambda lat, lon, start, end, tz, client: preds,
    )
    monkeypatch.setattr(
        grade_mod, "fetch_event_markets",
        lambda ticker, client: (_ for _ in ()).throw(RuntimeError("kalshi down"))
        if yes_markets is None else yes_markets.get(ticker, []),
    )


def test_grade_days_stores_sources_and_consensus_rows(monkeypatch, store):
    observed = {sid: {"2026-07-01": 94.0} for sid in
                ("KNYC", "KMDW", "KMIA", "KAUS", "KDEN", "KPHL", "KLAX")}
    preds = {"ncep_nbm_conus": {"2026-07-01": 95.0},
             "gfs_hrrr": {"2026-07-01": 93.0},
             "gfs_global": {"2026-07-01": 97.0}}
    _patch_sources(monkeypatch, observed, preds)   # kalshi unreachable -> bucket_hit NULL
    report = grade_days(["2026-07-01"], store, None, None)
    assert isinstance(report, GradeReport)
    assert report.n_rows == 7 * 4                  # 7 cities x (3 sources + consensus)
    grades = store.overall_grades("day_ahead", "2026-07-01")
    assert grades["consensus"].bias == pytest.approx(1.0)   # mean(95,93,97)=95 vs 94
    assert grades["consensus"].bucket_hit_rate is None


def test_consensus_subtracts_trailing_bias(monkeypatch, store):
    from tests.test_model_store import row   # reuse the row factory
    # NYC: NBM has 5 graded days all +2 warm; HRRR has no history
    store.upsert([row(model="ncep_nbm_conus", d=f"2026-06-{dd:02d}", pred=92.0, obs=90.0)
                  for dd in range(20, 25)])
    observed = {"KNYC": {"2026-07-01": 90.0}}
    preds = {"ncep_nbm_conus": {"2026-07-01": 90.0},
             "gfs_hrrr": {"2026-07-01": 89.0},
             "gfs_global": {}}                      # GFS missing this date
    _patch_sources(monkeypatch, observed, preds)
    grade_days(["2026-07-01"], store, None, None)
    errs = store.trailing_errors("consensus", "day_ahead", "NYC", "2026-07-02")
    # consensus = mean(90 - 2, 89 - 0) = 88.5 -> error -1.5
    assert errs[0] == pytest.approx(-1.5)


def test_grade_days_isolates_acis_failure(monkeypatch, store):
    _patch_sources(monkeypatch, {}, {"ncep_nbm_conus": {}, "gfs_hrrr": {}, "gfs_global": {}})
    report = grade_days(["2026-07-01"], store, None, None)
    assert report.n_rows == 0
    assert all(f["stage"] in ("acis", "open-meteo") for f in report.failures)
```

Note: `fetch_observed_highs` returning `{}` (not raising) means the "no observation for date" path triggers with stage `acis`.

- [ ] **Step 2: Run to verify failure** — `uv run pytest tests/test_grade.py -q`. Expected: FAIL, `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

```python
# src/edgecast/grade.py
"""Day-ahead model grading: archived forecasts vs official observed highs."""

import math
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from edgecast.conditions import satisfies_market
from edgecast.consensus import consensus_point, trailing_bias
from edgecast.live.acis import AcisUnavailable, fetch_observed_highs
from edgecast.live.kalshi import (
    event_ticker_for,
    fetch_event_markets,
    to_quote,
    to_result,
)
from edgecast.live.previous_runs import SOURCE_MODELS, fetch_previous_day1_highs
from edgecast.live.stations import STATIONS
from edgecast.model_store import ModelDayRow, ModelStore
from edgecast.types import MarketQuote

LEAD = "day_ahead"


@dataclass
class GradeReport:
    dates_attempted: list[str]
    n_rows: int = 0
    failures: list[dict] = field(default_factory=list)


def bucket_hit(predicted_high: float, yes_quote: MarketQuote | None) -> int | None:
    """1/0 if the rounded prediction lands in the yes-settled bucket; None if unknown.

    Kalshi bins cover integer reported temps, so round half-up first: a raw
    96.4 would otherwise fall between the [95,96] and [97,98] bins.
    """
    if yes_quote is None:
        return None
    return int(satisfies_market(float(math.floor(predicted_high + 0.5)), yes_quote))


def _yes_quote(markets: list[dict], city: str) -> MarketQuote | None:
    for m in markets:
        if to_result(m) == "yes":
            q = to_quote(m, city)
            if q is not None:
                return q
    return None


def grade_days(
    dates: list[str], model_store: ModelStore, kalshi_client, meteo_client
) -> GradeReport:
    report = GradeReport(dates_attempted=sorted(dates))
    now = datetime.now(timezone.utc).isoformat()

    for series, st in STATIONS.items():
        covered = model_store.covered("consensus", LEAD, list(dates))
        todo = sorted(d for d in dates if (st.city, d) not in covered)
        if not todo:
            continue

        try:
            observed = fetch_observed_highs(st.acis_sid, min(todo), max(todo), meteo_client)
        except AcisUnavailable as e:
            report.failures.extend(
                {"city": st.city, "date": d, "stage": "acis", "reason": str(e)}
                for d in todo
            )
            continue

        try:
            preds = fetch_previous_day1_highs(
                st.lat, st.lon, min(todo), max(todo), st.tz, meteo_client
            )
        except Exception as e:  # noqa: BLE001 - upstream failure isolates this city
            report.failures.extend(
                {"city": st.city, "date": d, "stage": "open-meteo",
                 "reason": f"{type(e).__name__}: {e}"}
                for d in todo
            )
            continue

        # Ascending: consensus bias for date D reads rows strictly before D.
        for d in todo:
            if d not in observed:
                report.failures.append(
                    {"city": st.city, "date": d, "stage": "acis",
                     "reason": f"no observation for {d}"}
                )
                continue
            model_preds = {m: preds[m][d] for m in SOURCE_MODELS if d in preds.get(m, {})}
            if not model_preds:
                report.failures.append(
                    {"city": st.city, "date": d, "stage": "open-meteo",
                     "reason": f"no model forecasts for {d}"}
                )
                continue
            yes_q: MarketQuote | None = None
            try:
                markets = fetch_event_markets(
                    event_ticker_for(series, date.fromisoformat(d)), kalshi_client
                )
                yes_q = _yes_quote(markets, st.city)
            except Exception as e:  # noqa: BLE001 - bucket grading degrades to NULL
                report.failures.append(
                    {"city": st.city, "date": d, "stage": "kalshi",
                     "reason": f"{type(e).__name__}: {e}"}
                )

            def _row(model: str, predicted: float, source: str) -> ModelDayRow:
                err = predicted - observed[d]
                return ModelDayRow(
                    model=model, lead=LEAD, city=st.city, series=series,
                    event_date=d, predicted_high=predicted,
                    observed_high=observed[d], error=err, abs_error=abs(err),
                    bucket_hit=bucket_hit(predicted, yes_q),
                    observed_source=f"ACIS {st.acis_sid}", model_source=source,
                    verified_at=now,
                )

            rows = [
                _row(m, p, f"open-meteo {m} previous_day1")
                for m, p in model_preds.items()
            ]
            biases = {
                m: trailing_bias(model_store.trailing_errors(m, LEAD, st.city, d))
                for m in model_preds
            }
            mu = consensus_point(model_preds, biases)
            rows.append(_row("consensus", mu, f"consensus({','.join(sorted(model_preds))})"))
            model_store.upsert(rows)
            report.n_rows += len(rows)
    return report
```

- [ ] **Step 4: Extend `_backfill` in `cli.py`** — after the existing `verify_days` call inside the same `with httpx.Client() ...` block:

```python
        from edgecast.grade import grade_days
        from edgecast.model_store import ModelStore

        model_report = grade_days(dates, ModelStore(args.db), kc, mc)
    print(
        f"backfill: {len(report.dates_attempted)} dates attempted, "
        f"{report.n_markets_verified} markets verified, "
        f"{len(report.failures)} failures, {len(report.mismatches)} kalshi mismatches"
    )
    print(
        f"model grading: {model_report.n_rows} model-day rows, "
        f"{len(model_report.failures)} failures"
    )
    for f in report.failures[:20]:
        print(f"  failed {f['city']} {f['date']} [{f['stage']}]: {f['reason']}")
    for f in model_report.failures[:20]:
        print(f"  grading failed {f['city']} {f['date']} [{f['stage']}]: {f['reason']}")
    ok = (
        report.n_markets_verified > 0
        or model_report.n_rows > 0
        or (not report.failures and not model_report.failures)
    )
    return 0 if ok else 1
```

(The existing print/return lines are replaced by the block above; keep the existing `dates`/`store`/`verify_days` code.)

- [ ] **Step 5: Extend `tests/test_cli.py`** — find the existing backfill test(s); update them to monkeypatch `edgecast.grade.grade_days` too (patch it where `_backfill` imports it: `monkeypatch.setattr("edgecast.grade.grade_days", fake)`), and add:

```python
def test_backfill_reports_model_grading(monkeypatch, capsys, tmp_path):
    import edgecast.cli as cli_mod
    import edgecast.grade as grade_mod
    import edgecast.verify as verify_mod
    from edgecast.grade import GradeReport
    from edgecast.verify import VerifyReport

    monkeypatch.setattr(
        verify_mod, "verify_days",
        lambda dates, store, kc, mc: VerifyReport(dates_attempted=list(dates)),
    )
    monkeypatch.setattr(
        grade_mod, "grade_days",
        lambda dates, store, kc, mc: GradeReport(dates_attempted=list(dates), n_rows=28),
    )
    rc = cli_mod.main(["backfill", "--days", "2", "--db", str(tmp_path / "t.db")])
    out = capsys.readouterr().out
    assert "model grading: 28 model-day rows" in out
    assert rc == 0
```

- [ ] **Step 6: Run tests** — `uv run pytest tests/test_grade.py tests/test_cli.py -q` PASS; full suite green.

---

### Task 5: Live consensus path + server API

**Files:**
- Modify: `src/edgecast/live/assemble.py`
- Modify: `src/edgecast/server.py`
- Test: extend `tests/test_live_assemble.py`, `tests/test_server.py`

**Interfaces:**
- Consumes: `fetch_live_model_highs`, `SOURCE_MODELS` (Task 1); `consensus_point`, `consensus_sigma`, `trailing_bias` (Task 2); `NormalForecast` (Task 2); `ModelStore`, `GradeStats` (Task 3); `grade_days`, `LEAD` (Task 4).
- Produces:
  - `build_live_scenarios(kalshi_client, meteo_client, model_store: ModelStore | None = None) -> LiveResult`; `LiveResult` gains `model_highs: dict[str, dict[str, float | None]]` (per city: 3 source models + `"consensus"`) and `consensus_sigma: dict[str, float]`, both default-empty.
  - `/api/live` JSON: `live.model_highs`, `live.consensus_sigma`; top-level `model_grades` (`{window_days, lead, overall, by_city}` or `null`); `verification` trimmed to `{window_days, n_markets, n_days, kalshi_mismatches, verification_failed}` or `null`. `live.ensembles_age_seconds` key stays (now the model-highs cache age) so the CommandBar keeps working.

- [ ] **Step 1: Rewrite `build_live_scenarios` in `assemble.py`** — replace the `fetch_ensemble_high` import/use with:

```python
# imports: replace `from edgecast.live.openmeteo import fetch_ensemble_high` with
from datetime import datetime, timezone

from edgecast.consensus import consensus_point, consensus_sigma, trailing_bias
from edgecast.live.previous_runs import SOURCE_MODELS, fetch_live_model_highs
from edgecast.model_store import ModelStore
from edgecast.types import NormalForecast, Scenario
```

`LiveResult` gains two fields:

```python
    model_highs: dict[str, dict[str, float | None]] = field(default_factory=dict)
    consensus_sigma: dict[str, float] = field(default_factory=dict)
```

Add a calibration helper and rework the per-city forecast block:

```python
def _calibration(
    model_store: ModelStore | None, city: str, models: list[str]
) -> tuple[dict[str, float], float]:
    """Trailing biases per model and consensus sigma; safe defaults without a store."""
    if model_store is None:
        return {m: 0.0 for m in models}, consensus_sigma([])
    try:
        biases = {
            m: trailing_bias(model_store.trailing_errors(m, "day_ahead", city, "9999-12-31"))
            for m in models
        }
        sigma = consensus_sigma(
            model_store.trailing_errors("consensus", "day_ahead", city, "9999-12-31")
        )
        return biases, sigma
    except Exception:  # noqa: BLE001 - calibration must never break the ladder
        return {m: 0.0 for m in models}, consensus_sigma([])
```

```python
def build_live_scenarios(
    kalshi_client: httpx.Client, meteo_client: httpx.Client,
    model_store: ModelStore | None = None,
) -> LiveResult:
```

and inside the loop, replacing the `fetch_ensemble_high` block:

```python
        highs, e_age, e_err = _cached(
            ENSEMBLES_CACHE, f"{series}:{event_date}", ENSEMBLES_TTL,
            lambda st=st, d=event_date: fetch_live_model_highs(
                st.lat, st.lon, d, st.tz, meteo_client
            ),
        )
        if e_err is not None:
            result.cities_failed.append({"city": st.city, "reason": f"open-meteo: {e_err}"})
            continue
        available = {m: h for m, h in highs.items() if h is not None}
        if not available:
            result.cities_failed.append(
                {"city": st.city, "reason": f"open-meteo: no model forecasts for {event_date}"}
            )
            continue
        biases, sigma = _calibration(model_store, st.city, list(available))
        mu = consensus_point(available, biases)
        forecast = NormalForecast(
            source=f"consensus({','.join(sorted(available))})",
            issued_at=datetime.now(timezone.utc).isoformat(),
            mu=mu, sigma=sigma, n_models=len(available),
        )
        result.model_highs[st.city] = {
            **{m: highs.get(m) for m in SOURCE_MODELS},
            "consensus": round(mu, 1),
        }
        result.consensus_sigma[st.city] = round(sigma, 2)
```

(The Scenario-building loop below it is unchanged.)

- [ ] **Step 2: Add assemble tests** to `tests/test_live_assemble.py`:

```python
import httpx
import pytest

import edgecast.live.assemble as assemble_mod
from edgecast.live.assemble import build_live_scenarios
from edgecast.types import NormalForecast


def _kalshi_payload():
    return {"markets": [{
        "ticker": "KXHIGHNY-26JUL05-B95.5", "event_ticker": "KXHIGHNY-26JUL05",
        "title": "95-96", "strike_type": "between",
        "floor_strike": 95.0, "cap_strike": 96.0, "last_price": 40,
    }], "cursor": None}


def test_live_scenarios_use_normal_consensus(monkeypatch, tmp_path):
    assemble_mod.QUOTES_CACHE._data.clear()      # isolation from other tests
    assemble_mod.ENSEMBLES_CACHE._data.clear()
    monkeypatch.setattr(
        assemble_mod, "fetch_markets", lambda series, client: _kalshi_payload()["markets"]
    )
    monkeypatch.setattr(
        assemble_mod, "fetch_live_model_highs",
        lambda lat, lon, d, tz, client: {"ncep_nbm_conus": 96.0, "gfs_hrrr": 95.0,
                                         "gfs_global": None},
    )
    result = build_live_scenarios(None, None, model_store=None)
    nyc = [s for s in result.scenarios if s.market.location == "NYC"]
    assert nyc and isinstance(nyc[0].forecast, NormalForecast)
    f = nyc[0].forecast
    assert f.mu == pytest.approx(95.5) and f.n_models == 2       # GFS missing, no bias
    assert f.sigma == 2.5                                         # no store -> default
    assert result.model_highs["NYC"] == {
        "ncep_nbm_conus": 96.0, "gfs_hrrr": 95.0, "gfs_global": None, "consensus": 95.5,
    }
    assert result.consensus_sigma["NYC"] == 2.5
```

(If `TTLCache` has no `_data` attribute, check `src/edgecast/live/cache.py` and use its actual clearing mechanism, or monkeypatch fresh `TTLCache()` instances onto `assemble_mod.QUOTES_CACHE`/`ENSEMBLES_CACHE`.)

- [ ] **Step 3: Run assemble tests** — `uv run pytest tests/test_live_assemble.py -q` PASS. Note: `fetch_markets` returns markets for every series here, so all 7 cities produce scenarios — assertions are NYC-scoped.

- [ ] **Step 4: Update `server.py`** — in `live_endpoint`:

1. Imports: add `from edgecast.grade import grade_days` and `from edgecast.model_store import ModelStore`.
2. Before `build_live_scenarios`: create the store defensively and pass it:

```python
        try:
            model_store: ModelStore | None = ModelStore(db_path)
        except Exception:  # noqa: BLE001
            model_store = None
        live = build_live_scenarios(kalshi_client, meteo_client, model_store)
```

3. In `out["live"] = {...}` add:

```python
            "model_highs": live.model_highs,
            "consensus_sigma": live.consensus_sigma,
```

4. In the verification `try:` block, replace everything from `since = min(dates)` through the end of the `else:` branch with:

```python
            since = min(dates)
            stats = store.window_stats(model, since)
            if stats is None:
                out["verification"] = None
            else:
                out["verification"] = {
                    "window_days": verify_days,
                    "n_markets": stats.n_markets,
                    "n_days": stats.n_days,
                    "kalshi_mismatches": [
                        {"market_id": r.market_id, "kalshi_result": r.kalshi_result,
                         "edgecast_outcome": r.outcome}
                        for r in store.mismatches(model, since)
                    ],
                    "verification_failed": topup_failures,
                }
```

Delete `_yesterday_iso` and the yesterday/by_city/brier/hit/better_calibrated code. Keep the surrounding `try/except` that sets `out["verification"] = None` on failure.

5. After the verification block, add the model-grades block (its own `try/except`; failures must never break the ladder):

```python
        try:
            if model_store is None:
                out["model_grades"] = None
            else:
                m_dates = _window_dates(verify_days)
                m_missing = model_store.dates_missing("day_ahead", m_dates)[:3]
                if m_missing:
                    grade_days(m_missing, model_store, kalshi_client, meteo_client)
                overall = model_store.overall_grades("day_ahead", min(m_dates))
                if not overall:
                    out["model_grades"] = None
                else:
                    def _grade_json(g):
                        return {
                            "n_days": g.n_days, "mae": round(g.mae, 2),
                            "bias": round(g.bias, 2),
                            "bucket_hit_rate": round(g.bucket_hit_rate, 4)
                            if g.bucket_hit_rate is not None else None,
                        }
                    out["model_grades"] = {
                        "window_days": verify_days,
                        "lead": "day_ahead",
                        "overall": {m: _grade_json(g) for m, g in overall.items()},
                        "by_city": {
                            city: {m: _grade_json(g) for m, g in models.items()}
                            for city, models in
                            model_store.city_grades("day_ahead", min(m_dates)).items()
                        },
                    }
        except Exception:  # noqa: BLE001 - grading must never break the ladder
            out["model_grades"] = None
```

- [ ] **Step 5: Update `tests/test_server.py`** — existing tests monkeypatch `server_mod.build_live_scenarios` with `_fake_live_result()`; the new signature is backward compatible (extra arg accepted by the lambdas' `*a, **k`). Required edits + additions:
  - `test_live_verification_yesterday_block`: delete (yesterday is gone). Remove `yesterday`-key assertions anywhere else.
  - In `test_live_includes_verification_block`: assert the trimmed shape — keys exactly `{"window_days", "n_markets", "n_days", "kalshi_mismatches", "verification_failed"}`.
  - Add a new fixture and tests. Follow the existing `live_client` fixture pattern: write `graded_client(fixtures_dir, tmp_path, monkeypatch)` that (a) seeds a `ModelStore(tmp_path / "db.sqlite")` with two rows via the `row` factory from `tests.test_model_store` — `row(model="consensus", pred=95.0, obs=94.0, hit=1)` and `row(model="gfs_hrrr", pred=97.0, obs=94.0, hit=0)` — dated within the last 30 days (use `datetime.date.today() - timedelta(days=2)` for `event_date` so it falls inside `_window_dates`), (b) monkeypatches `server_mod.build_live_scenarios` and `server_mod.run_verification` exactly like `live_client` does, (c) monkeypatches `server_mod.grade_days` to a no-op returning `GradeReport(dates_attempted=[])` (so the top-up doesn't hit the network), and (d) creates the app with `db_path=tmp_path / "db.sqlite"`. Then:

```python
def test_live_model_grades_block(graded_client):
    body = graded_client.get("/api/live").json()
    mg = body["model_grades"]
    assert mg["lead"] == "day_ahead" and mg["window_days"] == 30
    assert mg["overall"]["consensus"]["mae"] == 1.0
    assert mg["overall"]["consensus"]["bucket_hit_rate"] == 1.0
    assert mg["by_city"]["NYC"]["gfs_hrrr"]["bias"] == 3.0
    assert "model_highs" in body["live"] and "consensus_sigma" in body["live"]


def test_live_model_grades_null_on_empty_store(live_client, monkeypatch):
    import edgecast.server as server_mod
    from edgecast.grade import GradeReport
    monkeypatch.setattr(
        server_mod, "grade_days",
        lambda dates, ms, kc, mc: GradeReport(dates_attempted=list(dates)),
    )
    body = live_client.get("/api/live").json()
    assert body["model_grades"] is None
```

  (Adapt to the file's actual fixture names; the contract to verify: grades block shape, null-on-empty, trimmed verification, `model_highs`/`consensus_sigma` passthrough.)

- [ ] **Step 6: Run tests** — `uv run pytest tests/test_server.py tests/test_live_assemble.py -q` PASS; full backend suite `uv run pytest -q` green.

---

### Task 6: Frontend types + CityCard

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/components/CityCard.tsx`
- Test: `web/src/components/CityCard.test.tsx`

**Interfaces:**
- Consumes: `/api/live` shapes from Task 5.
- Produces (used by Task 7):
  - `types.ts`: `ModelGradeStats { n_days: number; mae: number; bias: number; bucket_hit_rate: number | null }`; `ModelGrades { window_days: number; lead: string; overall: Record<string, ModelGradeStats>; by_city: Record<string, Record<string, ModelGradeStats>> }`; `VerificationInfo` trimmed to `{ window_days, n_markets, n_days, kalshi_mismatches, verification_failed }` (delete `CityWindowStats`, `YesterdayInfo`); `LiveInfo` gains `model_highs: Record<string, Record<string, number | null>>` and `consensus_sigma: Record<string, number | null>`; `AnalysisOutput` gains `model_grades?: ModelGrades | null`; export `MODEL_NAMES: Record<string, string> = { consensus: "CONSENSUS", ncep_nbm_conus: "NBM", gfs_hrrr: "HRRR", gfs_global: "GFS" }` and `MODEL_ORDER = ["consensus", "ncep_nbm_conus", "gfs_hrrr", "gfs_global"]`.
  - `CityCard` props become: `{ location, cityInfo?, results, modelHighs?: Record<string, number | null>, grades?: Record<string, ModelGradeStats>, mismatches: KalshiMismatch[] }` (`yesterday`/`cityStats` removed).

- [ ] **Step 1: Update `types.ts`** per the interface block above (exact fields; `MODEL_NAMES`/`MODEL_ORDER` as plain exported consts in this file).

- [ ] **Step 2: Rewrite `CityCard.test.tsx` expectations** (failing first). Keep existing ladder-row / edge-cell / mismatch tests; replace footer/yesterday tests with:

```tsx
const GRADES = {
  consensus: { n_days: 28, mae: 1.5, bias: 0.1, bucket_hit_rate: 0.41 },
  ncep_nbm_conus: { n_days: 28, mae: 2.1, bias: -0.9, bucket_hit_rate: 0.31 },
  gfs_hrrr: { n_days: 28, mae: 2.2, bias: 0.02, bucket_hit_rate: 0.26 },
  gfs_global: { n_days: 28, mae: 2.16, bias: 0.79, bucket_hit_rate: null },
};
const HIGHS = { ncep_nbm_conus: 96.4, gfs_hrrr: 98.0, gfs_global: 102.2, consensus: 96.2 };

it("shows consensus high and per-model grade lines", () => {
  render(<CityCard location="NYC" results={RESULTS} modelHighs={HIGHS} grades={GRADES} mismatches={[]} />);
  expect(screen.getByText(/CONSENSUS 96\.2°/)).toBeInTheDocument();
  expect(screen.getByText(/NBM 96\.4 · HRRR 98\.0 · GFS 102\.2/)).toBeInTheDocument();
  const footer = screen.getByTestId("verification-footer");
  expect(footer.textContent).toContain("CONSENSUS · OFF BY 1.5°F · RIGHT BUCKET 41% · RUNS +0.1° WARM");
  expect(footer.textContent).toContain("NBM · OFF BY 2.1°F · RIGHT BUCKET 31% · RUNS −0.9° COOL");
  expect(footer.textContent).toContain("HRRR · OFF BY 2.2°F · RIGHT BUCKET 26% · NO LEAN");
  expect(footer.textContent).toContain("GFS · OFF BY 2.2°F · RUNS +0.8° WARM"); // null hit rate -> segment omitted
});

it("marks the ladder row containing the rounded consensus", () => {
  // consensus 96.2 -> floor(96.7) = 96 -> the between-95-96 row carries the marker
  render(<CityCard location="NYC" results={RESULTS} modelHighs={HIGHS} grades={GRADES} mismatches={[]} />);
  const marked = screen.getByTestId("consensus-marker");
  expect(marked.closest("[data-testid='ladder-row']")!.textContent).toContain("95–96°");
});

it("renders ungraded state without model data", () => {
  render(<CityCard location="NYC" results={RESULTS} mismatches={[]} />);
  expect(screen.getByTestId("verification-footer").textContent).toContain("MODELS UNGRADED");
});
```

(Adapt `RESULTS` to the file's existing fixture; it must include a `between 95 96` row. Bias-word thresholds: `|bias| < 0.05` → `NO LEAN`; positive → `RUNS +X.X° WARM`; negative → `RUNS −X.X° COOL` with U+2212 minus.)

- [ ] **Step 3: Run to verify failure** — `cd web && npx vitest run src/components/CityCard.test.tsx`. Expected: FAIL on new assertions.

- [ ] **Step 4: Implement `CityCard.tsx`.** Structure (final visual polish is the implementer's taste pass; these are the content requirements):
  - Header right side becomes two stacked lines: existing `station · date` line, plus when `modelHighs?.consensus != null` a line `CONSENSUS {consensus.toFixed(1)}°` (bold, `tabular-nums`) and a muted `text-text-3` line `NBM 96.4 · HRRR 98.0 · GFS 102.2` (each `{MODEL_NAMES[m]} {v.toFixed(1)}`, order NBM/HRRR/GFS, skip null models).
  - Marker: helper `bucketContains(market: MarketMeta, t: number): boolean` mirroring backend strict semantics — `between`: `lo <= t && t <= hi`; `">"`: `t > threshold`; `">="`: `t >= threshold`; `"<"`: `t < threshold`; `"<="`: `t <= threshold`. With `t = Math.floor((modelHighs?.consensus ?? NaN) + 0.5)`, the matching row's range label gets a `▸` glyph `<span data-testid="consensus-marker" className="text-text-2">▸ </span>` prefix. No new colors.
  - Footer: replace yesterday/Brier block with, for each model in `MODEL_ORDER` present in `grades`:

```tsx
function biasWords(bias: number): string {
  if (Math.abs(bias) < 0.05) return "NO LEAN";
  const sign = bias > 0 ? "+" : "−";
  return `RUNS ${sign}${Math.abs(bias).toFixed(1)}° ${bias > 0 ? "WARM" : "COOL"}`;
}

function gradeLine(model: string, g: ModelGradeStats): string {
  const hit = g.bucket_hit_rate === null
    ? ""
    : ` · RIGHT BUCKET ${Math.round(g.bucket_hit_rate * 100)}%`;
  return `${MODEL_NAMES[model] ?? model.toUpperCase()} · OFF BY ${g.mae.toFixed(1)}°F${hit} · ${biasWords(g.bias)}`;
}
```

  rendered one `<p>` per model (consensus line in `text-text-1`/default, source models `text-text-3`). When `grades` is undefined/empty: `<p className="text-text-3">MODELS UNGRADED — run: uv run edgecast backfill</p>`. Mismatch warnings unchanged.
  - Remove `fmtBrier`, `YesterdayInfo`/`CityWindowStats` imports and the old props.

- [ ] **Step 5: Run tests** — `cd web && npx vitest run src/components/CityCard.test.tsx`. Expected: PASS. (`npx tsc -b` may still fail until Task 7 fixes App.tsx — that's expected; note it and proceed.)

---

### Task 7: AggregateStrip + App wiring

**Files:**
- Modify: `web/src/components/AggregateStrip.tsx`
- Modify: `web/src/App.tsx`
- Test: `web/src/components/AggregateStrip.test.tsx` (or create), `web/src/App.test.tsx`

**Interfaces:**
- Consumes: `ModelGrades`, `MODEL_NAMES`, `MODEL_ORDER` (Task 6); CityCard props (Task 6).
- Produces: `AggregateStrip` props `{ aggregate: Aggregate; modelGrades?: ModelGrades | null }` — `undefined` = fixtures mode (unchanged aggregate variant); `null` = live-awaiting; object = per-model grade strip.

- [ ] **Step 1: Write failing tests** (in `AggregateStrip.test.tsx`, creating it if absent, using the same Testing Library setup as `CityCard.test.tsx`):

```tsx
const MG = {
  window_days: 30, lead: "day_ahead",
  overall: {
    consensus: { n_days: 28, mae: 1.5, bias: 0.1, bucket_hit_rate: 0.41 },
    ncep_nbm_conus: { n_days: 28, mae: 2.1, bias: -0.9, bucket_hit_rate: 0.31 },
    gfs_hrrr: { n_days: 28, mae: 2.2, bias: 0.1, bucket_hit_rate: 0.26 },
    gfs_global: { n_days: 28, mae: 2.2, bias: 0.8, bucket_hit_rate: 0.33 },
  },
  by_city: {},
};

it("renders per-model grades with closest-model verdict", () => {
  render(<AggregateStrip aggregate={AGG} modelGrades={MG} />);
  expect(screen.getByTestId("verdict").textContent).toBe(
    "CONSENSUS CLOSEST · DAY-AHEAD · LAST 30 DAYS",
  );
  expect(screen.getByText("1.5°")).toBeInTheDocument();   // consensus MAE stat
});

it("live mode with no grades yet prompts backfill", () => {
  render(<AggregateStrip aggregate={AGG} modelGrades={null} />);
  expect(screen.getByTestId("verdict").textContent).toContain("AWAITING MODEL GRADES");
});

it("fixtures mode unchanged", () => {
  render(<AggregateStrip aggregate={AGG} />);
  expect(screen.getByText("SCENARIOS")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure** — `cd web && npx vitest run src/components/AggregateStrip.test.tsx`.

- [ ] **Step 3: Implement `AggregateStrip.tsx`** — replace the `verification` prop and its two branches with `modelGrades?: ModelGrades | null`:
  - `null` → same layout as the old awaiting branch, text `AWAITING MODEL GRADES — run: uv run edgecast backfill`.
  - object → one `Stat` per model in `MODEL_ORDER` ∩ `overall` with label `${MODEL_NAMES[m]} MAE` and value `${g.mae.toFixed(1)}°`, plus a `Stat` label `CONSENSUS RIGHT BUCKET` value `${Math.round(hit * 100)}%` (omit if `bucket_hit_rate === null`). Verdict: closest = lowest `mae`; tie broken by higher `bucket_hit_rate` (null counts as −1); if still tied → `MODELS TIED · DAY-AHEAD · LAST ${window_days} DAYS`, else `${MODEL_NAMES[closest]} CLOSEST · DAY-AHEAD · LAST ${window_days} DAYS`.
  - `undefined` → existing aggregate branch, untouched. Delete the `VERDICT` map and `VerificationInfo` import.

- [ ] **Step 4: Update `App.tsx`**:

```tsx
<AggregateStrip
  aggregate={output.aggregate}
  modelGrades={mode === "live" ? (output.model_grades ?? null) : undefined}
/>
```

and CityCard wiring:

```tsx
<CityCard
  location={location}
  cityInfo={cities[location]}
  results={results}
  modelHighs={output.live?.model_highs?.[location]}
  grades={output.model_grades?.by_city?.[location]}
  mismatches={ /* unchanged filter */ }
/>
```

- [ ] **Step 5: Update `App.test.tsx`** — in `LIVE_OUTPUT`: trim `verification` to the new shape, add `model_grades` (reuse `MG` shape) and `live.model_highs` / `live.consensus_sigma`; update boot assertions (no yesterday text; expect the consensus header and verdict `CONSENSUS CLOSEST · DAY-AHEAD · LAST 30 DAYS`).

- [ ] **Step 6: Run everything** — `cd web && npx vitest run && npx tsc -b && npm run build`. Expected: all tests pass, typecheck and build clean.

---

### Task 8: Real backfill, live verify, anti-slop audit

**Files:** none (verification only; network required).

- [ ] **Step 1: Suites** — `uv run pytest -q` (root) and `cd web && npx vitest run`. Green.

- [ ] **Step 2: Real backfill** — `uv run edgecast backfill --days 30`. Expect `model grading: ~840 model-day rows` (30 days × 7 cities × 4 models; a few missing days acceptable). Then spot-check by hand: pick one (model, city, date), `sqlite3 data/edgecast.db "SELECT predicted_high, observed_high, error FROM model_days WHERE model='gfs_hrrr' AND city='AUS' AND event_date='<date>'"` and compare `predicted_high` against a direct `curl` of the previous-runs API for that station/date, and `observed_high` against ACIS. Record both numbers. Then check calibration sanity: `sqlite3 data/edgecast.db "SELECT model, COUNT(*), ROUND(AVG(abs_error),2) FROM model_days GROUP BY model"` — consensus MAE should be ≈1.5 °F and strictly below every source model (probe predicted 1.48 vs 2.11–2.19).

- [ ] **Step 3: Serve + browser** — `cd web && npm run build`, then `uv run edgecast serve`; open http://127.0.0.1:8000. Verify: consensus high + muted per-model values in each card header; `▸` marker on the bucket containing the rounded consensus; footer shows one grade line per model in plain words; strip shows per-model MAE + verdict `… CLOSEST · DAY-AHEAD · LAST 30 DAYS`; no YESTERDAY line anywhere; threshold stepper still live-updates; FIXTURES mode still renders ladders + original aggregate strip.

- [ ] **Step 4: Anti-slop audit** — `grep -rln "text-up\|text-down\|2ecc71\|ff4d4d\|46, 204, 113\|255, 77, 77" web/src/` → only `theme.css`, `CityCard.tsx` (+ its test). No new shadows/gradients/rounded/spinners/emoji (`⚠︎ ✓ ● ▲ ▼ ▸` are glyphs). `grep -rn "gfs_seamless" src/edgecast/` → only `openmeteo.py` and `verify.py`. Deps unchanged (`git diff pyproject.toml web/package.json` empty). Record results in the progress ledger.

---

## Model delegation notes (per global CLAUDE.md)

- Tasks 1–5 → gpt-5.5 via `codex exec` xhigh (Task 1 records a real fixture — network needed; use `UV_CACHE_DIR=/private/tmp/uv-cache`).
- Tasks 6–8 → fable-5 inline (taste-heavy frontend + final audit). Reviews after each task: fable-5.
- **Commits: user only — no agent ever runs `git commit`/`git add`.**
