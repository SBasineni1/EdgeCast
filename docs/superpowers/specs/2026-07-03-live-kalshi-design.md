# EdgeCast v2 Design: Live Kalshi Mode + UI Refinements

**Date:** 2026-07-03
**Status:** Approved design, pre-implementation
**Depends on:** MVP 1 pipeline and Dashboard v1 (both complete, uncommitted in working tree).

## Purpose

Replace the sample-fixtures-only dashboard with a live view: real Kalshi weather-market prices vs real GEFS ensemble forecast probabilities, for every Kalshi daily-high-temperature location, refreshed automatically. Plus two UI refinements: directional edge colors (green up / red down) and prominent, readable locations.

Still out of bounds: trading automation, order execution, sizing, financial-advice language. This is verification/disagreement intelligence only.

## Scope

**In scope**

- Directional edge-flag colors replacing signal orange; updated anti-slop contract.
- Card redesign: location-first header, big threshold text, city grouping.
- New `between` condition in the pipeline (inclusive range) for Kalshi's middle buckets.
- `edgecast/live/` package: Kalshi public-API client, Open-Meteo ensemble client, scenario assembly.
- `GET /api/live` endpoint with upstream caching; frontend LIVE/FIXTURES toggle, 60s auto-refresh, staleness stamp, upstream-error strip.
- Recorded-fixture tests for live modules; opt-in real-network integration test; frontend tests; anti-slop audit.

**Out of scope (v3 candidates)**

- Settlement/Brier in live mode (live markets are unsettled today; verification-over-time needs stored history).
- KXLOW (daily low) and non-temperature series.
- WebSocket/SSE push; API keys; rate-limit backoff beyond simple caching; persistence.

## UI changes

### Directional edge colors (replaces signal orange everywhere)

- `model_higher`: `▲ +0.08 MODEL HIGHER` in green `#2ECC71`, text glow `0 0 8px rgba(46, 204, 113, 0.45)`.
- `market_higher`: `▼ −0.15 MARKET HIGHER` in red `#FF4D4D`, text glow `0 0 8px rgba(255, 77, 77, 0.45)`.
- `agreement`: unchanged dim `— AGREEMENT`.
- Theme tokens: `--color-up: #2ecc71`, `--color-down: #ff4d4d` replace `--color-signal`.

**Anti-slop contract amendment:** "exactly one accent color (orange), edge flags only" becomes "exactly two accent colors — up-green `#2ECC71` and down-red `#FF4D4D` — used ONLY in edge flags (arrow, value, direction word, glow). Nothing else on screen may be green or red." All other contract items stand (no gradients, shadows beyond the two sanctioned glows, emoji, rounded corners, spinners, purple, dashboard furniture).

### Location-first cards and grouping

- Card header becomes: line 1 — `NYC · HIGH TEMP` (bold, letterspaced, text-1) with date right-aligned; line 2 — the threshold as the card's dominant text (`≥ 96°F`, `≤ 87°F`, or `88–89°F`, ~2xl mono); line 3 — the full market question, dim and small (`text-3`).
- The grid groups cards by city: a hairline-underlined section header per location (`NEW YORK — KXHIGHNY`, with resolved station name dim beside it), cards for that city's buckets beneath, sorted by threshold ascending.
- Fixture mode renders through the same components (fixture scenarios carry `location`; grouping just has fewer cities).

## Pipeline extension: `between`

- Input market objects may now use `"comparator": "between"` with `"threshold_low"` and `"threshold_high"` (both required, numbers, `low <= high`) instead of `"threshold"`. Existing binary comparators unchanged.
- Between is inclusive on both ends: YES iff `threshold_low <= value <= threshold_high`. This matches Kalshi's own bucket definition — a "between" market carries `floor_strike` and `cap_strike` and settles YES iff `floor_strike <= T <= cap_strike` — and we store those two strike values verbatim as `threshold_low`/`threshold_high`, no adjustment.
- Model probability: fraction of ensemble members inside the range, clamped as before. Settlement (fixture mode): outcome by the same rule.
- `MarketQuote` gains `threshold_low`/`threshold_high` as optional fields; `threshold` becomes optional (exactly one shape must be present, enforced at validation). Output `market` block includes whichever shape the market has. Output schema version bumps to `"1.2"`; input schema accepts both shapes under `"1.0"` (additive).

## Live data package (`src/edgecast/live/`)

### `stations.py`

Checked-in registry: series ticker → `{city: "NYC", station: "Central Park", lat, lon, tz}`. Initial set = Kalshi's KXHIGH series at design time: `KXHIGHNY` (NYC/Central Park), `KXHIGHCHI` (Chicago/Midway), `KXHIGHMIA` (Miami/MIA), `KXHIGHAUS` (Austin/Camp Mabry), `KXHIGHDEN` (Denver/DIA), `KXHIGHPHIL` (Philadelphia/PHL), `KXHIGHLAX` (LA/USC). The implementation task verifies this list against the live `/series` API and adjusts; unknown new series simply don't appear until added to the registry.

### `kalshi.py`

- `fetch_markets(series_ticker) -> list[dict]`: GET `https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=…&status=open` (public, no auth), paginated via cursor.
- `to_quote(market: dict) -> MarketQuote | None`: maps `strike_type` "greater"/"greater_or_equal" → `>=`-shaped (using the API's strike fields), "less"/"less_or_equal" → `<=`, "between" → between-shaped with floor/cap strikes; price = `last_price` in cents / 100, falling back to bid/ask midpoint when `last_price` is 0/absent; skips (returns None, logged) markets with no usable price or price outside (0,1), and unknown strike types.
- Event date parsed from the market's close/expiration metadata.

### `openmeteo.py`

- `fetch_ensemble_high(lat, lon, event_date, tz) -> EnsembleForecast`: GET `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=…&longitude=…&hourly=temperature_2m&models=gfs_seamless&temperature_unit=fahrenheit&timezone=…` (free, no auth); for each ensemble member, take the max hourly temperature within the event's local calendar date → one member value. ~31 members.

### `assemble.py`

- `build_live_scenarios(edge_threshold) -> list[Scenario]`: for each registry series — fetch markets, fetch that station's ensemble once, pair every usable market with the ensemble into `Scenario`s (`scenario_id` = market ticker; no observation). Cities with an upstream failure are skipped and reported (see API errors). Returns scenarios + per-source staleness metadata.

## API

### `GET /api/live?edge_threshold=0.05`

Response: the standard analysis output (schema 1.2) plus a `live` block:

```json
{
  "schema_version": "1.2",
  "generated_at": "…",
  "results": [ … ],
  "aggregate": { … },
  "live": {
    "fetched_at": "…",
    "cities_ok": ["NYC", "CHI"],
    "cities_failed": [{"city": "MIA", "reason": "kalshi: HTTP 503"}],
    "quotes_age_seconds": 12,
    "ensembles_age_seconds": 640,
    "cities": {"NYC": {"name": "New York", "station": "Central Park", "series": "KXHIGHNY"}}
  }
}
```

- Caching (in-process, per-series): Kalshi quotes TTL 30s; ensembles TTL 30min. A request within TTL reuses cache; expired entries refetch. Upstream failure with a cached value → serve stale, mark the age; failure with no cache → that city goes to `cities_failed`.
- All cities failed / registry empty → 502 with `{"detail": "no live data available: …"}`.
- `edge_threshold` validated as in `/api/analyze` (422 outside [0,1]).
- `/api/analyze` and fixture behavior unchanged (aside from schema 1.2 output).
- Server keeps binding 127.0.0.1; timeouts on upstream calls (5s Kalshi, 10s Open-Meteo); no retries in v2 beyond serving stale cache.

## Frontend behavior

- Command bar gains a `LIVE / FIXTURES` mode toggle (segmented, same styling as the file picker). Default: LIVE. In FIXTURES mode everything behaves exactly as v1.
- LIVE mode: fetch `/api/live` on entry and every 60s; manual `ANALYZE ▸` triggers an immediate refresh (the 60s cadence continues). While a refresh is in flight, previous data stays; command bar shows `ANALYZING…` dim text as today.
- Staleness stamp in the command bar: `UPDATED 12:04:31` (dim, mono, from `fetched_at`).
- Upstream degradation: `cities_failed` non-empty → in-theme strip under the command bar: `UPSTREAM PARTIAL — MIA (kalshi: HTTP 503)`. Full failure (502) → same strip, `UPSTREAM UNREACHABLE — retrying in 60s`, last good data stays on screen. Server itself unreachable → existing `SIGNAL LOST` screen.
- Aggregate strip in live mode: settlement stats read `—` and the verdict reads `AWAITING SETTLEMENTS` (already implemented for n_settled = 0).

## Testing

- **Pipeline:** `between` condition unit tests (inside/outside/boundary-equality both ends, low==high, validation rejections: missing one bound, low > high, both shapes present, neither shape present).
- **Live modules (pytest, no network):** recorded JSON fixtures under `tests/fixtures_live/` for one Kalshi markets page and one Open-Meteo ensemble response; tests cover quote mapping per strike type, price fallback and skip rules, daily-max member reduction across the local date, assembly pairing, and cache TTL behavior (time monkeypatched).
- **API:** `/api/live` happy path (upstream clients monkeypatched), partial failure, total failure 502, threshold validation.
- **Opt-in integration:** `EDGECAST_LIVE_TESTS=1 uv run pytest tests/test_live_integration.py` hits the real APIs and asserts shape, not values.
- **Frontend (Vitest):** edge flag renders green class/glow for model_higher and red for market_higher; grouping renders one section per city sorted A→Z; mode toggle switches endpoints; staleness stamp renders; upstream strips render for partial and total failure.
- **Anti-slop audit:** rerun the full contract with the two-accent amendment (grep: green/red appear only in edge-flag code and tokens; orange gone).

## Success criteria

With the network up, `uv run edgecast serve` opens in LIVE mode showing every registry city's open Kalshi buckets — real prices vs real ensemble probabilities, green/red edges, grouped by prominent city headers — auto-refreshing every 60s with a visible `UPDATED` stamp. Killing the network mid-session degrades to the in-theme upstream strip with last data intact. FIXTURES mode still renders the sample file exactly as v1 did (with new colors/layout). Full pytest + Vitest suites green without network; audit passes.

## Model usage during implementation (per global CLAUDE.md)

Backend (pipeline `between`, live package, API, tests) → gpt-5.5 via `codex exec`, xhigh. Frontend + integration verify + anti-slop audit → fable-5 inline. Reviews: fable-5. Commits: user only, no attribution.
