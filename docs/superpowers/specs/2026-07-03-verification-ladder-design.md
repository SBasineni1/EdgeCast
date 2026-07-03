# EdgeCast v3 Design: 30-Day Verification Store + City Ladder Cards

**Date:** 2026-07-03 (revised same day: yesterday-only → 30-day SQLite store per user direction)
**Status:** Approved design, pre-implementation
**Depends on:** v2 live Kalshi mode (complete, uncommitted).
**Forward-looking constraint:** v4 adds multiple models — additional ensembles and the official NWS forecast-as-issued (via IEM's MOS/NBM archive). Everything here keys verification rows by `(market_id, model)` so v4 is additive.

## Purpose

1. **Verification store:** a SQLite database of settled Kalshi weather markets scored against official NWS observed highs and model predictions, covering a rolling window (default 30 days, configurable). Each refresh keeps it topped up; a backfill command seeds it. The dashboard's aggregate strip shows a real calibration verdict over the window; each city card shows yesterday's settlement and the city's 30-day record.
2. **Ladder cards:** all of a city's temperature buckets in one card (Kalshi-style ladder), replacing per-bucket cards.

The end goal this serves: a per-model verification record — how each model (and later the official NWS forecast) predicted each day vs what the official high actually was, and how Kalshi priced it.

## Data sources and their roles

| Role | Source | Why |
|---|---|---|
| Settlement truth (observed high) | **ACIS** (`data.rcc-acis.org`, JSON, no auth) — NOAA RCC serving the official NWS/NOAA station climate records | The exact station threads Kalshi settles on; 30 days in one call; same official numbers the NWS CLI bulletins print. NWS CLI text products only persist ~1 week on api.weather.gov, so they cannot backfill. |
| Model prediction (past days) | Open-Meteo ensemble, `past_days` (short-lead hindcast from archived runs) | First model in the store (`model = "gfs_seamless"`). Honest labeling: approximates what the model indicated at short lead, not a frozen issue-time forecast. |
| Market probability | Kalshi final traded price (`last_price_dollars`) of the settled market | What the market believed at close. |
| Cross-check | Kalshi's own `result` field; one-day-per-city CLI report comparison during implementation | Mismatch between our ACIS-based settlement and Kalshi's result renders as an explicit warning, not silent trust. |

## Scope

**In scope**

- Station registry: ACIS station ids (`acis_sid`) per city.
- `live/acis.py`: observed daily maxes for a date range.
- Open-Meteo client: `model` and `past_days` parameters.
- Kalshi client: fetch a specific event's markets (any status) + `to_result`.
- `store.py`: SQLite verification store (stdlib `sqlite3`), `data/edgecast.db` (gitignored).
- `verify.py`: settle + score past days through the existing pipeline; upsert into the store.
- `edgecast backfill [--days 30]` CLI command; auto top-up of missing days on `/api/live`.
- `/api/live` verification block (window stats, per-city stats, yesterday, mismatches, failures).
- Frontend: `CityCard` ladder + verification footer; aggregate strip `VERIFIED: LAST N DAYS`; fixture mode through the same ladder.
- Stats: per side (market / each model): mean Brier and **hit rate** (share of days where that side's highest-probability bucket verified).
- Tests (recorded fixtures, no network) + anti-slop audit.

**Out of scope (v4 candidates)**

- Additional models: more ensembles; official NWS forecast-as-issued via IEM MOS/NBM archive (`model = "nbm"`).
- Calibration curves/reliability diagrams; de-vigging; KXLOW; WebSockets; multi-user/hosted DB.

## Backend

### Station registry (`live/stations.py`)

`Station` gains `acis_sid: str` — the official station id whose record Kalshi settles on. Initial values (implementation MUST verify each against ACIS and Kalshi's settlement rules, and cross-check ONE recent day per city against the live NWS CLI bulletin, reporting adjustments):

| series | city | station | acis_sid |
|---|---|---|---|
| KXHIGHNY | NYC | Central Park | KNYC |
| KXHIGHCHI | CHI | Midway | KMDW |
| KXHIGHMIA | MIA | Miami Intl | KMIA |
| KXHIGHAUS | AUS | Bergstrom Intl | KAUS |
| KXHIGHDEN | DEN | Denver Intl | KDEN |
| KXHIGHPHIL | PHL | Philadelphia Intl | KPHL |
| KXHIGHLAX | LAX | LAX | KLAX |

(Camp Mabry `KATT` vs Bergstrom `KAUS` was the known trap; settlement data 2026-06-29..07-02 proved Kalshi settles on Bergstrom `KAUS` — all four days match KAUS, while KATT disagrees on 07-01/07-02.)

### ACIS client (`live/acis.py`)

- `fetch_observed_highs(acis_sid: str, start_date: str, end_date: str, client: httpx.Client) -> dict[str, float]` — POST `https://data.rcc-acis.org/StnData` with `{"sid": sid, "sdate": start, "edate": end, "elems": [{"name": "maxt"}]}`; response `data` is `[[date, value], …]`; `"M"` (missing) entries omitted from the result. 10s timeout. Values are °F.
- Raise `AcisUnavailable(reason)` on HTTP/shape errors. TTL cache 3600s keyed `{sid}:{start}:{end}`.

### Open-Meteo additions (`live/openmeteo.py`)

- `fetch_ensemble_high(..., model: str = "gfs_seamless", past_days: int = 0)`; `EnsembleForecast.source` = `"open-meteo {model}"` and `"open-meteo {model} (short-lead)"` for past days. `fetch_ensemble_past_highs(lat, lon, dates, tz, client, model) -> dict[str, tuple[float, ...]]` — one `past_days=N+1` call reduced per date.

### Kalshi additions (`live/kalshi.py`)

- `event_ticker_for(series: str, d: date) -> str` (`KXHIGHNY-26JUL02` format).
- `fetch_event_markets(event_ticker, client) -> list[dict]` — no status filter, paginated.
- `to_result(market: dict) -> str | None` — Kalshi's settled result (`"yes"`/`"no"`), None when absent.

### Verification store (`src/edgecast/store.py`)

Stdlib `sqlite3`; DB path default `data/edgecast.db` (dir created on demand; gitignored). Schema v1:

```sql
CREATE TABLE IF NOT EXISTS verifications (
  market_id TEXT NOT NULL,
  model TEXT NOT NULL,              -- "gfs_seamless"; v4 adds "nbm", …
  series TEXT NOT NULL,
  city TEXT NOT NULL,
  event_date TEXT NOT NULL,         -- ISO
  comparator TEXT NOT NULL,
  threshold REAL, threshold_low REAL, threshold_high REAL,
  question TEXT NOT NULL,
  market_prob REAL NOT NULL,        -- final traded price
  model_prob REAL NOT NULL,         -- clamped
  model_prob_raw REAL NOT NULL,
  n_members INTEGER NOT NULL,
  observed_high REAL NOT NULL,      -- ACIS official
  outcome INTEGER NOT NULL,         -- our settlement (0/1)
  kalshi_result TEXT,               -- "yes"/"no"/NULL
  brier_market REAL NOT NULL,
  brier_model REAL NOT NULL,
  observed_source TEXT NOT NULL,    -- "ACIS KATT"
  model_source TEXT NOT NULL,       -- "open-meteo gfs_seamless (short-lead)"
  verified_at TEXT NOT NULL,
  PRIMARY KEY (market_id, model)
);
CREATE INDEX IF NOT EXISTS idx_verifications_date ON verifications(event_date);
```

API: `Store(path)` with `upsert(rows)`, `covered_dates(model, window) -> set[str]`, `window_stats(model, days) -> WindowStats`, `city_stats(model, days) -> dict[city, CityStats]`, `yesterday_rows(model) -> list`, `mismatches(model, days) -> list`. Stats:

- `mean_brier_market`, `mean_brier_model`, `n_markets`, `n_days`.
- **Hit rate** per side: for each (city, event_date) group, the side's highest-probability bucket "hit" iff that bucket's outcome == 1; hit_rate = hits / groups. Reported for market and model.
- `better_calibrated` by mean Brier.

### Verifier (`src/edgecast/verify.py`)

- `verify_days(dates, store, clients…) -> VerifyReport` — per city × date: skip if already covered; fetch event markets (skip events with no settled/priced markets), ACIS observed high (batch-fetched per city for the whole range), hindcast members; build `Scenario`s with `Observation(observed_high)`; run the existing `analyze`; upsert rows; collect per-stage failures and Kalshi-result mismatches. Pipeline settlement/Brier code is reused untouched.
- `edgecast backfill [--days 30] [--db PATH]` CLI subcommand → `verify_days(yesterday-N+1 … yesterday)` and prints a summary (days covered, markets verified, failures).
- Auto top-up: `/api/live` calls `verify_days` for dates in the window missing from the store, capped at 3 dates per request (keeps request latency bounded; a fresh 30-day hole is the backfill command's job, printed as a hint in the response failures).

### `/api/live` additions

```json
"verification": {
  "window_days": 30,
  "model": "gfs_seamless",
  "n_markets": 214, "n_days": 29,
  "mean_brier_market": 0.091, "mean_brier_model": 0.117,
  "hit_rate_market": 0.72, "hit_rate_model": 0.62,
  "better_calibrated": "market",
  "by_city": {"AUS": {"n_markets": 31, "mean_brier_market": 0.08, "mean_brier_model": 0.10, "hit_rate_market": 0.75, "hit_rate_model": 0.64}},
  "yesterday": {"AUS": {"date": "2026-07-02", "observed_high": 96.0, "source": "ACIS KATT", "settled_bucket": "96–97°", "brier_market": 0.054, "brier_model": 0.112}},
  "kalshi_mismatches": [{"market_id": "…", "kalshi_result": "yes", "edgecast_outcome": 0}],
  "verification_failed": [{"city": "MIA", "stage": "acis", "reason": "…"}]
}
```

The aggregate strip's verdict in live mode now comes from `verification` (window stats), NOT from in-request settled scenarios; `results[]` remains today's unsettled markets only. `--days` window configurable via `edgecast serve --verify-days 30`. Verification failures never block the ladder. Store errors (e.g. unwritable path) degrade to `verification: null` plus a failure entry.

## Frontend

### CityCard ladder (replaces per-bucket MarketCard grid)

- **Header:** `AUS · HIGH TEMP` bold letterspaced; right: station name + `JUL 04` dim.
- **Ladder rows** (today's buckets, sorted ascending): columns `RANGE | MARKET | MODEL | EDGE`.
  - Range labels from comparator shape: `93° or below`, `94–95°`, `102° or above`.
  - Market/model cells: mono percentage with a 2px underline bar proportional to the value (market `text-2`, model `text-3`).
  - Edge cell: `▲ +0.09` green / `▼ -0.14` red with sanctioned glow when `|edge| ≥ threshold`; dim `—` otherwise.
  - Hairline separators; no zebra striping.
- **Verification footer:** `YESTERDAY · OBSERVED 96°F · SETTLED 96–97° ✓` plus `30D: BRIER MKT .080 ● MDL .100 · HIT 75% / 64%` (winner dot on lower Brier). Kalshi mismatch → red warning line `⚠ KALSHI SETTLED YES — EDGECAST COMPUTES NO` (`⚠` as text glyph U+26A0 + FE0E, not emoji). City unverified → dim `YESTERDAY · UNVERIFIED (acis: no data)`.
- `MarketCard.tsx` and `ProbBar.tsx` are deleted. Fixture mode renders through CityCard (group by location; settled fixture rows show `YES ●` / `NO` in the EDGE column).

### Aggregate strip

Live mode: figures from `verification` — `MARKETS 214 · DAYS 29 · BRIER MKT .091 · MDL .117 · HIT 72%/62%` and verdict `MARKET BETTER CALIBRATED · VERIFIED: LAST 30 DAYS`. `verification: null` → `AWAITING VERIFICATION — run: uv run edgecast backfill`. Fixture mode unchanged (in-file settlement aggregate).

### Anti-slop contract amendment (v3)

Green/red remain the only accents; red gains ONE additional sanctioned use: the Kalshi-mismatch warning line. All other items stand.

## Testing

- **ACIS (fixture):** recorded StnData response; range parsing, `"M"` missing handling, error → `AcisUnavailable`.
- **Store:** upsert idempotency (re-verify same day → no dupes), covered_dates, window/city stats math incl. hit-rate grouping, mismatch listing; temp-file DB per test.
- **Verifier:** monkeypatched clients — settle/score correctness against hand-computed Briers; skip-covered behavior; per-stage failure isolation; mismatch capture.
- **Kalshi/Open-Meteo additions:** event ticker formatting (timezone yesterday), `to_result`, `past_days` reduction across multiple dates.
- **Server:** verification block shape; top-up cap (≤3 dates per request); store-failure degradation to null.
- **CLI:** `backfill` invokes verifier with computed date range (monkeypatched), prints summary.
- **Frontend (Vitest):** ladder rows (ranges, percentages, underline bars, edge coloring, sort), footer variants (verified / mismatch / unverified), fixture-mode grouping, strip variants incl. `AWAITING VERIFICATION`.
- **Opt-in real-network test** extended: backfill 2 days for one city against real APIs, assert rows landed.
- **Anti-slop audit** with the amended red exception.
- **Implementation-time source check:** for one recent day per city, assert ACIS max equals the NWS CLI bulletin's max (manual step in the plan, reported).

## Success criteria

After `uv run edgecast backfill` and `uv run edgecast serve`: one ladder card per city with all buckets as rows; aggregate strip shows a verdict over ~30 days of stored verifications with Brier + hit rates for both sides; each city footer shows yesterday's official observed high, the settled bucket, and the city's 30-day record; a seeded Kalshi-result mismatch renders the red warning; suites green without network; audit passes.

## Model usage during implementation (per global CLAUDE.md)

Backend (registry, ACIS client, store, verifier, CLI, API) → gpt-5.5 codex exec xhigh with real-API verification steps. Frontend (CityCard, strip) + audit → fable-5 inline. Reviews: fable-5. Commits: user only.
