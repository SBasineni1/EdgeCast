# EdgeCast v4: Consensus Prediction + Day-Ahead Model Grading — Design

**Date:** 2026-07-03 (revised 2026-07-04: added NBM + consensus engine)
**Status:** Approved direction; spec for implementation planning.

## Goal

Two linked pieces:

1. **Grade weather models against the official observed high at day-ahead lead** — the
   moment the forecast is actually tradeable — per city and overall.
2. **Use that grading to predict better.** The ladder's model probability becomes a
   **consensus**: the per-city bias-corrected blend of NBM + HRRR + GFS, with bucket
   probabilities calibrated by the consensus's own measured error spread. This replaces
   the raw GEFS ensemble, whose spread is not calibrated to these stations (user
   observed 2/7 bucket hits on a live day).

Evidence (probed 2026-07-04, 30 days × 7 cities, out-of-sample trailing-bias):

| strategy | MAE °F | within 1°F |
|---|---|---|
| best raw single model (NBM) | 2.11 | 31% |
| each model debiased per city | 1.71–1.83 | 38–44% |
| 3-model blend, debiased | **1.48** | 41% |

Raw models are roughly tied overall but have large, stable per-city biases (GFS +4.4°F
warm at NYC; NBM ~1–2°F cool most cities) — bias correction plus blending is the win.

Not trading automation. No order execution, sizing, or financial-advice language.

## Why day-ahead

The freshest-run hindcast used by v3 grades a nearly same-day forecast, which measures
nowcasting, not the model skill available when tomorrow's ladder is live. Grading the
run issued the day before answers: "when I look at tomorrow's markets tonight, how much
should I trust this model?"

## Models

| Store id | Display | Open-Meteo model | Update cadence | Why |
|---|---|---|---|---|
| `ncep_nbm_conus` | NBM | `ncep_nbm_conus` | hourly | NWS's own calibrated blend, user-requested |
| `gfs_hrrr` | HRRR | `gfs_hrrr` | hourly (48 h horizon) | high-res CONUS, user-requested |
| `gfs_global` | GFS | `gfs_global` | every 6 h | baseline global model |
| `consensus` | CONSENSUS | (derived) | recomputed each fetch | debiased blend of the three; the ladder's prediction |

- All three source models are deterministic point forecasts here (NBM is built from
  ensembles upstream but Open-Meteo exposes the single blended value).
- **GEFS ensemble (`gfs_seamless`) is dropped from the live ladder.** The ensemble
  client remains only where v3's verification pipeline already uses it; no new use.
- ECMWF: excluded (heat bias, user decision). RRFS: future, when Open-Meteo carries it.
- v3's market-verification store (`verifications` table) is unchanged and keeps
  running: it is the Kalshi settlement audit (mismatch warnings).

## Consensus definition

For a city and event date, given each source model's predicted high `p_m`:

- **Trailing bias** `b_m` = mean signed error of model `m` for this city over its last
  15 graded day-ahead days in `model_days` (rows strictly before the event date). If a
  model has fewer than 5 graded days, `b_m = 0`.
- **Consensus point** = mean of `(p_m − b_m)` over the models with data (≥1 required;
  fewer than 3 is fine — use what's available).
- **Error spread** `σ` = population stdev of the consensus's own signed errors over its
  last 15 graded days for this city, floored at 1.0 °F. Fewer than 5 graded consensus
  days → σ = 2.5 °F (≈ raw-model MAE, deliberately wide until calibrated).
- **Bucket probability** = Normal(consensus, σ) mass on the bucket's continuous range,
  using integer-settlement boundaries: a `between 95 96` bucket ("95° to 96°") is
  [94.5, 96.5); `greater 100` ("101° or above") is (100.5, ∞); `less 93` ("92° or
  below") is (−∞, 92.5). Φ via `math.erf` — no new dependencies.

The consensus is graded daily exactly like the source models (stored as
`model = "consensus"` in `model_days`), so its bias/σ calibration and its scoreboard
line come from the same rows. Backfilling consensus for a past date uses only
information available before that date (trailing biases from prior rows) — no
lookahead.

## Data sources (probed 2026-07-03/04, all working)

1. **Day-ahead archived forecasts** — Open-Meteo Previous Runs API:
   `GET https://previous-runs-api.open-meteo.com/v1/forecast`
   params: `latitude, longitude, hourly=temperature_2m_previous_day1,
   models=ncep_nbm_conus,gfs_hrrr,gfs_global, temperature_unit=fahrenheit,
   timezone=<station tz>, start_date, end_date`. Multi-model responses key series as
   `temperature_2m_previous_day1_<model>`. Verified non-null 30 days back for all
   three models.
2. **Live point forecasts** — standard forecast API:
   `GET https://api.open-meteo.com/v1/forecast` with
   `models=ncep_nbm_conus,gfs_hrrr,gfs_global, hourly=temperature_2m,
   forecast_days=2`, same units/tz — one call per city covers all three models.
   Reduced to per-model predicted highs for the event date.
3. **Observed truth** — ACIS (unchanged): official NWS/NOAA daily max, `KAUS KNYC KMDW
   KMIA KDEN KPHL KLAX`.
4. **Bucket structure** — Kalshi settled event markets (unchanged client).

## Grading definitions

For each (model, city, event_date) — including `consensus`:

- `predicted_high` = the model's day-ahead predicted high (max of `previous_day1`
  hourly temps on the local date; for consensus, the debiased blend of those).
- `observed_high` = ACIS maxt.
- `error` = predicted_high − observed_high (signed; positive = ran warm).
- `abs_error` = |error|.
- **Bucket hit**: round the prediction to a whole degree, `predicted_int =
  floor(predicted_high + 0.5)` (Kalshi bins cover integer reported temps; a raw 96.4°F
  would otherwise fall between the [95,96] and [97,98] bins). `bucket_hit = 1` iff
  `predicted_int` satisfies the market that settled `yes` for that city/date
  (via existing `satisfies_market`); `0` otherwise; `NULL` when no yes-settled market
  is available (Kalshi fetch failed / no event) — the °F error is still stored.

Aggregates (overall and per city, over the window):
`n_days`, `mae` = mean abs_error, `bias` = mean error, `bucket_hit_rate` = mean of
non-NULL bucket_hit (NULL if none).

## Storage

New table in the same SQLite DB (`data/edgecast.db`):

```sql
CREATE TABLE IF NOT EXISTS model_days (
  model TEXT NOT NULL,            -- "ncep_nbm_conus" | "gfs_hrrr" | "gfs_global" | "consensus"
  lead TEXT NOT NULL,             -- "day_ahead" (seam for "same_day" later)
  city TEXT NOT NULL,
  series TEXT NOT NULL,
  event_date TEXT NOT NULL,       -- ISO date
  predicted_high REAL NOT NULL,
  observed_high REAL NOT NULL,
  error REAL NOT NULL,
  abs_error REAL NOT NULL,
  bucket_hit INTEGER,             -- 1 | 0 | NULL
  observed_source TEXT NOT NULL,  -- "ACIS KAUS"
  model_source TEXT NOT NULL,     -- "open-meteo ncep_nbm_conus previous_day1" | "consensus(nbm,hrrr,gfs)"
  verified_at TEXT NOT NULL,
  PRIMARY KEY (model, lead, city, event_date)
);
```

## Pipeline & API

- **Backfill**: `edgecast backfill --days 30` additionally fills `model_days` for the
  three source models and consensus at `day_ahead` lead, in date order (consensus for
  date D needs source-model rows before D). Idempotent: covered (model, lead, city,
  date) skipped. Summary line reports both stores. Failures isolated per
  city/date/stage as in v3.
- **Serve top-up**: `/api/live` tops up missing `model_days` dates alongside the
  existing market-verification top-up (same ≤3-date bound; failures never break the
  live response).
- **Live ladder probability**: the analysis pipeline's model-implied probability for
  each market becomes the consensus Normal-mass on that market's bucket (replacing
  GEFS member counting). Trailing bias and σ come from the `model_days` store at
  request time; live per-model highs from the forecast API (cached with the existing
  1800 s TTL).
- **`/api/live` response**:
  - `live` block gains `model_highs: {city: {ncep_nbm_conus: number | null,
    gfs_hrrr: ..., gfs_global: ..., consensus: ...}}` and
    `consensus_sigma: {city: number | null}`.
  - New top-level `model_grades` block:
    ```json
    {
      "window_days": 30, "lead": "day_ahead",
      "overall": {"consensus": {"n_days": 28, "mae": 1.5, "bias": 0.1, "bucket_hit_rate": 0.41},
                   "ncep_nbm_conus": {...}, "gfs_hrrr": {...}, "gfs_global": {...}},
      "by_city": {"NYC": {"consensus": {...}, "ncep_nbm_conus": {...}, ...}, ...}
    }
    ```
  - `verification` block: keeps `kalshi_mismatches`, `verification_failed`,
    `window_days`; **drops `yesterday` and the market-vs-model verdict fields** from
    the response (user: hindsight market comparison and yesterday line don't matter).
    The v3 table/stats remain in the DB.

## Dashboard

- **CityCard header**: shows the consensus predicted high (e.g. `CONSENSUS 96.2°`)
  with the three raw model values in smaller muted text (e.g. `NBM 96.4 · HRRR 98.0 ·
  GFS 102.2`); the ladder row whose bucket contains `floor(consensus + 0.5)` gets a
  subtle text marker (no new colors).
- **CityCard footer**: YESTERDAY line and `BRIER MKT/MDL` line removed. Replaced by one
  readable line per model — consensus first, then the three sources — plain words, no
  bare decimals-without-context, e.g.:
  `CONSENSUS · OFF BY 1.5°F · RIGHT BUCKET 41% · RUNS +0.1° WARM`
  `NBM · OFF BY 2.1°F · RIGHT BUCKET 31% · RUNS −1.0° COOL`
  Exact copy finalized at implementation (taste pass); content requirements: MAE,
  bucket-hit %, signed bias in words. Kalshi mismatch warning (red) stays.
- **Aggregate strip (live)**: per-model summary (MAE °F, bucket hit %) for consensus +
  sources, plus a verdict naming the closest model over the window — closest = lowest
  overall MAE, ties by higher bucket_hit_rate, then `MODELS TIED`
  (e.g. `CONSENSUS CLOSER · DAY-AHEAD · LAST 30 DAYS`). Fixtures mode unchanged.
- **MODEL column** in the ladder now reads from the consensus probabilities; edge
  computation (market vs model) is otherwise unchanged.

## Testing

- Unit (offline, fixture-driven): multi-model previous-runs reduction to per-model
  daily highs; trailing bias/σ math incl. <5-day fallbacks and no-lookahead ordering;
  Normal bucket mass at integer-settlement boundaries (between/greater/less, strict
  comparators); bucket-hit rounding boundaries (95.5→96 hits [95,96]; 96.6→97 hits
  [97,98]); store upsert/coverage/stats incl. NULL bucket_hit handling; server
  model_grades block + top-up; frontend footer/strip/header-marker tests. Real
  recorded multi-model fixture from the Previous Runs API committed under
  `tests/fixtures_live/`.
- End-to-end (final task): real 30-day backfill (expect ~30 days × 7 cities × 4 model
  rows), spot-check one (model, city, date) prediction against the API by hand and
  confirm consensus MAE ≈ 1.5 °F (matches the probe), live browser check, anti-slop
  audit.

## Non-goals (deferred, user-requested for later)

- **Per-day verification view**: a tab/page listing each past day — the day-ahead
  forecasts vs what verified (observed high, settled bucket, per-model errors). The
  `model_days` table built here is exactly the data source; UI comes in a later phase.
- **Productization**: shipping this as a product (hosting, accounts, polish) is a
  stated future goal; nothing in v4 should preclude it, but no product work now.
- Same-day lead (schema seam only), RRFS, ECMWF.
- Per-model regression weighting or fancier calibration (start with equal-weight
  debiased mean; revisit with more graded history).
- Pre-settlement market price snapshots (future: honest market-vs-model comparison).
- Any trading automation.
