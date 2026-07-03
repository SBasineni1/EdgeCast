# EdgeCast v2 — Live Kalshi Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dashboard opens in LIVE mode showing every registry city's open Kalshi high-temp buckets — real prices vs real GEFS ensemble probabilities — with green/red directional edge flags, location-first cards grouped by city, and 60s auto-refresh; FIXTURES mode keeps v1 behavior.

**Architecture:** A `between` condition extends the existing pipeline (output schema 1.2). A new `src/edgecast/live/` package (stations registry, Kalshi client, Open-Meteo client, TTL cache, assembly) feeds the unchanged `analyze` pipeline; `GET /api/live` exposes it with serve-stale caching. Frontend: retire orange for up-green/down-red tokens, redesign card headers threshold-first, group by city, add a LIVE/FIXTURES toggle + staleness stamp + upstream strips.

**Tech Stack:** Existing stack. New runtime dep for the server extra only: `httpx>=0.27` (already in dev group) moves into `[project.optional-dependencies] server` for upstream calls.

**Spec:** `docs/superpowers/specs/2026-07-03-live-kalshi-design.md` — its UI amendments and API contracts bind every task.

## Global Constraints

- **No agent commits.** User commits manually. Never `git commit`/`git push`; no `Co-Authored-By`. Tasks end when tests pass.
- Core pipeline modules stay stdlib-only; httpx/fastapi/uvicorn imports live only in `server.py` and `live/`.
- No trading/sizing/financial-advice language anywhere.
- `between` is inclusive both ends: YES iff `threshold_low <= value <= threshold_high`. Binary markets carry `threshold` only; between markets carry `threshold_low`+`threshold_high` only — validation rejects mixed/missing shapes (message names scenario + field).
- Output `schema_version` becomes `"1.2"`. Input schema stays `"1.0"` (additive).
- Kalshi: `https://api.elections.kalshi.com/trade-api/v2` public endpoints, no auth, 5s timeout. Open-Meteo: `https://ensemble-api.open-meteo.com/v1/ensemble`, `models=gfs_seamless`, `temperature_unit=fahrenheit`, no auth, 10s timeout. No retries; TTL cache (quotes 30s, ensembles 1800s) with serve-stale on failure.
- Unit tests never touch the network — recorded JSON fixtures in `tests/fixtures_live/`. Real-network test only behind `EDGECAST_LIVE_TESTS=1`.
- **Anti-slop contract (amended):** exactly two accent colors — up-green `#2ECC71`, down-red `#FF4D4D` — used ONLY in edge flags (arrow, value, direction word, glow). Orange is removed entirely. All other v1 contract items stand (no gradients, no shadows beyond the two sanctioned glows, no emoji, square corners, no spinners/shimmer, no purple, no dashboard furniture, mono numerals, uppercase letterspaced labels).
- Python tests: `uv run pytest …` from repo root. Frontend commands run in `web/`.
- Model split: Tasks 1–4 (backend) → gpt-5.5 via codex exec xhigh; Tasks 5–7 (frontend, verify, audit) → fable-5 inline.

---

### Task 1: Pipeline `between` condition + schema 1.2

**Files:**
- Modify: `src/edgecast/types.py` (MarketQuote), `src/edgecast/conditions.py`, `src/edgecast/forecast.py`, `src/edgecast/settlement.py`, `src/edgecast/pipeline.py`, `src/edgecast/jsonio.py`
- Modify: `tests/test_conditions.py`, `tests/test_forecast.py`, `tests/test_settlement.py`, `tests/test_jsonio.py`, `tests/test_cli.py`

**Interfaces:**
- Consumes: existing pipeline.
- Produces: `MarketQuote` with optional `threshold`/`threshold_low`/`threshold_high` (all default `None`, placed after `yes_price`); `conditions.satisfies_market(value: float, market: MarketQuote) -> bool`; `forecast.model_implied_probability(forecast: EnsembleForecast, market: MarketQuote) -> ModelProbability` (signature change); `jsonio.OUTPUT_SCHEMA_VERSION = "1.2"`; output `market` block carries whichever threshold shape the market has (binary: `"threshold"` key only; between: `"threshold_low"`+`"threshold_high"` keys only).

- [ ] **Step 1: Update/add failing tests**

`tests/test_conditions.py` — change the whitelist test and add between tests:

```python
def test_comparator_whitelist():
    assert COMPARATORS == (">=", ">", "<=", "<", "between")
```

Append (with `from edgecast.conditions import satisfies_market` and a small quote helper):

```python
from edgecast.types import MarketQuote


def make_quote(**kw) -> MarketQuote:
    base = dict(
        market_id="M", question="q", location="NYC", variable="high_temp_f",
        comparator=">=", event_date="2026-07-05", yes_price=0.5, threshold=90.0,
    )
    base.update(kw)
    return MarketQuote(**base)


@pytest.mark.parametrize(
    ("value", "expected"),
    [(87.9, False), (88.0, True), (88.5, True), (89.0, True), (89.1, False)],
)
def test_between_inclusive_both_ends(value, expected):
    q = make_quote(comparator="between", threshold=None, threshold_low=88.0, threshold_high=89.0)
    assert satisfies_market(value, q) is expected


def test_between_low_equals_high():
    q = make_quote(comparator="between", threshold=None, threshold_low=90.0, threshold_high=90.0)
    assert satisfies_market(90.0, q) is True
    assert satisfies_market(90.1, q) is False


def test_satisfies_market_binary_delegates():
    assert satisfies_market(93.0, make_quote()) is True
    assert satisfies_market(89.0, make_quote()) is False


def test_satisfies_rejects_between_without_market():
    with pytest.raises(ValueError, match="between"):
        satisfies(90.0, "between", 90.0)
```

`tests/test_forecast.py` — the function now takes a market. Replace calls `model_implied_probability(fc, ">=", 90.0)` with `model_implied_probability(fc, make_quote(comparator=">=", threshold=90.0))` using this helper added at top:

```python
from edgecast.types import MarketQuote


def make_quote(**kw) -> MarketQuote:
    base = dict(
        market_id="M", question="q", location="NYC", variable="high_temp_f",
        comparator=">=", event_date="2026-07-05", yes_price=0.5, threshold=90.0,
    )
    base.update(kw)
    return MarketQuote(**base)
```

Add a between test:

```python
def test_between_fraction():
    fc = make_forecast([87.0, 88.0, 88.5, 89.0, 91.0])
    q = make_quote(comparator="between", threshold=None, threshold_low=88.0, threshold_high=89.0)
    mp = model_implied_probability(fc, q)
    assert mp.raw == 0.6  # 88.0, 88.5, 89.0
```

`tests/test_jsonio.py` — change `OUTPUT_SCHEMA_VERSION` expectation implicitly (the constant import stays; its value changes — update the CLI test below instead), and add validation/output tests:

```python
def test_between_scenario_loads_and_outputs_bounds():
    data = copy.deepcopy(VALID)
    m = data["scenarios"][0]["market"]
    del m["threshold"]
    m.update(comparator="between", threshold_low=88.0, threshold_high=89.0)
    scenarios = load_scenarios(data)
    assert scenarios[0].market.threshold_low == 88.0
    results, agg = analyze(scenarios)
    out = build_output(results, agg, generated_at="2026-07-03T00:00:00+00:00")
    mb = out["results"][0]["market"]
    assert mb["threshold_low"] == 88.0 and mb["threshold_high"] == 89.0
    assert "threshold" not in mb


@pytest.mark.parametrize(
    ("mutate", "field"),
    [
        (lambda m: m.update(comparator="between", threshold_low=88.0), "threshold_high"),
        (lambda m: m.update(comparator="between", threshold_high=89.0), "threshold_low"),
        (lambda m: m.update(comparator="between", threshold_low=90.0, threshold_high=88.0), "threshold_low"),
        (lambda m: (m.pop("threshold"), m.update(comparator="between", threshold=90.0, threshold_low=88.0, threshold_high=89.0)), "threshold"),
        (lambda m: m.update(threshold_low=88.0), "threshold_low"),
    ],
)
def test_between_shape_violations_rejected(mutate, field):
    data = copy.deepcopy(VALID)
    mutate(data["scenarios"][0]["market"])
    with pytest.raises(ScenarioValidationError) as exc:
        load_scenarios(data)
    assert field in str(exc.value)
```

(Note the 4th case first pops then re-adds `threshold` alongside bounds — "both shapes present". Keep exactly this construction.)

`tests/test_cli.py` — `assert out["schema_version"] == "1.1"` becomes `== "1.2"`.

- [ ] **Step 2: Run to verify failures**

Run: `uv run pytest tests/test_conditions.py tests/test_forecast.py tests/test_jsonio.py tests/test_cli.py -v`
Expected: FAIL — import errors (`satisfies_market`) and assertion failures (whitelist, schema version).

- [ ] **Step 3: Implement**

`src/edgecast/types.py` — replace `MarketQuote` with (field order matters — defaults last):

```python
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
```

`src/edgecast/conditions.py` — full new content:

```python
"""Market-condition evaluation shared by the forecast and settlement stages."""

from edgecast.types import MarketQuote

COMPARATORS: tuple[str, ...] = (">=", ">", "<=", "<", "between")


def satisfies(value: float, comparator: str, threshold: float) -> bool:
    """Return True when `value <comparator> threshold` holds (binary only)."""
    if comparator == ">=":
        return value >= threshold
    if comparator == ">":
        return value > threshold
    if comparator == "<=":
        return value <= threshold
    if comparator == "<":
        return value < threshold
    if comparator == "between":
        raise ValueError("between requires bounds; use satisfies_market")
    raise ValueError(f"unknown comparator: {comparator!r}")


def satisfies_market(value: float, market: MarketQuote) -> bool:
    """Evaluate a market's condition against a value.

    Validation guarantees the threshold shape matches the comparator, so the
    assertions here guard programming errors, not user input.
    """
    if market.comparator == "between":
        assert market.threshold_low is not None and market.threshold_high is not None
        return market.threshold_low <= value <= market.threshold_high
    assert market.threshold is not None
    return satisfies(value, market.comparator, market.threshold)
```

`src/edgecast/forecast.py` — signature change; full new content:

```python
"""Forecast stage: ensemble members -> model-implied probability."""

from edgecast.conditions import satisfies_market
from edgecast.types import EnsembleForecast, MarketQuote, ModelProbability


def model_implied_probability(
    forecast: EnsembleForecast, market: MarketQuote
) -> ModelProbability:
    """Fraction of ensemble members satisfying the market condition.

    The raw fraction is clamped to [1/(n+1), n/(n+1)]: a finite ensemble
    cannot certify probability 0 or 1, and unclamped extremes break
    log-odds math downstream.
    """
    n = len(forecast.members)
    if n == 0:
        raise ValueError("ensemble has no members")
    hits = sum(1 for m in forecast.members if satisfies_market(m, market))
    raw = hits / n
    lo, hi = 1 / (n + 1), n / (n + 1)
    clamped = min(max(raw, lo), hi)
    return ModelProbability(raw=raw, clamped=clamped, n_members=n)
```

`src/edgecast/settlement.py` — replace the import and outcome expression:

```python
from edgecast.conditions import satisfies_market
```

```python
    outcome = 1 if satisfies_market(observation.observed_value, market) else 0
```

`src/edgecast/pipeline.py` — the forecast call becomes:

```python
    model = model_implied_probability(scenario.forecast, scenario.market)
```

`src/edgecast/jsonio.py` — three changes:

1. `OUTPUT_SCHEMA_VERSION = "1.2"`.
2. In `_parse_market`: remove `"threshold"` from the required-keys loop (keep the other required keys), then after the comparator check insert:

```python
    has_t = "threshold" in raw
    has_lo = "threshold_low" in raw
    has_hi = "threshold_high" in raw
    if comparator == "between":
        if has_t:
            _fail(scenario_id, "market.threshold", "must be omitted for between markets")
        if not has_lo:
            _fail(scenario_id, "market.threshold_low", "is required for between markets")
        if not has_hi:
            _fail(scenario_id, "market.threshold_high", "is required for between markets")
        t_lo = _require_number(scenario_id, "market.threshold_low", raw["threshold_low"])
        t_hi = _require_number(scenario_id, "market.threshold_high", raw["threshold_high"])
        if t_lo > t_hi:
            _fail(scenario_id, "market.threshold_low", f"must be <= threshold_high (got {t_lo} > {t_hi})")
        threshold, threshold_low, threshold_high = None, t_lo, t_hi
    else:
        if has_lo or has_hi:
            _fail(scenario_id, "market.threshold_low", "bounds are only valid for between markets")
        if not has_t:
            _fail(scenario_id, "market.threshold", "is required")
        threshold = _require_number(scenario_id, "market.threshold", raw["threshold"])
        threshold_low, threshold_high = None, None
```

and pass `threshold=threshold, threshold_low=threshold_low, threshold_high=threshold_high` in the `MarketQuote(...)` construction (replacing the old `threshold=` line).
3. In `_result_dict`, the market block becomes shape-aware:

```python
    market_block: dict = {
        "question": r.market.question,
        "location": r.market.location,
        "variable": r.market.variable,
        "comparator": r.market.comparator,
        "event_date": r.market.event_date,
    }
    if r.market.comparator == "between":
        market_block["threshold_low"] = r.market.threshold_low
        market_block["threshold_high"] = r.market.threshold_high
    else:
        market_block["threshold"] = r.market.threshold
```

and use `"market": market_block,` in the returned dict.

- [ ] **Step 4: Full suite**

Run: `uv run pytest -v`
Expected: all pass (existing binary behavior byte-identical; new between tests green; CLI schema 1.2).

---

### Task 2: Stations registry + Kalshi client (recorded fixture)

**Files:**
- Create: `src/edgecast/live/__init__.py` (empty), `src/edgecast/live/stations.py`, `src/edgecast/live/kalshi.py`
- Create: `tests/fixtures_live/kalshi_markets.json` (recorded from the real API in Step 1)
- Test: `tests/test_live_kalshi.py`

**Interfaces:**
- Consumes: `MarketQuote` (Task 1 shape).
- Produces:
  - `stations.STATIONS: dict[str, Station]` — `@dataclass(frozen=True) Station(series: str, city: str, name: str, station: str, lat: float, lon: float, tz: str)`, keyed by series ticker.
  - `kalshi.fetch_markets(series_ticker: str, client: httpx.Client) -> list[dict]` (paginates via cursor).
  - `kalshi.to_quote(market: dict, city: str) -> MarketQuote | None` (None = unusable, skip).
  - `kalshi.event_date_from_ticker(event_ticker: str) -> str` (ISO date).

- [ ] **Step 1: Record the real fixture and verify the station list**

Run (network required):

```bash
mkdir -p tests/fixtures_live
curl -s "https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=KXHIGHNY&status=open&limit=50" -o tests/fixtures_live/kalshi_markets.json
python3 -c "import json; d=json.load(open('tests/fixtures_live/kalshi_markets.json')); ms=d['markets']; print(len(ms)); print({m.get('strike_type') for m in ms}); print(json.dumps(ms[0], indent=2)[:1200])"
curl -s "https://api.elections.kalshi.com/trade-api/v2/series/KXHIGHCHI" | head -c 300
```

Inspect the printed market object and note the EXACT field names for: ticker, event_ticker, title, strike_type, floor_strike, cap_strike, last_price, yes_bid, yes_ask, status. The implementation below assumes those names; if the live API differs, adapt the implementation to the real names and record the difference in your report. Also confirm each series in the STATIONS list below exists (HTTP 200); drop or correct any that don't, reporting the change.

- [ ] **Step 2: Write the failing tests**

`tests/test_live_kalshi.py`:

```python
import json
from pathlib import Path

import pytest

from edgecast.live.kalshi import event_date_from_ticker, to_quote
from edgecast.live.stations import STATIONS

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures_live" / "kalshi_markets.json").read_text()
)


def test_stations_registry_shape():
    assert "KXHIGHNY" in STATIONS
    ny = STATIONS["KXHIGHNY"]
    assert ny.city == "NYC"
    assert 40 < ny.lat < 41 and -75 < ny.lon < -73
    assert all(s.tz for s in STATIONS.values())


def test_event_date_from_ticker():
    assert event_date_from_ticker("KXHIGHNY-26JUL03") == "2026-07-03"
    assert event_date_from_ticker("KXHIGHCHI-26DEC31") == "2026-12-31"


def test_event_date_rejects_garbage():
    with pytest.raises(ValueError):
        event_date_from_ticker("KXHIGHNY")


def test_to_quote_maps_fixture_markets():
    quotes = [to_quote(m, "NYC") for m in FIXTURE["markets"]]
    usable = [q for q in quotes if q is not None]
    assert usable, "fixture should yield at least one usable quote"
    for q in usable:
        assert 0.0 < q.yes_price < 1.0
        assert q.location == "NYC"
        if q.comparator == "between":
            assert q.threshold_low is not None and q.threshold_low <= q.threshold_high
        else:
            assert q.comparator in (">=", "<=") and q.threshold is not None


def test_to_quote_price_fallback_and_skips():
    base = dict(FIXTURE["markets"][0])
    base.update(strike_type="greater", floor_strike=90.0, last_price=0, yes_bid=40, yes_ask=44)
    q = to_quote(base, "NYC")
    assert q is not None and q.yes_price == pytest.approx(0.42)
    base.update(last_price=0, yes_bid=0, yes_ask=0)
    assert to_quote(base, "NYC") is None
    base.update(strike_type="weird_new_type", last_price=50)
    assert to_quote(base, "NYC") is None
```

- [ ] **Step 3: Verify failure**

Run: `uv run pytest tests/test_live_kalshi.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'edgecast.live'`.

- [ ] **Step 4: Implement**

`src/edgecast/live/stations.py`:

```python
"""Registry of Kalshi daily-high-temperature series and their stations."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Station:
    series: str
    city: str      # short code shown on cards ("NYC")
    name: str      # display name ("New York")
    station: str   # observing station ("Central Park")
    lat: float
    lon: float
    tz: str        # IANA timezone


_ALL = [
    Station("KXHIGHNY", "NYC", "New York", "Central Park", 40.783, -73.967, "America/New_York"),
    Station("KXHIGHCHI", "CHI", "Chicago", "Midway", 41.786, -87.752, "America/Chicago"),
    Station("KXHIGHMIA", "MIA", "Miami", "Miami Intl", 25.788, -80.317, "America/New_York"),
    Station("KXHIGHAUS", "AUS", "Austin", "Camp Mabry", 30.321, -97.760, "America/Chicago"),
    Station("KXHIGHDEN", "DEN", "Denver", "Denver Intl", 39.847, -104.656, "America/Denver"),
    Station("KXHIGHPHIL", "PHL", "Philadelphia", "Philadelphia Intl", 39.868, -75.231, "America/New_York"),
    Station("KXHIGHLAX", "LAX", "Los Angeles", "LAX", 33.938, -118.389, "America/Los_Angeles"),
]

STATIONS: dict[str, Station] = {s.series: s for s in _ALL}
```

(Adjust the list per Step 1's verification; keep coordinates of the official observing stations.)

`src/edgecast/live/kalshi.py`:

```python
"""Kalshi public market-data client (no auth): markets -> MarketQuote."""

import re
from datetime import date

import httpx

from edgecast.types import MarketQuote

BASE_URL = "https://api.elections.kalshi.com/trade-api/v2"
TIMEOUT = 5.0

_MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}
_DATE_RE = re.compile(r"-(\d{2})([A-Z]{3})(\d{2})$")

_STRIKE_COMPARATORS = {
    "greater": ">=",
    "greater_or_equal": ">=",
    "less": "<=",
    "less_or_equal": "<=",
}


def event_date_from_ticker(event_ticker: str) -> str:
    m = _DATE_RE.search(event_ticker)
    if m is None:
        raise ValueError(f"cannot parse event date from ticker: {event_ticker!r}")
    yy, mon, dd = m.groups()
    return date(2000 + int(yy), _MONTHS[mon], int(dd)).isoformat()


def fetch_markets(series_ticker: str, client: httpx.Client) -> list[dict]:
    markets: list[dict] = []
    cursor: str | None = None
    while True:
        params: dict = {"series_ticker": series_ticker, "status": "open", "limit": 100}
        if cursor:
            params["cursor"] = cursor
        resp = client.get(f"{BASE_URL}/markets", params=params, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        markets.extend(data.get("markets", []))
        cursor = data.get("cursor")
        if not cursor:
            return markets


def _price(market: dict) -> float | None:
    last = market.get("last_price") or 0
    if 0 < last < 100:
        return last / 100
    bid, ask = market.get("yes_bid") or 0, market.get("yes_ask") or 0
    if 0 < bid and 0 < ask < 100:
        return (bid + ask) / 200
    return None


def to_quote(market: dict, city: str) -> MarketQuote | None:
    strike_type = market.get("strike_type")
    price = _price(market)
    if price is None or not 0.0 < price < 1.0:
        return None
    try:
        event_date = event_date_from_ticker(market["event_ticker"])
    except (KeyError, ValueError):
        return None
    common = dict(
        market_id=market.get("ticker", ""),
        question=market.get("title") or market.get("ticker", ""),
        location=city,
        variable="high_temp_f",
        event_date=event_date,
        yes_price=price,
    )
    if strike_type == "between":
        lo, hi = market.get("floor_strike"), market.get("cap_strike")
        if lo is None or hi is None or lo > hi:
            return None
        return MarketQuote(comparator="between", threshold_low=float(lo), threshold_high=float(hi), **common)
    comparator = _STRIKE_COMPARATORS.get(strike_type or "")
    if comparator is None:
        return None
    strike = market.get("floor_strike") if comparator == ">=" else market.get("cap_strike")
    if strike is None:
        return None
    return MarketQuote(comparator=comparator, threshold=float(strike), **common)
```

(If Step 1 showed different field names or strike semantics, follow the real API and note it in your report.)

Also add `httpx>=0.27` to `[project.optional-dependencies] server` in `pyproject.toml` (it is already in the dev group), then `uv sync`.

- [ ] **Step 5: Verify pass**

Run: `uv run pytest tests/test_live_kalshi.py -v`
Expected: PASS. Then `uv run pytest` — full suite green.

---

### Task 3: Open-Meteo ensemble client (recorded fixture)

**Files:**
- Create: `src/edgecast/live/openmeteo.py`
- Create: `tests/fixtures_live/openmeteo_ensemble.json` (recorded)
- Test: `tests/test_live_openmeteo.py`

**Interfaces:**
- Consumes: `EnsembleForecast`.
- Produces: `openmeteo.fetch_ensemble_high(lat: float, lon: float, event_date: str, tz: str, client: httpx.Client) -> EnsembleForecast` and pure helper `openmeteo.daily_highs(payload: dict, event_date: str) -> tuple[float, ...]`.

- [ ] **Step 1: Record the real fixture**

```bash
curl -s "https://ensemble-api.open-meteo.com/v1/ensemble?latitude=40.783&longitude=-73.967&hourly=temperature_2m&models=gfs_seamless&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=2" -o tests/fixtures_live/openmeteo_ensemble.json
python3 -c "import json; d=json.load(open('tests/fixtures_live/openmeteo_ensemble.json')); h=d['hourly']; ks=[k for k in h if k.startswith('temperature_2m')]; print(len(ks), 'member keys'); print(h['time'][0], h['time'][-1])"
```

Note the member key pattern (`temperature_2m`, `temperature_2m_member01`, …) and record today's local date printed in `time` — the test below computes it from the fixture itself, so the fixture stays valid forever.

- [ ] **Step 2: Write the failing tests**

`tests/test_live_openmeteo.py`:

```python
import json
from pathlib import Path

import pytest

from edgecast.live.openmeteo import daily_highs

PAYLOAD = json.loads(
    (Path(__file__).parent / "fixtures_live" / "openmeteo_ensemble.json").read_text()
)
FIXTURE_DATE = PAYLOAD["hourly"]["time"][0][:10]


def test_daily_highs_one_value_per_member():
    member_keys = [k for k in PAYLOAD["hourly"] if k.startswith("temperature_2m")]
    highs = daily_highs(PAYLOAD, FIXTURE_DATE)
    assert len(highs) == len(member_keys)
    assert all(isinstance(h, float) for h in highs)
    assert all(-60.0 < h < 140.0 for h in highs)


def test_daily_highs_is_max_within_local_date():
    hourly = {
        "time": ["2026-07-03T00:00", "2026-07-03T12:00", "2026-07-04T00:00"],
        "temperature_2m": [70.0, 91.5, 99.0],
        "temperature_2m_member01": [68.0, 89.0, 55.0],
    }
    assert daily_highs({"hourly": hourly}, "2026-07-03") == (91.5, 89.0)


def test_daily_highs_skips_members_with_missing_data():
    hourly = {
        "time": ["2026-07-03T00:00", "2026-07-03T12:00"],
        "temperature_2m": [70.0, 91.5],
        "temperature_2m_member01": [None, None],
    }
    assert daily_highs({"hourly": hourly}, "2026-07-03") == (91.5,)


def test_daily_highs_empty_date_raises():
    hourly = {"time": ["2026-07-03T00:00"], "temperature_2m": [70.0]}
    with pytest.raises(ValueError, match="no hourly data"):
        daily_highs({"hourly": hourly}, "2026-07-09")
```

- [ ] **Step 3: Verify failure**

Run: `uv run pytest tests/test_live_openmeteo.py -v`
Expected: FAIL — no module `edgecast.live.openmeteo`.

- [ ] **Step 4: Implement**

`src/edgecast/live/openmeteo.py`:

```python
"""Open-Meteo ensemble client: GEFS members -> per-member daily highs."""

from datetime import datetime, timezone

import httpx

from edgecast.types import EnsembleForecast

BASE_URL = "https://ensemble-api.open-meteo.com/v1/ensemble"
TIMEOUT = 10.0


def daily_highs(payload: dict, event_date: str) -> tuple[float, ...]:
    """Reduce each ensemble member's hourly series to its max on the local date."""
    hourly = payload["hourly"]
    idx = [i for i, t in enumerate(hourly["time"]) if t.startswith(event_date)]
    if not idx:
        raise ValueError(f"no hourly data for {event_date}")
    highs: list[float] = []
    for key, series in hourly.items():
        if not key.startswith("temperature_2m"):
            continue
        values = [series[i] for i in idx if series[i] is not None]
        if values:
            highs.append(float(max(values)))
    return tuple(highs)


def fetch_ensemble_high(
    lat: float, lon: float, event_date: str, tz: str, client: httpx.Client
) -> EnsembleForecast:
    resp = client.get(
        BASE_URL,
        params={
            "latitude": lat,
            "longitude": lon,
            "hourly": "temperature_2m",
            "models": "gfs_seamless",
            "temperature_unit": "fahrenheit",
            "timezone": tz,
            "forecast_days": 3,
        },
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    members = daily_highs(resp.json(), event_date)
    return EnsembleForecast(
        source="open-meteo gfs_seamless",
        issued_at=datetime.now(timezone.utc).isoformat(),
        members=members,
    )
```

- [ ] **Step 5: Verify pass**

Run: `uv run pytest tests/test_live_openmeteo.py -v` then full suite.
Expected: PASS.

---

### Task 4: TTL cache + assembly + `GET /api/live`

**Files:**
- Create: `src/edgecast/live/cache.py`, `src/edgecast/live/assemble.py`
- Modify: `src/edgecast/server.py`
- Test: `tests/test_live_assemble.py`, append to `tests/test_server.py`; Create: `tests/test_live_integration.py`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `cache.TTLCache` with `get(key, ttl_seconds) -> value | None`, `get_stale(key) -> (value, age_seconds) | None`, `put(key, value)`; time injectable via `clock` constructor arg (default `time.time`).
  - `assemble.build_live_scenarios(kalshi_client, meteo_client) -> LiveResult` where `@dataclass LiveResult(scenarios: list[Scenario], cities_ok: list[str], cities_failed: list[dict], quotes_age_seconds: int, ensembles_age_seconds: int)`. Module-level caches `QUOTES_CACHE`/`ENSEMBLES_CACHE` (TTL 30 / 1800).
  - `GET /api/live?edge_threshold=…` on the existing app per the spec's response contract (adds `live` block with `cities` display map from STATIONS; 502 when no city succeeds).

- [ ] **Step 1: Write the failing tests**

`tests/test_live_assemble.py`:

```python
import pytest

from edgecast.live.cache import TTLCache


def test_ttl_cache_hit_expiry_and_stale():
    t = {"now": 1000.0}
    c = TTLCache(clock=lambda: t["now"])
    assert c.get("k", 30) is None
    c.put("k", "v")
    assert c.get("k", 30) == "v"
    t["now"] += 31
    assert c.get("k", 30) is None          # expired for fresh reads
    assert c.get_stale("k") == ("v", 31)   # still available as stale
    assert c.get_stale("missing") is None
```

Append to `tests/test_server.py` (uses the existing `client` fixture; monkeypatch assembly):

```python
def _fake_live_result(**kw):
    from edgecast.live.assemble import LiveResult
    from edgecast.types import EnsembleForecast, MarketQuote, Scenario

    scenario = Scenario(
        scenario_id="KXHIGHNY-26JUL03-B88.5",
        market=MarketQuote(
            market_id="KXHIGHNY-26JUL03-B88.5",
            question="Will the high in NYC be 88-89?",
            location="NYC",
            variable="high_temp_f",
            comparator="between",
            event_date="2026-07-03",
            yes_price=0.42,
            threshold_low=88.0,
            threshold_high=89.0,
        ),
        forecast=EnsembleForecast(
            source="open-meteo gfs_seamless",
            issued_at="2026-07-03T12:00:00+00:00",
            members=tuple([87.0] * 10 + [88.5] * 20),
        ),
        observation=None,
    )
    base = dict(
        scenarios=[scenario], cities_ok=["NYC"], cities_failed=[],
        quotes_age_seconds=5, ensembles_age_seconds=100,
    )
    base.update(kw)
    return LiveResult(**base)


def test_live_endpoint_happy_path(client, monkeypatch):
    import edgecast.server as server_mod

    monkeypatch.setattr(server_mod, "build_live_scenarios", lambda *a, **k: _fake_live_result())
    r = client.get("/api/live")
    assert r.status_code == 200
    out = r.json()
    assert out["schema_version"] == "1.2"
    assert out["results"][0]["model_prob"] == pytest.approx(20 / 30)
    assert out["results"][0]["market"]["threshold_low"] == 88.0
    assert out["live"]["cities_ok"] == ["NYC"]
    assert out["live"]["cities"]["NYC"]["series"] == "KXHIGHNY"
    assert out["aggregate"]["n_settled"] == 0


def test_live_endpoint_partial_failure_reported(client, monkeypatch):
    import edgecast.server as server_mod

    monkeypatch.setattr(
        server_mod,
        "build_live_scenarios",
        lambda *a, **k: _fake_live_result(
            cities_failed=[{"city": "MIA", "reason": "kalshi: HTTP 503"}]
        ),
    )
    out = client.get("/api/live").json()
    assert out["live"]["cities_failed"][0]["city"] == "MIA"


def test_live_endpoint_total_failure_502(client, monkeypatch):
    import edgecast.server as server_mod

    monkeypatch.setattr(
        server_mod,
        "build_live_scenarios",
        lambda *a, **k: _fake_live_result(
            scenarios=[], cities_ok=[],
            cities_failed=[{"city": "NYC", "reason": "kalshi: timeout"}],
        ),
    )
    r = client.get("/api/live")
    assert r.status_code == 502
    assert "NYC" in r.json()["detail"]


def test_live_endpoint_threshold_validation(client):
    assert client.get("/api/live?edge_threshold=1.5").status_code == 422
```

`tests/test_live_integration.py`:

```python
"""Opt-in real-network test: EDGECAST_LIVE_TESTS=1 uv run pytest tests/test_live_integration.py"""

import os

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("EDGECAST_LIVE_TESTS") != "1",
    reason="set EDGECAST_LIVE_TESTS=1 to hit real Kalshi/Open-Meteo APIs",
)


def test_live_assembly_against_real_apis():
    import httpx

    from edgecast.live.assemble import build_live_scenarios

    with httpx.Client() as kc, httpx.Client() as mc:
        result = build_live_scenarios(kc, mc)
    assert result.cities_ok, f"all cities failed: {result.cities_failed}"
    assert result.scenarios
    s = result.scenarios[0]
    assert 0.0 < s.market.yes_price < 1.0
    assert len(s.forecast.members) >= 10
```

- [ ] **Step 2: Verify failure**

Run: `uv run pytest tests/test_live_assemble.py tests/test_server.py -v`
Expected: FAIL — no `edgecast.live.cache` / `build_live_scenarios` not importable in server.

- [ ] **Step 3: Implement**

`src/edgecast/live/cache.py`:

```python
"""In-process TTL cache with stale reads for serve-stale-on-failure."""

import time
from typing import Callable


class TTLCache:
    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock
        self._store: dict[str, tuple[float, object]] = {}

    def put(self, key: str, value: object) -> None:
        self._store[key] = (self._clock(), value)

    def get(self, key: str, ttl_seconds: float) -> object | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        ts, value = entry
        return value if self._clock() - ts < ttl_seconds else None

    def get_stale(self, key: str) -> tuple[object, int] | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        ts, value = entry
        return value, int(self._clock() - ts)
```

`src/edgecast/live/assemble.py`:

```python
"""Assemble live Kalshi markets + Open-Meteo ensembles into pipeline scenarios."""

from dataclasses import dataclass, field

import httpx

from edgecast.live.cache import TTLCache
from edgecast.live.kalshi import fetch_markets, to_quote
from edgecast.live.openmeteo import fetch_ensemble_high
from edgecast.live.stations import STATIONS
from edgecast.types import Scenario

QUOTES_TTL = 30.0
ENSEMBLES_TTL = 1800.0
QUOTES_CACHE = TTLCache()
ENSEMBLES_CACHE = TTLCache()


@dataclass
class LiveResult:
    scenarios: list[Scenario]
    cities_ok: list[str] = field(default_factory=list)
    cities_failed: list[dict] = field(default_factory=list)
    quotes_age_seconds: int = 0
    ensembles_age_seconds: int = 0


def _cached(cache: TTLCache, key: str, ttl: float, fetch):
    """Fresh value if cached, else fetch (caching it); on fetch failure fall back to stale."""
    value = cache.get(key, ttl)
    if value is not None:
        _, age = cache.get_stale(key)  # type: ignore[misc]
        return value, age, None
    try:
        value = fetch()
    except Exception as e:  # noqa: BLE001 - any upstream failure degrades to stale
        stale = cache.get_stale(key)
        if stale is not None:
            return stale[0], stale[1], None
        return None, 0, f"{type(e).__name__}: {e}"
    cache.put(key, value)
    return value, 0, None


def build_live_scenarios(
    kalshi_client: httpx.Client, meteo_client: httpx.Client
) -> LiveResult:
    result = LiveResult(scenarios=[])
    max_q_age = 0
    max_e_age = 0
    for series, st in STATIONS.items():
        markets, q_age, q_err = _cached(
            QUOTES_CACHE, series, QUOTES_TTL,
            lambda s=series: fetch_markets(s, kalshi_client),
        )
        if q_err is not None:
            result.cities_failed.append({"city": st.city, "reason": f"kalshi: {q_err}"})
            continue
        quotes = [q for m in markets if (q := to_quote(m, st.city)) is not None]
        if not quotes:
            result.cities_failed.append({"city": st.city, "reason": "kalshi: no usable open markets"})
            continue
        event_date = quotes[0].event_date
        forecast, e_age, e_err = _cached(
            ENSEMBLES_CACHE, f"{series}:{event_date}", ENSEMBLES_TTL,
            lambda st=st, d=event_date: fetch_ensemble_high(
                st.lat, st.lon, d, st.tz, meteo_client
            ),
        )
        if e_err is not None:
            result.cities_failed.append({"city": st.city, "reason": f"open-meteo: {e_err}"})
            continue
        for q in quotes:
            if q.event_date != event_date:
                continue  # one event date per refresh keeps one ensemble per city
            result.scenarios.append(
                Scenario(scenario_id=q.market_id, market=q, forecast=forecast, observation=None)
            )
        result.cities_ok.append(st.city)
        max_q_age = max(max_q_age, q_age)
        max_e_age = max(max_e_age, e_age)
    result.quotes_age_seconds = max_q_age
    result.ensembles_age_seconds = max_e_age
    return result
```

`src/edgecast/server.py` — add imports and the endpoint. New imports at top:

```python
import httpx

from edgecast.live.assemble import build_live_scenarios
from edgecast.live.stations import STATIONS
```

Inside `create_app`, after the analyze endpoint:

```python
    kalshi_client = httpx.Client()
    meteo_client = httpx.Client()

    @app.get("/api/live")
    def live_endpoint(edge_threshold: float = DEFAULT_EDGE_THRESHOLD) -> dict:
        if not 0.0 <= edge_threshold <= 1.0:
            raise HTTPException(status_code=422, detail="edge_threshold must be in [0, 1]")
        live = build_live_scenarios(kalshi_client, meteo_client)
        if not live.cities_ok:
            reasons = "; ".join(f"{f['city']}: {f['reason']}" for f in live.cities_failed)
            raise HTTPException(status_code=502, detail=f"no live data available: {reasons}")
        results, agg = analyze(live.scenarios, edge_threshold=edge_threshold)
        out = build_output(
            results, agg, generated_at=datetime.now(timezone.utc).isoformat()
        )
        out["live"] = {
            "fetched_at": out["generated_at"],
            "cities_ok": live.cities_ok,
            "cities_failed": live.cities_failed,
            "quotes_age_seconds": live.quotes_age_seconds,
            "ensembles_age_seconds": live.ensembles_age_seconds,
            "cities": {
                st.city: {"name": st.name, "station": st.station, "series": st.series}
                for st in STATIONS.values()
            },
        }
        return out
```

(FastAPI validates `edge_threshold` float parsing; the explicit range check returns 422 to match `/api/analyze` semantics.)

- [ ] **Step 4: Verify pass + full suite**

Run: `uv run pytest -v`
Expected: everything green (integration test skips without the env var).

Optionally (network): `EDGECAST_LIVE_TESTS=1 uv run pytest tests/test_live_integration.py -v` — expected PASS.

---

### Task 5: Frontend — tokens, directional colors, threshold-first cards

**Files:**
- Modify: `web/src/theme.css`, `web/src/types.ts`, `web/src/api.ts`, `web/src/components/MarketCard.tsx`
- Modify: `web/src/components/MarketCard.test.tsx`, `web/src/api.test.ts`

**Interfaces:**
- Consumes: schema 1.2 (`market.threshold?` / `threshold_low?` / `threshold_high?`), `/api/live` contract.
- Produces: tokens `--color-up #2ecc71` / `--color-down #ff4d4d` (orange token removed); `MarketMeta` with the three optional threshold fields; `LiveInfo`/`AnalysisOutput.live?` types; `api.analyzeLive(edgeThreshold)` + `class UpstreamError`; MarketCard with location-first header and green/red flags. Test hooks unchanged (`edge-flag`, `edge-agreement`) plus `data-testid="threshold"`.

- [ ] **Step 1: Update tests (failing first)**

`web/src/components/MarketCard.test.tsx` — replace the two flag tests and add header/threshold tests:

```tsx
it("flags model_higher in up-green with arrow and signed value", () => {
  render(<MarketCard result={base} />);
  const flag = screen.getByTestId("edge-flag");
  expect(flag).toHaveTextContent("▲ +0.08 MODEL HIGHER");
  expect(flag.className).toContain("text-up");
  expect(flag.style.textShadow).toContain("46, 204, 113");
});

it("flags market_higher in down-red with down arrow", () => {
  render(
    <MarketCard
      result={{
        ...base,
        edge: { value: -0.15, log_odds_diff: -0.6, flag: "market_higher" },
      }}
    />,
  );
  const flag = screen.getByTestId("edge-flag");
  expect(flag).toHaveTextContent("▼ -0.15 MARKET HIGHER");
  expect(flag.className).toContain("text-down");
  expect(flag.style.textShadow).toContain("255, 77, 77");
});

it("shows location-first header and big threshold", () => {
  render(<MarketCard result={base} />);
  expect(screen.getByText("NYC · HIGH TEMP")).toBeInTheDocument();
  expect(screen.getByTestId("threshold")).toHaveTextContent("≥ 90°F");
});

it("renders between markets as a range", () => {
  render(
    <MarketCard
      result={{
        ...base,
        market: {
          ...base.market,
          comparator: "between",
          threshold: undefined,
          threshold_low: 88,
          threshold_high: 89,
        },
      }}
    />,
  );
  expect(screen.getByTestId("threshold")).toHaveTextContent("88–89°F");
});
```

`web/src/api.test.ts` — add:

```tsx
import { analyzeLive, UpstreamError } from "./api";

it("analyzeLive hits /api/live with the threshold", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(fakeResponse(200, { results: [], aggregate: {} }));
  vi.stubGlobal("fetch", fetchMock);
  await analyzeLive(0.07);
  expect(fetchMock).toHaveBeenCalledWith("/api/live?edge_threshold=0.07");
});

it("analyzeLive throws UpstreamError on 502", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(fakeResponse(502, { detail: "no live data available: NYC: timeout" })),
  );
  await expect(analyzeLive(0.05)).rejects.toThrow(UpstreamError);
  await expect(analyzeLive(0.05)).rejects.toThrow("NYC");
});
```

Run in `web/`: `npm test` — expected: new tests FAIL.

- [ ] **Step 2: Implement**

`web/src/theme.css` — in `@theme`, replace `--color-signal: #ff6a00;` with:

```css
  --color-up: #2ecc71;
  --color-down: #ff4d4d;
```

`web/src/types.ts` — `MarketMeta` threshold fields become optional and gain bounds; add live types; extend `AnalysisOutput`:

```ts
export interface MarketMeta {
  question: string;
  location: string;
  variable: string;
  comparator: string;
  threshold?: number;
  threshold_low?: number;
  threshold_high?: number;
  event_date: string;
}

export interface CityInfo {
  name: string;
  station: string;
  series: string;
}

export interface LiveInfo {
  fetched_at: string;
  cities_ok: string[];
  cities_failed: { city: string; reason: string }[];
  quotes_age_seconds: number;
  ensembles_age_seconds: number;
  cities: Record<string, CityInfo>;
}
```

and on `AnalysisOutput`: `live?: LiveInfo;`.

`web/src/api.ts` — add:

```ts
export class UpstreamError extends Error {}

export async function analyzeLive(edgeThreshold: number): Promise<AnalysisOutput> {
  const res = await fetch(`/api/live?edge_threshold=${edgeThreshold}`);
  if (res.status === 502) {
    const body = (await res.json()) as { detail?: unknown };
    throw new UpstreamError(typeof body.detail === "string" ? body.detail : "upstream failure");
  }
  if (res.status === 422) {
    const body = (await res.json()) as { detail?: unknown };
    throw new InputError(typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail));
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as AnalysisOutput;
}
```

`web/src/components/MarketCard.tsx` — replace the header block and flag block; add helpers above the component:

```tsx
const VARIABLE_LABEL: Record<string, string> = { high_temp_f: "HIGH TEMP" };

const COMPARATOR_SYMBOL: Record<string, string> = {
  ">=": "≥", ">": ">", "<=": "≤", "<": "<",
};

function formatThreshold(market: ScenarioResult["market"]): string {
  if (market.comparator === "between") {
    return `${market.threshold_low}–${market.threshold_high}°F`;
  }
  return `${COMPARATOR_SYMBOL[market.comparator] ?? market.comparator} ${market.threshold}°F`;
}
```

Header (replaces the current `<header>…</header>`):

```tsx
      <header className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-bold tracking-[0.25em]">
            {market.location} · {VARIABLE_LABEL[market.variable] ?? market.variable.toUpperCase()}
          </span>
          <span className="shrink-0 text-xs text-text-3">
            {formatDate(market.event_date)}
          </span>
        </div>
        <div className="text-2xl font-medium tabular-nums" data-testid="threshold">
          {formatThreshold(market)}
        </div>
        <p className="text-[10px] text-text-3">{market.question}</p>
      </header>
```

Flag block (replaces the current orange `<p …data-testid="edge-flag">`):

```tsx
        <p
          className={`text-sm ${edge.flag === "model_higher" ? "text-up" : "text-down"}`}
          style={{
            textShadow:
              edge.flag === "model_higher"
                ? "0 0 8px rgba(46, 204, 113, 0.45)"
                : "0 0 8px rgba(255, 77, 77, 0.45)",
          }}
          data-testid="edge-flag"
        >
          {edge.value >= 0 ? "▲ +" : "▼ "}
          {edge.value.toFixed(2)} {FLAG_TEXT[edge.flag]}
        </p>
```

Remove the now-unused `<h3>` question header styling; keep everything else (bars, clamp note, settlement footer) unchanged.

- [ ] **Step 3: Verify**

Run in `web/`: `npm test` then `npm run build`.
Expected: all pass; tsc clean. The old "shows question and formatted date" test still passes (question renders dim in the header).

---

### Task 6: Frontend — mode toggle, live refresh, grouping, upstream strips

**Files:**
- Modify: `web/src/components/CommandBar.tsx`, `web/src/App.tsx`
- Modify: `web/src/components/CommandBar.test.tsx`, `web/src/App.test.tsx`

**Interfaces:**
- Consumes: Task 5's `analyzeLive`, `UpstreamError`, `LiveInfo`.
- Produces: CommandBar props gain `mode: "live" | "fixtures"`, `onMode: (m) => void`, `updatedAt: string | null` (file picker renders only in fixtures mode). App: live default, 60s interval, city-grouped grid (`data-testid="city-group"` per section), strips `data-testid="upstream-strip"`.

- [ ] **Step 1: Update tests (failing first)**

`web/src/components/CommandBar.test.tsx` — add to `props`: `mode: "fixtures" as const, onMode: vi.fn(), updatedAt: null`. Add:

```tsx
it("toggles mode and hides file picker in live mode", () => {
  const onMode = vi.fn();
  const { rerender } = render(<CommandBar {...props} onMode={onMode} />);
  fireEvent.click(screen.getByRole("button", { name: "LIVE" }));
  expect(onMode).toHaveBeenCalledWith("live");
  rerender(<CommandBar {...props} mode="live" updatedAt="2026-07-03T12:04:31+00:00" />);
  expect(screen.queryByRole("button", { name: "a.json" })).toBeNull();
  expect(screen.getByText(/UPDATED/)).toBeInTheDocument();
});
```

`web/src/App.test.tsx` — rewrite around live-default. Replace the file with:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => vi.unstubAllGlobals());

function fakeResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function makeResult(id: string, location: string) {
  return {
    scenario_id: id,
    market: {
      question: `q ${id}`,
      location,
      variable: "high_temp_f",
      comparator: ">=",
      threshold: 90,
      event_date: "2026-07-03",
    },
    market_prob: 0.72,
    model_prob: 0.8,
    model_prob_raw: 0.8,
    n_members: 30,
    edge: { value: 0.08, log_odds_diff: 0.44, flag: "model_higher" },
    settlement: null,
  };
}

const LIVE_OUTPUT = {
  schema_version: "1.2",
  generated_at: "2026-07-03T12:04:31+00:00",
  results: [makeResult("a", "NYC"), makeResult("b", "CHI"), makeResult("c", "NYC")],
  aggregate: {
    n_scenarios: 3, n_settled: 0,
    mean_brier_market: null, mean_brier_model: null, better_calibrated: null,
  },
  live: {
    fetched_at: "2026-07-03T12:04:31+00:00",
    cities_ok: ["NYC", "CHI"],
    cities_failed: [],
    quotes_age_seconds: 3,
    ensembles_age_seconds: 90,
    cities: {
      NYC: { name: "New York", station: "Central Park", series: "KXHIGHNY" },
      CHI: { name: "Chicago", station: "Midway", series: "KXHIGHCHI" },
    },
  },
};

function stubLive(liveBody: unknown, status = 200) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith("/api/live")) return fakeResponse(status, liveBody);
    if (url === "/api/scenario-files") return fakeResponse(200, { files: ["sample.json"] });
    return fakeResponse(200, { ...LIVE_OUTPUT, live: undefined, results: [makeResult("f", "NYC")] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("boots in live mode, groups by city, shows updated stamp", async () => {
  stubLive(LIVE_OUTPUT);
  render(<App />);
  const groups = await screen.findAllByTestId("city-group");
  expect(groups).toHaveLength(2);
  expect(screen.getByText(/CHICAGO — MIDWAY/i)).toBeInTheDocument();
  expect(screen.getByText(/UPDATED/)).toBeInTheDocument();
});

it("shows partial upstream strip", async () => {
  stubLive({
    ...LIVE_OUTPUT,
    live: {
      ...LIVE_OUTPUT.live,
      cities_failed: [{ city: "MIA", reason: "kalshi: HTTP 503" }],
    },
  });
  render(<App />);
  expect(await screen.findByTestId("upstream-strip")).toHaveTextContent("UPSTREAM PARTIAL — MIA");
});

it("shows unreachable strip on 502 and keeps prior view alive", async () => {
  stubLive({ detail: "no live data available: NYC: timeout" }, 502);
  render(<App />);
  expect(await screen.findByTestId("upstream-strip")).toHaveTextContent("UPSTREAM UNREACHABLE");
});

it("switching to FIXTURES fetches files and analyzes", async () => {
  stubLive(LIVE_OUTPUT);
  render(<App />);
  await screen.findAllByTestId("city-group");
  fireEvent.click(screen.getByRole("button", { name: "FIXTURES" }));
  expect(await screen.findByRole("button", { name: "sample.json" })).toBeInTheDocument();
});

it("shows SIGNAL LOST when the server itself is unreachable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
  render(<App />);
  expect(await screen.findByText("SIGNAL LOST")).toBeInTheDocument();
});
```

Run in `web/`: `npm test` — expected: CommandBar/App tests FAIL.

- [ ] **Step 2: Implement**

`web/src/components/CommandBar.tsx` — extend props and header. Full new props interface and additions:

```tsx
interface CommandBarProps {
  mode: "live" | "fixtures";
  onMode: (m: "live" | "fixtures") => void;
  updatedAt: string | null;
  files: string[];
  selected: string | null;
  onSelect: (f: string) => void;
  threshold: number;
  onThreshold: (t: number) => void;
  onAnalyze: () => void;
  busy: boolean;
}
```

After the `EDGECAST` wordmark span, insert the mode toggle; wrap the existing file-picker `<nav>` in `{mode === "fixtures" && (…)}`; add the stamp before the busy indicator:

```tsx
      <nav className="flex gap-1" aria-label="mode">
        {(["live", "fixtures"] as const).map((m) => (
          <button
            key={m}
            onClick={() => onMode(m)}
            className={`border px-2 py-1 text-xs tracking-widest ${
              m === mode ? "border-text-2 text-text-1" : "border-hairline text-text-3"
            }`}
          >
            {m.toUpperCase()}
          </button>
        ))}
      </nav>
```

```tsx
        {updatedAt !== null && (
          <span className="text-xs text-text-3 tabular-nums">
            UPDATED {new Date(updatedAt).toLocaleTimeString("en-US", { hour12: false })}
          </span>
        )}
```

`web/src/App.tsx` — full replacement:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { analyze, analyzeLive, getScenarioFiles, InputError, UpstreamError } from "./api";
import type { AnalysisOutput, ScenarioResult } from "./types";
import { AggregateStrip } from "./components/AggregateStrip";
import { CommandBar } from "./components/CommandBar";
import { MarketCard } from "./components/MarketCard";

type Mode = "live" | "fixtures";
const REFRESH_MS = 60_000;

function groupByLocation(results: ScenarioResult[]): [string, ScenarioResult[]][] {
  const groups = new Map<string, ScenarioResult[]>();
  for (const r of results) {
    const list = groups.get(r.market.location) ?? [];
    list.push(r);
    groups.set(r.market.location, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export default function App() {
  const [mode, setMode] = useState<Mode>("live");
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.05);
  const [output, setOutput] = useState<AnalysisOutput | null>(null);
  const [offline, setOffline] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [upstreamError, setUpstreamError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const runLive = useCallback(async (th: number) => {
    setBusy(true);
    setInputError(null);
    try {
      setOutput(await analyzeLive(th));
      setUpstreamError(null);
      setOffline(false);
    } catch (e) {
      if (e instanceof UpstreamError) setUpstreamError(e.message);
      else if (e instanceof InputError) setInputError(e.message);
      else setOffline(true);
    } finally {
      setBusy(false);
    }
  }, []);

  const runFixture = useCallback(async (file: string, th: number) => {
    setBusy(true);
    setInputError(null);
    setUpstreamError(null);
    try {
      setOutput(await analyze(file, th));
      setOffline(false);
    } catch (e) {
      if (e instanceof InputError) setInputError(e.message);
      else setOffline(true);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
    if (mode === "live") {
      void runLive(threshold);
      timer.current = setInterval(() => void runLive(threshold), REFRESH_MS);
      return () => {
        if (timer.current !== null) clearInterval(timer.current);
      };
    }
    getScenarioFiles()
      .then((fs) => {
        setFiles(fs);
        setSelected((cur) => cur ?? fs[0] ?? null);
      })
      .catch(() => setOffline(true));
  }, [mode, threshold, runLive]);

  useEffect(() => {
    if (mode === "fixtures" && selected !== null) void runFixture(selected, threshold);
  }, [mode, selected, threshold, runFixture]);

  if (offline && output === null) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3">
        <h1 className="text-4xl font-bold tracking-[0.3em]">SIGNAL LOST</h1>
        <p className="font-sans text-sm text-text-3">
          is the server running? → uv run edgecast serve
        </p>
      </main>
    );
  }

  const groups = output !== null ? groupByLocation(output.results) : [];
  const cities = output?.live?.cities ?? {};

  return (
    <main className="min-h-screen">
      <CommandBar
        mode={mode}
        onMode={setMode}
        updatedAt={output?.live?.fetched_at ?? null}
        files={files}
        selected={selected}
        onSelect={setSelected}
        threshold={threshold}
        onThreshold={setThreshold}
        onAnalyze={() =>
          mode === "live"
            ? void runLive(threshold)
            : selected !== null && void runFixture(selected, threshold)
        }
        busy={busy}
      />
      {upstreamError !== null && (
        <p className="border-b border-hairline px-6 py-2 text-xs text-text-2" data-testid="upstream-strip">
          <span className="font-bold text-text-1">UPSTREAM UNREACHABLE</span> {upstreamError} — retrying in 60s
        </p>
      )}
      {upstreamError === null && (output?.live?.cities_failed.length ?? 0) > 0 && (
        <p className="border-b border-hairline px-6 py-2 text-xs text-text-2" data-testid="upstream-strip">
          <span className="font-bold text-text-1">UPSTREAM PARTIAL</span> —{" "}
          {output!.live!.cities_failed.map((f) => `${f.city} (${f.reason})`).join(" · ")}
        </p>
      )}
      {inputError !== null && (
        <p className="border-b border-hairline px-6 py-2 text-xs text-text-2">
          <span className="font-bold text-text-1">INPUT ERROR</span> {inputError}
        </p>
      )}
      {output !== null && (
        <div className={`transition-opacity ${busy ? "opacity-40" : ""}`}>
          <AggregateStrip aggregate={output.aggregate} />
          {groups.map(([location, results]) => (
            <section key={location} className="px-6 pt-5" data-testid="city-group">
              <h2 className="border-b border-hairline pb-1 text-sm font-bold tracking-[0.25em]">
                {(cities[location]?.name ?? location).toUpperCase()}
                {cities[location] && (
                  <span className="ml-3 font-normal tracking-[0.15em] text-text-3">
                    — {cities[location].station.toUpperCase()} · {cities[location].series}
                  </span>
                )}
              </h2>
              <div className="grid grid-cols-1 gap-4 py-4 md:grid-cols-2 xl:grid-cols-3">
                {results
                  .slice()
                  .sort((a, b) => (a.market.threshold ?? a.market.threshold_low ?? 0) - (b.market.threshold ?? b.market.threshold_low ?? 0))
                  .map((r) => (
                    <MarketCard key={r.scenario_id} result={r} />
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Verify**

Run in `web/`: `npm test` then `npm run build`.
Expected: full suite green, build clean.

---

### Task 7: Integration verify + anti-slop audit

**Files:** none (verification only).

- [ ] **Step 1: Full suites**

`uv run pytest -v` (root) and `npm test` (web/). Expected: green.

- [ ] **Step 2: Real-network integration**

`EDGECAST_LIVE_TESTS=1 uv run pytest tests/test_live_integration.py -v` — expected PASS (requires internet; if Kalshi has no open temp markets at run time, investigate before declaring failure).

- [ ] **Step 3: Serve and verify live behavior**

`npm run build` (web/), then `uv run edgecast serve --port 8000` in background:
- `curl -s "http://127.0.0.1:8000/api/live" | python3 -m json.tool | head -40` → results with real tickers, `live.cities_ok` non-empty.
- Open the browser: LIVE default, city groups with prominent headers, threshold-first cards, green/red flags, `UPDATED` stamp; toggle FIXTURES → sample file renders with new styling; threshold stepper live-updates.
- Kill the network path (stop server) and reload → `SIGNAL LOST`.

- [ ] **Step 4: Anti-slop audit (amended contract)**

- `grep -rn "signal\|FF6A00\|ff6a00" web/src/` → no matches (orange fully retired).
- `grep -rln "2ecc71\|ff4d4d\|46, 204, 113\|255, 77, 77\|text-up\|text-down" web/src/` → only `theme.css` and `MarketCard.tsx`.
- `grep -rn "gradient\|backdrop-blur\|box-shadow\|shadow-\|rounded" web/src/` → nothing beyond the two sanctioned textShadow glows in `MarketCard.tsx`.
- No emoji; no spinners/shimmer; mono numerals; uppercase letterspaced labels; no new dependencies in `web/package.json`.
- Record outcome in the progress ledger.

---

## Model delegation notes (per global CLAUDE.md)

- Tasks 1–4 → gpt-5.5 `codex exec` xhigh, one dispatch per task with its brief; Tasks 2–3 require network for fixture recording (sandbox has network enabled).
- Tasks 5–7 → fable-5 inline. Reviews after every task: fable-5. Commits: user only.
