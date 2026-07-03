# EdgeCast v3 — Verification Store + Ladder Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A SQLite verification store covering the last ~30 days (official ACIS observed highs settle past Kalshi markets; GEFS hindcast + final market prices get Brier + hit-rate scored), seeded by `edgecast backfill`, topped up on live refresh, surfaced in a rebuilt UI: one ladder card per city and a verification-driven aggregate strip.

**Architecture:** New `live/acis.py` (observations), additions to `live/kalshi.py`/`live/openmeteo.py` (past events, past ensembles, `model` param), new `store.py` (sqlite3, rows keyed `(market_id, model)` for v4 multi-model) and `verify.py` (settle+score via the existing pipeline), a `backfill` CLI subcommand, `/api/live` `verification` block. Frontend: `CityCard` ladder replaces `MarketCard`/`ProbBar`; `AggregateStrip` gains a verification variant.

**Tech Stack:** existing; sqlite3 is stdlib. DB at `data/edgecast.db` (gitignored).

**Spec:** `docs/superpowers/specs/2026-07-03-verification-ladder-design.md` — binding, incl. the amended anti-slop contract.

## Global Constraints

- **No agent commits.** User commits manually. Never `git commit`/`git push`; no `Co-Authored-By`. Tasks end when tests pass.
- httpx/fastapi imports only in `server.py` and `live/`; `store.py`/`verify.py` may import from `live/` but not fastapi. sqlite3 (stdlib) allowed in `store.py` only.
- ACIS: POST `https://data.rcc-acis.org/StnData`, JSON, no auth, 10s timeout. api.weather.gov calls (verification steps only) send `User-Agent: EdgeCast (dev)`.
- Verification rows keyed `(market_id, model)`; model string `"gfs_seamless"` in v3.
- Hit rate per side: group rows by (city, event_date); the side's max-probability row "hits" iff its outcome == 1; rate = hits / groups.
- Unit tests never touch the network (recorded fixtures in `tests/fixtures_live/`, tmp-path DBs). Real network only behind `EDGECAST_LIVE_TESTS=1`.
- Anti-slop contract as amended: green `#2ECC71`/red `#FF4D4D` only in edge flags + red additionally in the Kalshi-mismatch warning line; `⚠`/`✓`/`●` are text glyphs, not emoji; all other v1/v2 items stand.
- Python from repo root (`uv run pytest`); frontend in `web/`.
- Model split: Tasks 1–5 → gpt-5.5 codex exec xhigh; Tasks 6–8 → fable-5 inline.

---

### Task 1: ACIS client + registry station ids (records real fixture; CLI cross-check)

**Files:**
- Modify: `src/edgecast/live/stations.py`
- Create: `src/edgecast/live/acis.py`
- Create: `tests/fixtures_live/acis_stndata.json` (recorded)
- Test: `tests/test_live_acis.py`
- Modify: `.gitignore` (add `data/`)

**Interfaces:**
- Consumes: `Station` dataclass, `TTLCache`.
- Produces: `Station.acis_sid: str`; `acis.AcisUnavailable(Exception)`; `acis.fetch_observed_highs(acis_sid: str, start_date: str, end_date: str, client: httpx.Client) -> dict[str, float]` (ISO date → °F; missing days omitted).

- [ ] **Step 1: Record fixture + verify station ids + CLI cross-check (network)**

```bash
curl -s -X POST https://data.rcc-acis.org/StnData -H 'Content-Type: application/json' \
  -d '{"sid":"KATT","sdate":"2026-06-03","edate":"2026-07-02","elems":[{"name":"maxt"}]}' \
  -o tests/fixtures_live/acis_stndata.json
python3 -c "import json; d=json.load(open('tests/fixtures_live/acis_stndata.json')); print(d.get('meta',{}).get('name')); print(len(d['data']), 'days'); print(d['data'][-3:])"
```

Confirm `meta.name` names Camp Mabry (NOT Bergstrom). Then for EACH of the 7 sids (`KNYC KMDW KMIA KATT KDEN KPHL KLAX`) fetch one recent day the same way and confirm a numeric maxt exists; report any sid that errors or looks wrong (adjust per ACIS station lookup if needed, reporting the change).

**CLI cross-check (one city):** fetch the latest CLI bulletin for Austin Camp Mabry (`curl -s -A "EdgeCast (dev)" https://api.weather.gov/products/types/CLI/locations/ATT` → newest product `@id` → `productText`), read its MAXIMUM for a specific date, and confirm ACIS `maxt` for `KATT` on that date equals it. Record both numbers in your report. If ATT yields nothing, cross-check NYC instead and say so.

- [ ] **Step 2: Write the failing tests**

`tests/test_live_acis.py`:

```python
import json
from pathlib import Path

import pytest

from edgecast.live.acis import AcisUnavailable, parse_stndata
from edgecast.live.stations import STATIONS

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures_live" / "acis_stndata.json").read_text()
)


def test_stations_have_acis_sids():
    assert STATIONS["KXHIGHAUS"].acis_sid == "KATT"  # Camp Mabry, not Bergstrom
    assert STATIONS["KXHIGHNY"].acis_sid == "KNYC"
    assert all(s.acis_sid.startswith("K") for s in STATIONS.values())


def test_parse_fixture_range():
    highs = parse_stndata(FIXTURE)
    assert len(highs) >= 25
    for d, v in highs.items():
        assert len(d) == 10 and d[4] == "-"
        assert -60.0 < v < 130.0


def test_parse_skips_missing():
    payload = {"data": [["2026-07-01", "96"], ["2026-07-02", "M"], ["2026-07-03", "101"]]}
    assert parse_stndata(payload) == {"2026-07-01": 96.0, "2026-07-03": 101.0}


def test_parse_error_payload_raises():
    with pytest.raises(AcisUnavailable, match="no data"):
        parse_stndata({"error": "no data available"})
```

Run: `uv run pytest tests/test_live_acis.py -v` — expected FAIL (no module / no acis_sid).

- [ ] **Step 3: Implement**

`src/edgecast/live/stations.py` — `Station` gains `acis_sid: str` (last field); registry entries append their sid: NYC→`KNYC`, CHI→`KMDW`, MIA→`KMIA`, AUS→`KATT`, DEN→`KDEN`, PHL→`KPHL`, LAX→`KLAX` (as verified in Step 1).

`src/edgecast/live/acis.py`:

```python
"""ACIS client: official NWS/NOAA station daily maxima (settlement truth)."""

import httpx

BASE_URL = "https://data.rcc-acis.org/StnData"
TIMEOUT = 10.0


class AcisUnavailable(Exception):
    """ACIS could not provide observations."""


def parse_stndata(payload: dict) -> dict[str, float]:
    if "error" in payload:
        raise AcisUnavailable(str(payload["error"]))
    highs: dict[str, float] = {}
    for entry in payload.get("data", []):
        date_str, value = entry[0], entry[1]
        try:
            highs[date_str] = float(value)
        except (TypeError, ValueError):
            continue  # "M" (missing) and other non-numeric markers are skipped
    return highs


def fetch_observed_highs(
    acis_sid: str, start_date: str, end_date: str, client: httpx.Client
) -> dict[str, float]:
    try:
        resp = client.post(
            BASE_URL,
            json={
                "sid": acis_sid,
                "sdate": start_date,
                "edate": end_date,
                "elems": [{"name": "maxt"}],
            },
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        return parse_stndata(resp.json())
    except httpx.HTTPError as e:
        raise AcisUnavailable(f"{type(e).__name__}: {e}") from e
```

`.gitignore` — append `data/`.

- [ ] **Step 4: Verify pass**

`uv run pytest tests/test_live_acis.py -v` then full suite — all green.

---

### Task 2: Kalshi past events + Open-Meteo model/past_days

**Files:**
- Modify: `src/edgecast/live/kalshi.py`, `src/edgecast/live/openmeteo.py`
- Test: append to `tests/test_live_kalshi.py`, `tests/test_live_openmeteo.py`

**Interfaces:**
- Consumes: existing clients.
- Produces:
  - `kalshi.event_ticker_for(series: str, d: datetime.date) -> str` (`KXHIGHNY-26JUL02`).
  - `kalshi.fetch_event_markets(event_ticker: str, client) -> list[dict]` (no status filter, cursor-paginated like `fetch_markets`).
  - `kalshi.to_result(market: dict) -> str | None` (`"yes"`/`"no"`, else None).
  - `openmeteo.fetch_ensemble_high(..., model: str = "gfs_seamless", forecast_days: int = 3)` — source becomes `f"open-meteo {model}"`.
  - `openmeteo.fetch_ensemble_past_highs(lat, lon, dates: list[str], tz, client, model="gfs_seamless") -> dict[str, tuple[float, ...]]` — one call with computed `past_days`, reduced per date via `daily_highs`; dates absent from the payload are omitted.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_live_kalshi.py`:

```python
from datetime import date

from edgecast.live.kalshi import event_ticker_for, to_result


def test_event_ticker_format():
    assert event_ticker_for("KXHIGHNY", date(2026, 7, 2)) == "KXHIGHNY-26JUL02"
    assert event_ticker_for("KXHIGHCHI", date(2026, 12, 9)) == "KXHIGHCHI-26DEC09"


def test_to_result():
    assert to_result({"result": "yes"}) == "yes"
    assert to_result({"result": "no"}) == "no"
    assert to_result({"result": ""}) is None
    assert to_result({}) is None
```

Append to `tests/test_live_openmeteo.py`:

```python
from edgecast.live.openmeteo import past_days_for, reduce_past_highs


def test_reduce_past_highs_per_date():
    hourly = {
        "time": ["2026-07-01T00:00", "2026-07-01T12:00", "2026-07-02T12:00"],
        "temperature_2m": [70.0, 91.5, 88.0],
        "temperature_2m_member01": [68.0, 89.0, 90.5],
    }
    out = reduce_past_highs({"hourly": hourly}, ["2026-07-01", "2026-07-02", "2026-07-09"])
    assert out["2026-07-01"] == (91.5, 89.0)
    assert out["2026-07-02"] == (88.0, 90.5)
    assert "2026-07-09" not in out


def test_past_days_for_spans_earliest_date():
    from datetime import date

    n = past_days_for(["2026-07-01", "2026-06-25"], today=date(2026, 7, 3))
    assert n == 9  # (7/3 - 6/25) + 1, clamped to [1, 92]
    assert past_days_for(["2026-07-02"], today=date(2026, 7, 3)) == 2
```

Run both files — expected FAIL (missing names).

- [ ] **Step 2: Implement**

`src/edgecast/live/kalshi.py` — add:

```python
_MONTH_ABBR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
               "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def event_ticker_for(series: str, d: date) -> str:
    return f"{series}-{d.year % 100:02d}{_MONTH_ABBR[d.month - 1]}{d.day:02d}"


def to_result(market: dict) -> str | None:
    result = market.get("result")
    return result if result in ("yes", "no") else None


def fetch_event_markets(event_ticker: str, client: httpx.Client) -> list[dict]:
    markets: list[dict] = []
    cursor: str | None = None
    while True:
        params: dict = {"event_ticker": event_ticker, "limit": 100}
        if cursor:
            params["cursor"] = cursor
        resp = client.get(f"{BASE_URL}/markets", params=params, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        markets.extend(data.get("markets", []))
        cursor = data.get("cursor")
        if not cursor:
            return markets
```

`src/edgecast/live/openmeteo.py` — extend `fetch_ensemble_high` with `model: str = "gfs_seamless"`, `forecast_days: int = 3` parameters (used in params; source string becomes `f"open-meteo {model}"`), and add:

```python
def past_days_for(dates: list[str], today: date | None = None) -> int:
    today = today or date.today()
    earliest = min(date.fromisoformat(d) for d in dates)
    return max(1, min(92, (today - earliest).days + 1))


def reduce_past_highs(payload: dict, dates: list[str]) -> dict[str, tuple[float, ...]]:
    out: dict[str, tuple[float, ...]] = {}
    for d in dates:
        try:
            out[d] = daily_highs(payload, d)
        except ValueError:
            continue
    return out


def fetch_ensemble_past_highs(
    lat: float, lon: float, dates: list[str], tz: str,
    client: httpx.Client, model: str = "gfs_seamless",
) -> dict[str, tuple[float, ...]]:
    resp = client.get(
        BASE_URL,
        params={
            "latitude": lat, "longitude": lon,
            "hourly": "temperature_2m", "models": model,
            "temperature_unit": "fahrenheit", "timezone": tz,
            "past_days": past_days_for(dates), "forecast_days": 1,
        },
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return reduce_past_highs(resp.json(), dates)
```

(`from datetime import date` joins the existing datetime imports.)

- [ ] **Step 3: Verify pass** — both test files, then full suite.

---

### Task 3: Verification store (`store.py`)

**Files:**
- Create: `src/edgecast/store.py`
- Test: `tests/test_store.py`

**Interfaces:**
- Consumes: nothing from live/ (pure sqlite + dataclasses).
- Produces:

```python
@dataclass(frozen=True) class VerificationRow:  # every schema column as a field
@dataclass(frozen=True) class SideStats: mean_brier: float; hit_rate: float
@dataclass(frozen=True) class WindowStats:
    n_markets: int; n_days: int; market: SideStats; model: SideStats
    better_calibrated: str  # "market" | "model" | "tie"

class Store:
    def __init__(self, path: str | Path): ...   # creates parent dir + schema
    def upsert(self, rows: list[VerificationRow]) -> None: ...   # INSERT OR REPLACE
    def covered(self, model: str, dates: list[str]) -> set[tuple[str, str]]: ...  # (city, date)
    def dates_missing(self, model: str, dates: list[str]) -> list[str]: ...  # dates with zero rows, newest first
    def window_stats(self, model: str, since_date: str) -> WindowStats | None: ...  # None if no rows
    def city_stats(self, model: str, since_date: str) -> dict[str, WindowStats]: ...
    def rows_for_date(self, model: str, event_date: str) -> list[VerificationRow]: ...
    def mismatches(self, model: str, since_date: str) -> list[VerificationRow]: ...  # kalshi_result set and inconsistent with outcome
def bucket_label(comparator: str, threshold, threshold_low, threshold_high) -> str:
    # ">=90" -> "90° or above", "<=93" -> "93° or below", between 88/89 -> "88–89°"
```

Schema exactly as the spec's `CREATE TABLE verifications` block (all columns, PK `(market_id, model)`, date index).

- [ ] **Step 1: Write the failing tests**

`tests/test_store.py`:

```python
import pytest

from edgecast.store import Store, VerificationRow, bucket_label


def make_row(**kw) -> VerificationRow:
    base = dict(
        market_id="M1", model="gfs_seamless", series="KXHIGHAUS", city="AUS",
        event_date="2026-07-02", comparator="between",
        threshold=None, threshold_low=96.0, threshold_high=97.0,
        question="q", market_prob=0.85, model_prob=0.71, model_prob_raw=0.71,
        n_members=31, observed_high=96.0, outcome=1, kalshi_result="yes",
        brier_market=0.0225, brier_model=0.0841,
        observed_source="ACIS KATT", model_source="open-meteo gfs_seamless (short-lead)",
        verified_at="2026-07-03T12:00:00+00:00",
    )
    base.update(kw)
    return VerificationRow(**base)


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "data" / "test.db")


def test_upsert_idempotent(store):
    store.upsert([make_row()])
    store.upsert([make_row(market_prob=0.9)])  # same PK, replaces
    rows = store.rows_for_date("gfs_seamless", "2026-07-02")
    assert len(rows) == 1
    assert rows[0].market_prob == 0.9


def test_covered_and_missing(store):
    store.upsert([make_row()])
    assert store.covered("gfs_seamless", ["2026-07-02"]) == {("AUS", "2026-07-02")}
    assert store.dates_missing("gfs_seamless", ["2026-07-01", "2026-07-02"]) == ["2026-07-01"]


def test_window_stats_and_hit_rate(store):
    # AUS 7/2: market favorite hits (row A outcome 1, market_prob max), model favorite misses
    store.upsert([
        make_row(market_id="A", market_prob=0.85, model_prob=0.30, outcome=1,
                 brier_market=0.0225, brier_model=0.49),
        make_row(market_id="B", market_prob=0.10, model_prob=0.60, outcome=0,
                 threshold_low=98.0, threshold_high=99.0,
                 brier_market=0.01, brier_model=0.36),
    ])
    stats = store.window_stats("gfs_seamless", since_date="2026-07-01")
    assert stats.n_markets == 2 and stats.n_days == 1
    assert stats.market.mean_brier == pytest.approx((0.0225 + 0.01) / 2)
    assert stats.market.hit_rate == 1.0   # market favorite (A) hit
    assert stats.model.hit_rate == 0.0    # model favorite (B) missed
    assert stats.better_calibrated == "market"


def test_window_stats_none_when_empty(store):
    assert store.window_stats("gfs_seamless", "2026-01-01") is None


def test_since_date_excludes_older(store):
    store.upsert([make_row(event_date="2026-06-01")])
    assert store.window_stats("gfs_seamless", "2026-07-01") is None


def test_city_stats_grouping(store):
    store.upsert([make_row(), make_row(market_id="N1", city="NYC", series="KXHIGHNY")])
    by_city = store.city_stats("gfs_seamless", "2026-07-01")
    assert set(by_city) == {"AUS", "NYC"}


def test_mismatches(store):
    store.upsert([
        make_row(),                                              # consistent
        make_row(market_id="X", kalshi_result="no", outcome=1),  # mismatch
        make_row(market_id="Y", kalshi_result=None),             # unknown, not a mismatch
    ])
    assert [r.market_id for r in store.mismatches("gfs_seamless", "2026-07-01")] == ["X"]


def test_bucket_label():
    assert bucket_label("between", None, 88.0, 89.0) == "88–89°"
    assert bucket_label(">=", 98.0, None, None) == "98° or above"
    assert bucket_label("<=", 93.0, None, None) == "93° or below"
    assert bucket_label(">", 95.0, None, None) == "above 95°"
    assert bucket_label("<", 60.0, None, None) == "below 60°"
```

Run — expected FAIL (no module).

- [ ] **Step 2: Implement**

`src/edgecast/store.py`:

```python
"""SQLite verification store: settled markets scored per model."""

import sqlite3
from dataclasses import dataclass, fields
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS verifications (
  market_id TEXT NOT NULL,
  model TEXT NOT NULL,
  series TEXT NOT NULL,
  city TEXT NOT NULL,
  event_date TEXT NOT NULL,
  comparator TEXT NOT NULL,
  threshold REAL, threshold_low REAL, threshold_high REAL,
  question TEXT NOT NULL,
  market_prob REAL NOT NULL,
  model_prob REAL NOT NULL,
  model_prob_raw REAL NOT NULL,
  n_members INTEGER NOT NULL,
  observed_high REAL NOT NULL,
  outcome INTEGER NOT NULL,
  kalshi_result TEXT,
  brier_market REAL NOT NULL,
  brier_model REAL NOT NULL,
  observed_source TEXT NOT NULL,
  model_source TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  PRIMARY KEY (market_id, model)
);
CREATE INDEX IF NOT EXISTS idx_verifications_date ON verifications(event_date);
"""


@dataclass(frozen=True)
class VerificationRow:
    market_id: str
    model: str
    series: str
    city: str
    event_date: str
    comparator: str
    threshold: float | None
    threshold_low: float | None
    threshold_high: float | None
    question: str
    market_prob: float
    model_prob: float
    model_prob_raw: float
    n_members: int
    observed_high: float
    outcome: int
    kalshi_result: str | None
    brier_market: float
    brier_model: float
    observed_source: str
    model_source: str
    verified_at: str


_COLS = [f.name for f in fields(VerificationRow)]


@dataclass(frozen=True)
class SideStats:
    mean_brier: float
    hit_rate: float


@dataclass(frozen=True)
class WindowStats:
    n_markets: int
    n_days: int
    market: SideStats
    model: SideStats
    better_calibrated: str


def bucket_label(
    comparator: str,
    threshold: float | None,
    threshold_low: float | None,
    threshold_high: float | None,
) -> str:
    def fmt(x: float) -> str:
        return f"{x:g}"

    if comparator == "between":
        return f"{fmt(threshold_low)}–{fmt(threshold_high)}°"
    if comparator == ">=":
        return f"{fmt(threshold)}° or above"
    if comparator == "<=":
        return f"{fmt(threshold)}° or below"
    if comparator == ">":
        return f"above {fmt(threshold)}°"
    return f"below {fmt(threshold)}°"


def _stats(rows: list[VerificationRow]) -> WindowStats:
    n = len(rows)
    groups: dict[tuple[str, str], list[VerificationRow]] = {}
    for r in rows:
        groups.setdefault((r.city, r.event_date), []).append(r)
    market_hits = sum(
        1 for g in groups.values() if max(g, key=lambda r: r.market_prob).outcome == 1
    )
    model_hits = sum(
        1 for g in groups.values() if max(g, key=lambda r: r.model_prob).outcome == 1
    )
    n_groups = len(groups)
    mean_bm = sum(r.brier_market for r in rows) / n
    mean_bd = sum(r.brier_model for r in rows) / n
    if mean_bd < mean_bm:
        better = "model"
    elif mean_bd > mean_bm:
        better = "market"
    else:
        better = "tie"
    return WindowStats(
        n_markets=n,
        n_days=len({r.event_date for r in rows}),
        market=SideStats(mean_brier=mean_bm, hit_rate=market_hits / n_groups),
        model=SideStats(mean_brier=mean_bd, hit_rate=model_hits / n_groups),
        better_calibrated=better,
    )


class Store:
    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._path)
        self._conn.executescript(_SCHEMA)

    def upsert(self, rows: list[VerificationRow]) -> None:
        placeholders = ", ".join("?" for _ in _COLS)
        with self._conn:
            self._conn.executemany(
                f"INSERT OR REPLACE INTO verifications ({', '.join(_COLS)}) "
                f"VALUES ({placeholders})",
                [tuple(getattr(r, c) for c in _COLS) for r in rows],
            )

    def _select(self, where: str, params: tuple) -> list[VerificationRow]:
        cur = self._conn.execute(
            f"SELECT {', '.join(_COLS)} FROM verifications WHERE {where}", params
        )
        return [VerificationRow(**dict(zip(_COLS, row))) for row in cur.fetchall()]

    def covered(self, model: str, dates: list[str]) -> set[tuple[str, str]]:
        if not dates:
            return set()
        marks = ", ".join("?" for _ in dates)
        cur = self._conn.execute(
            f"SELECT DISTINCT city, event_date FROM verifications "
            f"WHERE model = ? AND event_date IN ({marks})",
            (model, *dates),
        )
        return set(cur.fetchall())

    def dates_missing(self, model: str, dates: list[str]) -> list[str]:
        have = {d for _, d in self.covered(model, dates)}
        return sorted((d for d in dates if d not in have), reverse=True)

    def rows_for_date(self, model: str, event_date: str) -> list[VerificationRow]:
        return self._select("model = ? AND event_date = ?", (model, event_date))

    def window_stats(self, model: str, since_date: str) -> WindowStats | None:
        rows = self._select("model = ? AND event_date >= ?", (model, since_date))
        return _stats(rows) if rows else None

    def city_stats(self, model: str, since_date: str) -> dict[str, WindowStats]:
        rows = self._select("model = ? AND event_date >= ?", (model, since_date))
        by_city: dict[str, list[VerificationRow]] = {}
        for r in rows:
            by_city.setdefault(r.city, []).append(r)
        return {city: _stats(city_rows) for city, city_rows in by_city.items()}

    def mismatches(self, model: str, since_date: str) -> list[VerificationRow]:
        rows = self._select(
            "model = ? AND event_date >= ? AND kalshi_result IS NOT NULL",
            (model, since_date),
        )
        return [
            r for r in rows if (r.kalshi_result == "yes") != (r.outcome == 1)
        ]
```

- [ ] **Step 3: Verify pass** — `uv run pytest tests/test_store.py -v`, then full suite.

---

### Task 4: Verifier + `edgecast backfill`

**Files:**
- Create: `src/edgecast/verify.py`
- Modify: `src/edgecast/cli.py`
- Test: `tests/test_verify.py`, append to `tests/test_cli.py`

**Interfaces:**
- Consumes: Tasks 1–3 interfaces; `analyze`, `Scenario`, `Observation`, `STATIONS`, caches not used (verifier fetches directly; store is the cache).
- Produces:

```python
@dataclass class VerifyReport:
    dates_attempted: list[str]; n_markets_verified: int
    failures: list[dict]      # {"city", "date", "stage": "kalshi"|"acis"|"open-meteo", "reason"}
    mismatches: list[dict]    # {"market_id", "kalshi_result", "edgecast_outcome"}

verify.verify_days(dates: list[str], store: Store, kalshi_client, meteo_client, model: str = "gfs_seamless") -> VerifyReport
```

CLI: `edgecast backfill [--days 30] [--db data/edgecast.db]` — verifies yesterday back N days, prints summary, exit 0 (exit 1 only when every city×date failed).
`_serve` gains `--db data/edgecast.db --verify-days 30` passed into `create_app` (server wiring lands in Task 5; this task adds the flags and threads them through).

- [ ] **Step 1: Write the failing tests**

`tests/test_verify.py`:

```python
from datetime import date, datetime, timezone

import pytest

from edgecast.store import Store
from edgecast.verify import verify_days

# Minimal fake upstream data: one city (patched registry), one date, two markets.
FAKE_MARKETS = [
    {
        "ticker": "KXHIGHAUS-26JUL02-B96.5",
        "event_ticker": "KXHIGHAUS-26JUL02",
        "title": "96-97?",
        "strike_type": "between",
        "floor_strike": 96.0,
        "cap_strike": 97.0,
        "last_price_dollars": "0.8500",
        "result": "yes",
    },
    {
        "ticker": "KXHIGHAUS-26JUL02-T98",
        "event_ticker": "KXHIGHAUS-26JUL02",
        "title": ">=98?",
        "strike_type": "greater",
        "floor_strike": 97.5,
        "last_price_dollars": "0.1000",
        "result": "yes",  # deliberately wrong vs observed 96.0 -> mismatch
    },
]


@pytest.fixture
def patched(monkeypatch):
    import edgecast.verify as v
    from edgecast.live.stations import Station

    station = Station(
        "KXHIGHAUS", "AUS", "Austin", "Camp Mabry", 30.321, -97.760,
        "America/Chicago", "KATT",
    )
    monkeypatch.setattr(v, "STATIONS", {"KXHIGHAUS": station})
    monkeypatch.setattr(v, "fetch_event_markets", lambda et, c: FAKE_MARKETS)
    monkeypatch.setattr(
        v, "fetch_observed_highs", lambda sid, s, e, c: {"2026-07-02": 96.0}
    )
    monkeypatch.setattr(
        v,
        "fetch_ensemble_past_highs",
        lambda lat, lon, dates, tz, c, model="gfs_seamless": {
            "2026-07-02": tuple([96.2] * 20 + [95.0] * 10)
        },
    )
    return v


def test_verify_days_scores_and_stores(patched, tmp_path):
    store = Store(tmp_path / "v.db")
    report = verify_days(["2026-07-02"], store, None, None)
    assert report.n_markets_verified == 2
    rows = {r.market_id: r for r in store.rows_for_date("gfs_seamless", "2026-07-02")}
    between = rows["KXHIGHAUS-26JUL02-B96.5"]
    assert between.outcome == 1                      # 96.0 in [96, 97]
    assert between.observed_high == 96.0
    assert between.market_prob == 0.85
    assert between.brier_market == pytest.approx(0.0225)
    # model prob: 20/30 in range -> clamped stays 2/3
    assert between.model_prob == pytest.approx(20 / 30)
    assert between.observed_source == "ACIS KATT"
    # mismatch captured: T98 kalshi says yes, we compute 0
    assert report.mismatches == [
        {
            "market_id": "KXHIGHAUS-26JUL02-T98",
            "kalshi_result": "yes",
            "edgecast_outcome": 0,
        }
    ]


def test_verify_skips_covered(patched, tmp_path):
    store = Store(tmp_path / "v.db")
    verify_days(["2026-07-02"], store, None, None)
    calls = {"n": 0}
    patched.fetch_event_markets = None  # would crash if called again

    def counting(et, c):
        calls["n"] += 1
        return FAKE_MARKETS

    import edgecast.verify as v

    v.fetch_event_markets = counting
    report = verify_days(["2026-07-02"], store, None, None)
    assert calls["n"] == 0
    assert report.n_markets_verified == 0


def test_verify_isolates_stage_failures(patched, tmp_path, monkeypatch):
    import edgecast.verify as v

    monkeypatch.setattr(
        v, "fetch_observed_highs",
        lambda *a, **k: (_ for _ in ()).throw(v.AcisUnavailable("boom")),
    )
    store = Store(tmp_path / "v.db")
    report = verify_days(["2026-07-02"], store, None, None)
    assert report.n_markets_verified == 0
    assert report.failures == [
        {"city": "AUS", "date": "2026-07-02", "stage": "acis", "reason": "boom"}
    ]
```

Append to `tests/test_cli.py`:

```python
def test_backfill_invokes_verifier(monkeypatch, tmp_path):
    import edgecast.verify as verify_mod
    from edgecast.verify import VerifyReport

    seen = {}

    def fake_verify(dates, store, kc, mc, model="gfs_seamless"):
        seen["dates"] = dates
        return VerifyReport(
            dates_attempted=dates, n_markets_verified=7, failures=[], mismatches=[]
        )

    monkeypatch.setattr(verify_mod, "verify_days", fake_verify)
    rc = main(["backfill", "--days", "3", "--db", str(tmp_path / "b.db")])
    assert rc == 0
    assert len(seen["dates"]) == 3
```

Run — expected FAIL.

- [ ] **Step 2: Implement**

`src/edgecast/verify.py`:

```python
"""Verifier: settle and score past Kalshi markets against official observations."""

from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from edgecast.live.acis import AcisUnavailable, fetch_observed_highs
from edgecast.live.kalshi import (
    event_ticker_for,
    fetch_event_markets,
    to_quote,
    to_result,
)
from edgecast.live.openmeteo import fetch_ensemble_past_highs
from edgecast.live.stations import STATIONS
from edgecast.pipeline import analyze
from edgecast.store import Store, VerificationRow
from edgecast.types import EnsembleForecast, Observation, Scenario


@dataclass
class VerifyReport:
    dates_attempted: list[str]
    n_markets_verified: int = 0
    failures: list[dict] = field(default_factory=list)
    mismatches: list[dict] = field(default_factory=list)


def verify_days(
    dates: list[str],
    store: Store,
    kalshi_client,
    meteo_client,
    model: str = "gfs_seamless",
) -> VerifyReport:
    report = VerifyReport(dates_attempted=list(dates))
    covered = store.covered(model, list(dates))
    now = datetime.now(timezone.utc).isoformat()

    for series, st in STATIONS.items():
        todo = [d for d in dates if (st.city, d) not in covered]
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
            hindcasts = fetch_ensemble_past_highs(
                st.lat, st.lon, todo, st.tz, meteo_client, model=model
            )
        except Exception as e:  # noqa: BLE001 - upstream failure isolates this city
            report.failures.extend(
                {"city": st.city, "date": d, "stage": "open-meteo",
                 "reason": f"{type(e).__name__}: {e}"}
                for d in todo
            )
            continue

        for d in todo:
            if d not in observed:
                report.failures.append(
                    {"city": st.city, "date": d, "stage": "acis",
                     "reason": f"no observation for {d}"}
                )
                continue
            if d not in hindcasts:
                report.failures.append(
                    {"city": st.city, "date": d, "stage": "open-meteo",
                     "reason": f"no ensemble data for {d}"}
                )
                continue
            try:
                markets = fetch_event_markets(event_ticker_for(series, date.fromisoformat(d)), kalshi_client)
            except Exception as e:  # noqa: BLE001
                report.failures.append(
                    {"city": st.city, "date": d, "stage": "kalshi",
                     "reason": f"{type(e).__name__}: {e}"}
                )
                continue
            pairs = [
                (q, to_result(m))
                for m in markets
                if (q := to_quote(m, st.city)) is not None
            ]
            if not pairs:
                report.failures.append(
                    {"city": st.city, "date": d, "stage": "kalshi",
                     "reason": "no priced markets"}
                )
                continue
            forecast = EnsembleForecast(
                source=f"open-meteo {model} (short-lead)",
                issued_at=now,
                members=hindcasts[d],
            )
            scenarios = [
                Scenario(
                    scenario_id=q.market_id,
                    market=q,
                    forecast=forecast,
                    observation=Observation(observed[d]),
                )
                for q, _ in pairs
            ]
            results, _ = analyze(scenarios)
            kalshi_results = {q.market_id: r for q, r in pairs}
            rows = []
            for res in results:
                kr = kalshi_results.get(res.scenario_id)
                if kr is not None and (kr == "yes") != (res.settlement.outcome == 1):
                    report.mismatches.append(
                        {
                            "market_id": res.scenario_id,
                            "kalshi_result": kr,
                            "edgecast_outcome": res.settlement.outcome,
                        }
                    )
                rows.append(
                    VerificationRow(
                        market_id=res.scenario_id,
                        model=model,
                        series=series,
                        city=st.city,
                        event_date=d,
                        comparator=res.market.comparator,
                        threshold=res.market.threshold,
                        threshold_low=res.market.threshold_low,
                        threshold_high=res.market.threshold_high,
                        question=res.market.question,
                        market_prob=res.market_prob,
                        model_prob=res.model_prob,
                        model_prob_raw=res.model_prob_raw,
                        n_members=res.n_members,
                        observed_high=observed[d],
                        outcome=res.settlement.outcome,
                        kalshi_result=kr,
                        brier_market=res.settlement.brier_market,
                        brier_model=res.settlement.brier_model,
                        observed_source=f"ACIS {st.acis_sid}",
                        model_source=f"open-meteo {model} (short-lead)",
                        verified_at=now,
                    )
                )
            store.upsert(rows)
            report.n_markets_verified += len(rows)
    return report
```

(ACIS calls go through `meteo_client` — any httpx.Client works; it's just POST transport.)

`src/edgecast/cli.py` — add subparser + handler:

```python
    p_backfill = sub.add_parser(
        "backfill", help="verify past days of settled markets into the local store"
    )
    p_backfill.add_argument("--days", type=int, default=30)
    p_backfill.add_argument("--db", default="data/edgecast.db")
```

```python
def _backfill(args) -> int:
    from datetime import date, timedelta

    import httpx

    import edgecast.verify as verify_mod
    from edgecast.store import Store

    yesterday = date.today() - timedelta(days=1)
    dates = [(yesterday - timedelta(days=i)).isoformat() for i in range(args.days)]
    store = Store(args.db)
    with httpx.Client() as kc, httpx.Client() as mc:
        report = verify_mod.verify_days(dates, store, kc, mc)
    print(
        f"backfill: {len(report.dates_attempted)} dates attempted, "
        f"{report.n_markets_verified} markets verified, "
        f"{len(report.failures)} failures, {len(report.mismatches)} kalshi mismatches"
    )
    for f in report.failures[:20]:
        print(f"  failed {f['city']} {f['date']} [{f['stage']}]: {f['reason']}")
    return 0 if report.n_markets_verified > 0 or not report.failures else 1
```

`main` dispatch gains `if args.command == "backfill": return _backfill(args)`. Note the `import edgecast.verify as verify_mod` + `verify_mod.verify_days(...)` form — required so tests can monkeypatch. `_serve` gains `--db data/edgecast.db` and `--verify-days 30` arguments passed to `create_app(..., db_path=args.db, verify_days=args.verify_days)` (create_app accepts them in Task 5; add the params to the serve subparser now and pass through).

- [ ] **Step 3: Verify pass** — `uv run pytest tests/test_verify.py tests/test_cli.py -v`, then full suite. (Full suite requires Task 5's create_app signature — if serve tests fail on unknown kwargs, implement the pass-through as no-op defaults `db_path="data/edgecast.db", verify_days=30` accepted-and-stored in create_app now, used in Task 5.)

---

### Task 5: `/api/live` verification block + top-up

**Files:**
- Modify: `src/edgecast/server.py`
- Test: append to `tests/test_server.py`; extend `tests/test_live_integration.py`

**Interfaces:**
- Consumes: `Store`, `verify_days`, `bucket_label`, existing live assembly.
- Produces: `create_app(fixtures_dir, web_dist=None, db_path="data/edgecast.db", verify_days=30)`. `/api/live` response gains the spec's `verification` block; aggregate strip data now comes from it (results[] stays today-only). Top-up: at most 3 missing dates verified per request.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_server.py`:

```python
from edgecast.store import Store, VerificationRow


def seed_row(**kw) -> VerificationRow:
    base = dict(
        market_id="M1", model="gfs_seamless", series="KXHIGHNY", city="NYC",
        event_date="2026-07-02", comparator="between",
        threshold=None, threshold_low=88.0, threshold_high=89.0,
        question="q", market_prob=0.8, model_prob=0.6, model_prob_raw=0.6,
        n_members=31, observed_high=88.5, outcome=1, kalshi_result="yes",
        brier_market=0.04, brier_model=0.16,
        observed_source="ACIS KNYC", model_source="open-meteo gfs_seamless (short-lead)",
        verified_at="2026-07-03T12:00:00+00:00",
    )
    base.update(kw)
    return VerificationRow(**base)


@pytest.fixture
def live_client(fixtures_dir, tmp_path, monkeypatch):
    import edgecast.server as server_mod

    from edgecast.verify import VerifyReport

    monkeypatch.setattr(server_mod, "build_live_scenarios", lambda *a, **k: _fake_live_result())
    monkeypatch.setattr(
        server_mod, "run_verification",
        lambda dates, store, kc, mc, model="gfs_seamless": VerifyReport(dates_attempted=list(dates)),
    )
    db = tmp_path / "live.db"
    Store(db).upsert([seed_row()])
    app = create_app(fixtures_dir, web_dist=tmp_path / "no-dist", db_path=db)
    return TestClient(app)


def test_live_includes_verification_block(live_client):
    out = live_client.get("/api/live").json()
    v = out["verification"]
    assert v["window_days"] == 30
    assert v["model"] == "gfs_seamless"
    assert v["n_markets"] == 1
    assert v["mean_brier_market"] == 0.04
    assert v["hit_rate_market"] == 1.0
    assert v["better_calibrated"] == "market"
    assert v["by_city"]["NYC"]["n_markets"] == 1
    assert v["kalshi_mismatches"] == []


def test_live_verification_yesterday_block(live_client, monkeypatch):
    import edgecast.server as server_mod

    monkeypatch.setattr(server_mod, "_yesterday_iso", lambda: "2026-07-02")
    out = live_client.get("/api/live").json()
    y = out["verification"]["yesterday"]["NYC"]
    assert y["observed_high"] == 88.5
    assert y["settled_bucket"] == "88–89°"
    assert y["source"] == "ACIS KNYC"


def test_live_verification_null_on_store_failure(fixtures_dir, tmp_path, monkeypatch):
    import edgecast.server as server_mod

    monkeypatch.setattr(server_mod, "build_live_scenarios", lambda *a, **k: _fake_live_result())

    class Boom:
        def __init__(self, *a, **k):
            raise RuntimeError("cannot open db")

    monkeypatch.setattr(server_mod, "Store", Boom)
    app = create_app(fixtures_dir, web_dist=tmp_path / "no-dist", db_path=tmp_path / "x.db")
    out = TestClient(app).get("/api/live").json()
    assert out["verification"] is None
```

Extend `tests/test_live_integration.py` with:

```python
def test_backfill_two_days_against_real_apis(tmp_path):
    import httpx

    from edgecast.store import Store
    from edgecast.verify import verify_days
    from datetime import date, timedelta

    dates = [(date.today() - timedelta(days=i)).isoformat() for i in (1, 2)]
    store = Store(tmp_path / "real.db")
    with httpx.Client() as kc, httpx.Client() as mc:
        report = verify_days(dates, store, kc, mc)
    assert report.n_markets_verified > 0, f"failures: {report.failures}"
    stats = store.window_stats("gfs_seamless", min(dates))
    assert stats is not None and stats.n_days >= 1
```

Run — expected FAIL.

- [ ] **Step 2: Implement**

`src/edgecast/server.py` — new imports (the function is imported as `run_verification` so it doesn't collide with the `verify_days: int` parameter; `server_mod.run_verification` is what tests monkeypatch):

```python
from edgecast.store import Store, bucket_label
from edgecast.verify import verify_days as run_verification
```

`create_app` signature gains `db_path: str | Path = "data/edgecast.db", verify_days: int = 30`.

```python
def _yesterday_iso() -> str:
    from datetime import date, timedelta

    return (date.today() - timedelta(days=1)).isoformat()


def _window_dates(days: int) -> list[str]:
    from datetime import date, timedelta

    yesterday = date.today() - timedelta(days=1)
    return [(yesterday - timedelta(days=i)).isoformat() for i in range(days)]
```

Inside `create_app`, after the live endpoint's `out["live"] = {…}` assignment, add verification (wrapped so store errors degrade):

```python
        model = "gfs_seamless"
        try:
            store = Store(db_path)
            dates = _window_dates(verify_days)
            missing = store.dates_missing(model, dates)[:3]
            topup_failures: list[dict] = []
            if missing:
                topup = run_verification(missing, store, kalshi_client, meteo_client, model=model)
                topup_failures = topup.failures
            since = min(dates)
            stats = store.window_stats(model, since)
            if stats is None:
                out["verification"] = None
            else:
                yesterday = _yesterday_iso()
                y_rows = store.rows_for_date(model, yesterday)
                y_by_city: dict[str, dict] = {}
                for r in y_rows:
                    entry = y_by_city.setdefault(
                        r.city,
                        {"date": yesterday, "observed_high": r.observed_high,
                         "source": r.observed_source, "settled_bucket": None,
                         "brier_market": 0.0, "brier_model": 0.0, "_n": 0},
                    )
                    entry["_n"] += 1
                    entry["brier_market"] += r.brier_market
                    entry["brier_model"] += r.brier_model
                    if r.outcome == 1:
                        entry["settled_bucket"] = bucket_label(
                            r.comparator, r.threshold, r.threshold_low, r.threshold_high
                        )
                for entry in y_by_city.values():
                    n = entry.pop("_n")
                    entry["brier_market"] = round(entry["brier_market"] / n, 6)
                    entry["brier_model"] = round(entry["brier_model"] / n, 6)
                out["verification"] = {
                    "window_days": verify_days,
                    "model": model,
                    "n_markets": stats.n_markets,
                    "n_days": stats.n_days,
                    "mean_brier_market": round(stats.market.mean_brier, 6),
                    "mean_brier_model": round(stats.model.mean_brier, 6),
                    "hit_rate_market": round(stats.market.hit_rate, 4),
                    "hit_rate_model": round(stats.model.hit_rate, 4),
                    "better_calibrated": stats.better_calibrated,
                    "by_city": {
                        city: {
                            "n_markets": cs.n_markets,
                            "mean_brier_market": round(cs.market.mean_brier, 6),
                            "mean_brier_model": round(cs.model.mean_brier, 6),
                            "hit_rate_market": round(cs.market.hit_rate, 4),
                            "hit_rate_model": round(cs.model.hit_rate, 4),
                        }
                        for city, cs in store.city_stats(model, since).items()
                    },
                    "yesterday": y_by_city,
                    "kalshi_mismatches": [
                        {"market_id": r.market_id, "kalshi_result": r.kalshi_result,
                         "edgecast_outcome": r.outcome}
                        for r in store.mismatches(model, since)
                    ],
                    "verification_failed": topup_failures,
                }
        except Exception as e:  # noqa: BLE001 - verification must never break the ladder
            out["verification"] = None
            out["live"]["cities_failed"].append(
                {"city": "*", "reason": f"verification store: {type(e).__name__}: {e}"}
            )
```

`_serve` in cli.py passes `db_path=args.db, verify_days=args.verify_days`.

- [ ] **Step 3: Verify pass** — server tests, full suite; optionally `EDGECAST_LIVE_TESTS=1 uv run pytest tests/test_live_integration.py -v` (network).

---

### Task 6: CityCard ladder (frontend)

**Files:**
- Create: `web/src/components/CityCard.tsx`; Test: `web/src/components/CityCard.test.tsx`
- Delete: `web/src/components/MarketCard.tsx`, `web/src/components/MarketCard.test.tsx`, `web/src/components/ProbBar.tsx`, `web/src/components/ProbBar.test.tsx`
- Modify: `web/src/types.ts` (verification types)

**Interfaces:**
- Consumes: `ScenarioResult`, new `VerificationInfo`/`CityVerification`/`YesterdayInfo` types.
- Produces: `CityCard({ location, cityInfo, results, yesterday, cityStats, mismatches })` — test hooks `data-testid`: `ladder-row`, `edge-cell`, `verification-footer`, `mismatch-warning`.

- [ ] **Step 1: Types**

Append to `web/src/types.ts`:

```ts
export interface CityWindowStats {
  n_markets: number;
  mean_brier_market: number;
  mean_brier_model: number;
  hit_rate_market: number;
  hit_rate_model: number;
}

export interface YesterdayInfo {
  date: string;
  observed_high: number;
  source: string;
  settled_bucket: string | null;
  brier_market: number;
  brier_model: number;
}

export interface KalshiMismatch {
  market_id: string;
  kalshi_result: string;
  edgecast_outcome: number;
}

export interface VerificationInfo {
  window_days: number;
  model: string;
  n_markets: number;
  n_days: number;
  mean_brier_market: number;
  mean_brier_model: number;
  hit_rate_market: number;
  hit_rate_model: number;
  better_calibrated: "market" | "model" | "tie";
  by_city: Record<string, CityWindowStats>;
  yesterday: Record<string, YesterdayInfo>;
  kalshi_mismatches: KalshiMismatch[];
  verification_failed: { city: string; stage: string; reason: string }[];
}
```

and on `AnalysisOutput`: `verification?: VerificationInfo | null;`.

- [ ] **Step 2: Write the failing tests**

`web/src/components/CityCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ScenarioResult } from "../types";
import { CityCard } from "./CityCard";

function row(id: string, comparator: string, t?: number, lo?: number, hi?: number, edge = 0.02): ScenarioResult {
  return {
    scenario_id: id,
    market: {
      question: `q ${id}`,
      location: "AUS",
      variable: "high_temp_f",
      comparator,
      threshold: t,
      threshold_low: lo,
      threshold_high: hi,
      event_date: "2026-07-04",
    },
    market_prob: 0.85,
    model_prob: 0.71,
    model_prob_raw: 0.71,
    n_members: 31,
    edge: {
      value: edge,
      log_odds_diff: 0.1,
      flag: edge >= 0.05 ? "model_higher" : edge <= -0.05 ? "market_higher" : "agreement",
    },
    settlement: null,
  };
}

const results = [
  row("hi", ">=", 102, undefined, undefined, 0.09),
  row("mid", "between", undefined, 96, 97, -0.14),
  row("lo", "<=", 93, undefined, undefined),
];

const props = {
  location: "AUS",
  cityInfo: { name: "Austin", station: "Camp Mabry", series: "KXHIGHAUS" },
  results,
  yesterday: {
    date: "2026-07-03",
    observed_high: 96,
    source: "ACIS KATT",
    settled_bucket: "96–97°",
    brier_market: 0.054,
    brier_model: 0.112,
  },
  cityStats: {
    n_markets: 31,
    mean_brier_market: 0.08,
    mean_brier_model: 0.1,
    hit_rate_market: 0.75,
    hit_rate_model: 0.64,
  },
  mismatches: [],
};

it("renders rows sorted ascending with range labels", () => {
  render(<CityCard {...props} />);
  const rows = screen.getAllByTestId("ladder-row");
  expect(rows).toHaveLength(3);
  expect(rows[0]).toHaveTextContent("93° or below");
  expect(rows[1]).toHaveTextContent("96–97°");
  expect(rows[2]).toHaveTextContent("102° or above");
});

it("renders percentages and colored edges", () => {
  render(<CityCard {...props} />);
  const rows = screen.getAllByTestId("ladder-row");
  expect(rows[1]).toHaveTextContent("85%");
  expect(rows[1]).toHaveTextContent("71%");
  const cells = screen.getAllByTestId("edge-cell");
  expect(cells[1].className).toContain("text-down");
  expect(cells[1]).toHaveTextContent("▼ -0.14");
  expect(cells[2].className).toContain("text-up");
  expect(cells[2]).toHaveTextContent("▲ +0.09");
  expect(cells[0]).toHaveTextContent("—");
});

it("renders verification footer with winner dot on lower brier", () => {
  render(<CityCard {...props} />);
  const footer = screen.getByTestId("verification-footer");
  expect(footer).toHaveTextContent("OBSERVED 96°F");
  expect(footer).toHaveTextContent("SETTLED 96–97°");
  expect(footer).toHaveTextContent("BRIER MKT .080 ●");
  expect(footer).toHaveTextContent("HIT 75% / 64%");
});

it("renders unverified state without yesterday data", () => {
  render(<CityCard {...props} yesterday={undefined} cityStats={undefined} />);
  expect(screen.getByTestId("verification-footer")).toHaveTextContent("UNVERIFIED");
});

it("renders red mismatch warning", () => {
  render(
    <CityCard
      {...props}
      mismatches={[{ market_id: "X", kalshi_result: "yes", edgecast_outcome: 0 }]}
    />,
  );
  const warn = screen.getByTestId("mismatch-warning");
  expect(warn.className).toContain("text-down");
  expect(warn).toHaveTextContent("KALSHI SETTLED YES — EDGECAST COMPUTES NO");
});

it("settled fixture rows show outcome instead of edge", () => {
  const settled = {
    ...row("s", ">=", 90, undefined, undefined, 0.08),
    settlement: {
      outcome: 1 as const,
      observed_value: 93.1,
      brier_market: 0.078,
      brier_model: 0.04,
      brier_diff: -0.038,
    },
  };
  render(<CityCard {...props} results={[settled]} yesterday={undefined} cityStats={undefined} />);
  expect(screen.getAllByTestId("edge-cell")[0]).toHaveTextContent("YES ●");
});
```

Run in `web/`: `npm test` — expected FAIL (no CityCard).

- [ ] **Step 3: Implement**

`web/src/components/CityCard.tsx`:

```tsx
import type { CityInfo, CityWindowStats, KalshiMismatch, ScenarioResult, YesterdayInfo } from "../types";

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function formatDate(isoDate: string): string {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${String(d ?? 1).padStart(2, "0")}`;
}

function rangeLabel(market: ScenarioResult["market"]): string {
  if (market.comparator === "between") return `${market.threshold_low}–${market.threshold_high}°`;
  if (market.comparator === ">=") return `${market.threshold}° or above`;
  if (market.comparator === "<=") return `${market.threshold}° or below`;
  if (market.comparator === ">") return `above ${market.threshold}°`;
  return `below ${market.threshold}°`;
}

function sortKey(r: ScenarioResult): number {
  const m = r.market;
  if (m.comparator === "between") return m.threshold_low ?? 0;
  if (m.comparator === "<=" || m.comparator === "<") return (m.threshold ?? 0) - 1000;
  return m.threshold ?? 0;
}

function fmtBrier(x: number): string {
  return x.toFixed(3).replace(/^0/, "");
}

function ProbCell({ value, tone }: { value: number; tone: "text-2" | "text-3" }) {
  return (
    <div className="w-14">
      <span className="tabular-nums">{Math.round(value * 100)}%</span>
      <div className="mt-0.5 h-0.5 bg-hairline">
        <div
          className={tone === "text-2" ? "h-full bg-text-2" : "h-full bg-text-3"}
          style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, transition: "width 200ms ease-out" }}
        />
      </div>
    </div>
  );
}

function EdgeCell({ r }: { r: ScenarioResult }) {
  if (r.settlement !== null) {
    const won = r.settlement.outcome === 1;
    return (
      <span className="w-20 text-right tabular-nums" data-testid="edge-cell">
        {won ? "YES ●" : "NO"}
      </span>
    );
  }
  const { edge } = r;
  if (edge.flag === "agreement") {
    return (
      <span className="w-20 text-right text-text-3" data-testid="edge-cell">
        —
      </span>
    );
  }
  const up = edge.flag === "model_higher";
  return (
    <span
      className={`w-20 text-right tabular-nums ${up ? "text-up" : "text-down"}`}
      style={{
        textShadow: up
          ? "0 0 8px rgba(46, 204, 113, 0.45)"
          : "0 0 8px rgba(255, 77, 77, 0.45)",
      }}
      title={up ? "model higher" : "market higher"}
      data-testid="edge-cell"
    >
      {up ? "▲ +" : "▼ "}
      {edge.value.toFixed(2)}
    </span>
  );
}

interface CityCardProps {
  location: string;
  cityInfo?: CityInfo;
  results: ScenarioResult[];
  yesterday?: YesterdayInfo;
  cityStats?: CityWindowStats;
  mismatches: KalshiMismatch[];
}

export function CityCard({ location, cityInfo, results, yesterday, cityStats, mismatches }: CityCardProps) {
  const sorted = results.slice().sort((a, b) => sortKey(a) - sortKey(b));
  const eventDate = sorted[0]?.market.event_date;
  return (
    <article className="border border-hairline bg-panel p-4">
      <header className="flex items-baseline justify-between gap-2 pb-2">
        <span className="text-xs font-bold tracking-[0.25em]">{location} · HIGH TEMP</span>
        <span className="shrink-0 text-xs text-text-3">
          {cityInfo ? `${cityInfo.station.toUpperCase()} · ` : ""}
          {eventDate ? formatDate(eventDate) : ""}
        </span>
      </header>
      <div className="flex justify-between border-b border-hairline pb-1 text-[10px] tracking-[0.2em] text-text-3">
        <span>RANGE</span>
        <span className="flex gap-6">
          <span className="w-14">MARKET</span>
          <span className="w-14">MODEL</span>
          <span className="w-20 text-right">EDGE</span>
        </span>
      </div>
      <ul>
        {sorted.map((r) => (
          <li
            key={r.scenario_id}
            className="flex items-center justify-between border-b border-hairline py-2 text-sm"
            data-testid="ladder-row"
          >
            <span className="text-xs">{rangeLabel(r.market)}</span>
            <span className="flex items-center gap-6">
              <ProbCell value={r.market_prob} tone="text-2" />
              <ProbCell value={r.model_prob} tone="text-3" />
              <EdgeCell r={r} />
            </span>
          </li>
        ))}
      </ul>
      <footer className="pt-2 text-xs text-text-2" data-testid="verification-footer">
        {yesterday && cityStats ? (
          <>
            <p>
              YESTERDAY · OBSERVED {yesterday.observed_high}°F
              {yesterday.settled_bucket ? ` · SETTLED ${yesterday.settled_bucket} ✓` : ""}
            </p>
            <p>
              30D: BRIER MKT {fmtBrier(cityStats.mean_brier_market)}
              {cityStats.mean_brier_market < cityStats.mean_brier_model ? " ●" : ""} MDL{" "}
              {fmtBrier(cityStats.mean_brier_model)}
              {cityStats.mean_brier_model < cityStats.mean_brier_market ? " ●" : ""} · HIT{" "}
              {Math.round(cityStats.hit_rate_market * 100)}% /{" "}
              {Math.round(cityStats.hit_rate_model * 100)}%
            </p>
          </>
        ) : (
          <p className="text-text-3">YESTERDAY · UNVERIFIED</p>
        )}
        {mismatches.map((m) => (
          <p key={m.market_id} className="text-down" data-testid="mismatch-warning">
            ⚠︎ KALSHI SETTLED {m.kalshi_result.toUpperCase()} — EDGECAST COMPUTES{" "}
            {m.edgecast_outcome === 1 ? "YES" : "NO"} ({m.market_id})
          </p>
        ))}
      </footer>
    </article>
  );
}
```

Delete `MarketCard.tsx`, `MarketCard.test.tsx`, `ProbBar.tsx`, `ProbBar.test.tsx`. (App still imports MarketCard until Task 7 — run only the CityCard test file this task: `npx vitest run src/components/CityCard.test.tsx`.)

- [ ] **Step 4: Verify** — `npx vitest run src/components/CityCard.test.tsx` passes.

---

### Task 7: App + AggregateStrip wiring

**Files:**
- Modify: `web/src/App.tsx`, `web/src/components/AggregateStrip.tsx`
- Modify: `web/src/App.test.tsx`, `web/src/components/AggregateStrip.test.tsx`

**Interfaces:**
- Consumes: `CityCard`, `VerificationInfo`.
- Produces: `AggregateStrip({ aggregate, verification })` — `verification` present → verification variant (`data-testid="verdict"` keeps working); `verification === null` → `AWAITING VERIFICATION` variant; undefined → fixture variant (existing behavior). App renders one `CityCard` per location group and passes per-city verification data.

- [ ] **Step 1: Update tests (failing first)**

`web/src/components/AggregateStrip.test.tsx` — add:

```tsx
const verification = {
  window_days: 30, model: "gfs_seamless", n_markets: 214, n_days: 29,
  mean_brier_market: 0.091, mean_brier_model: 0.117,
  hit_rate_market: 0.72, hit_rate_model: 0.62,
  better_calibrated: "market" as const,
  by_city: {}, yesterday: {}, kalshi_mismatches: [], verification_failed: [],
};

it("verification variant shows window stats and qualified verdict", () => {
  render(<AggregateStrip aggregate={agg} verification={verification} />);
  expect(screen.getByText("214")).toBeInTheDocument();
  expect(screen.getByText(".091")).toBeInTheDocument();
  expect(screen.getByText("72% / 62%")).toBeInTheDocument();
  expect(screen.getByTestId("verdict")).toHaveTextContent(
    "MARKET BETTER CALIBRATED · VERIFIED: LAST 30 DAYS",
  );
});

it("null verification shows awaiting-backfill state", () => {
  render(<AggregateStrip aggregate={agg} verification={null} />);
  expect(screen.getByTestId("verdict")).toHaveTextContent("AWAITING VERIFICATION");
});
```

`web/src/App.test.tsx` — update `LIVE_OUTPUT` to include a `verification` field (reuse the object above with `by_city: { NYC: {...}, CHI: {...} }`, `yesterday: { NYC: { date, observed_high: 88.5, source, settled_bucket: "88–89°", brier_market: .04, brier_model: .16 } }`), change the grouping assertion to `city-card` count (CityCard's `<article>` per city — assert via `screen.getAllByTestId("verification-footer")` length 2 and `getAllByTestId("ladder-row")` length 3), and keep the strip/mode/error tests as-is.

Run in `web/` — expected FAIL.

- [ ] **Step 2: Implement**

`AggregateStrip.tsx` — new prop `verification?: VerificationInfo | null`. When `verification` is an object: stats = `MARKETS {n_markets} · DAYS {n_days} · BRIER MKT {fmt} · MDL {fmt}` as `Stat` blocks plus a `HIT` stat showing `72% / 62%`; verdict = `{VERDICT[better_calibrated]} · VERIFIED: LAST {window_days} DAYS`. When `verification === null`: render only the verdict element with `AWAITING VERIFICATION — run: uv run edgecast backfill` (dim). When `undefined`: existing aggregate behavior unchanged.

`App.tsx` — replace the MarketCard import/grid with CityCard: per location group render

```tsx
<CityCard
  key={location}
  location={location}
  cityInfo={cities[location]}
  results={results}
  yesterday={output.verification?.yesterday?.[location]}
  cityStats={output.verification?.by_city?.[location]}
  mismatches={/* verification mismatches whose market_id starts with the city's series ticker; when cityInfo is missing, [] */
    output.verification?.kalshi_mismatches?.filter((m) =>
      cities[location] ? m.market_id.startsWith(cities[location].series) : false,
    ) ?? []
  }
/>
```

(keep the existing section header + grid layout, one CityCard per city instead of many MarketCards; pass `<AggregateStrip aggregate={output.aggregate} verification={mode === "live" ? output.verification ?? null : undefined} />`).

- [ ] **Step 3: Verify** — `npm test` full frontend suite green; `npm run build` clean (MarketCard/ProbBar imports fully gone).

---

### Task 8: Backfill run, live verify, anti-slop audit

**Files:** none (verification only).

- [ ] **Step 1: Suites** — `uv run pytest -v` (root), `npm test` (web/). Green.

- [ ] **Step 2: Real backfill (network)** — `uv run edgecast backfill --days 30`. Expect a summary with hundreds of markets verified; investigate failures (a few missing ACIS days or unpriced events are acceptable; systematic per-city failure is not — check the sid/series). Spot-check: pick one (city, date), compare `observed_high` in the DB against the NWS CLI bulletin for that station/date; record both numbers.

- [ ] **Step 3: Serve + browser** — `npm run build`, restart `uv run edgecast serve`, open the dashboard: ladder card per city (all buckets as rows), aggregate strip shows `VERIFIED: LAST 30 DAYS` verdict with Brier + hit rates, city footers show yesterday + 30D lines; threshold stepper still live-updates; FIXTURES mode renders ladders with settled `YES ●` rows.

- [ ] **Step 4: Anti-slop audit** — ensure: green/red only in edge cells + mismatch warning (`grep -rln "text-up\|text-down\|2ecc71\|ff4d4d\|46, 204, 113\|255, 77, 77" web/src/` → theme.css, CityCard.tsx + its test only); no `MarketCard`/`ProbBar` remnants; no new shadows/gradients/rounded/spinners/emoji (⚠︎/✓/●/▲/▼ are glyphs); deps unchanged. Record in ledger.

---

## Model delegation notes (per global CLAUDE.md)

- Tasks 1–5 → gpt-5.5 codex exec xhigh (Tasks 1 records a real ACIS fixture + CLI cross-check; Task 5's integration test needs network only under EDGECAST_LIVE_TESTS=1).
- Tasks 6–8 → fable-5 inline. Reviews after each task: fable-5. Commits: user only.
