# EdgeCast

Weather prediction-market intelligence. EdgeCast compares what [Kalshi](https://kalshi.com)'s daily
high-temperature markets are pricing against what weather models predict for the same buckets, and
grades everything against the official NWS observations that settle those markets.

**Research tool, not trading automation.** No order execution, no sizing, no financial advice —
just probabilities, verification, and honest scorekeeping.

## What it does

- **Live ladder, 20 cities.** Every Kalshi daily-high bucket for each city, side by side:
  market-implied probability, model-implied probability, and the edge between them.
- **Consensus forecast.** The model probability comes from an equal-weight blend of
  **NBM + HRRR + GFS**, after each model is corrected for its recent lean at that exact station
  (its mean signed error over the last 15 graded days). Bucket probabilities come from a normal
  distribution centered on the consensus whose width is the consensus's own recent error spread
  in that city — tight where it's been sharp, wide where it hasn't.
- **Day-ahead model grading.** Every day, the forecast each model issued *the day before* is graded
  against the official observed high: error in °F, and whether the rounded forecast landed in the
  bucket that settled YES ("right bucket"). Grades feed both the dashboard and the consensus's
  bias/spread calibration.
- **Settlement audit.** Independently recomputes past market outcomes from official observations
  and flags any disagreement with Kalshi's settlements.

### Does the blend actually help?

30 days × 20 cities, day-ahead lead, graded vs official observations:

| model | MAE | bias | right bucket |
|---|---|---|---|
| **Consensus** | **1.67°F** | +0.16 | **38.7%** |
| NBM | 2.07°F | −0.91 | 31.5% |
| HRRR | 2.16°F | −0.20 | 35.5% |
| GFS | 2.71°F | +0.74 | 26.8% |

Raw models carry large, stable per-station biases (GFS runs several degrees warm at NYC; NBM runs
cool almost everywhere). Removing each model's local lean before averaging is worth ~0.5–1°F of MAE.

## Quickstart

Requires Python ≥ 3.12, [uv](https://docs.astral.sh/uv/), and Node for the frontend.

```bash
uv sync --extra server          # python deps
cd web && npm install && npm run build && cd .

uv run edgecast backfill --days 30   # grade the last 30 days (network: Kalshi, Open-Meteo, ACIS)
uv run edgecast serve                # dashboard at http://127.0.0.1:8000
```

The ladder refreshes every 60 s. The server tops up missing verification days automatically
(bounded per request), so the backfill only needs to run once; click the `?` in the header for a
guide to every number on screen.

### CLI

```
edgecast serve     [--port 8000] [--db data/edgecast.db] [--verify-days 30]
edgecast backfill  [--days 30]   [--db data/edgecast.db]
edgecast analyze   scenarios.json [--edge-threshold 0.05]   # offline pipeline on a scenarios file
```

### Tests

```bash
uv run pytest -q            # backend (offline; fixtures recorded from the real APIs)
cd web && npx vitest run    # frontend
```

## How the grading works

For each (model, city, day) at day-ahead lead:

- `error` = predicted high − observed high (positive = ran warm); `OFF BY` is the 30-day mean |error|.
- **Right bucket**: round the prediction to a whole degree (Kalshi settles on integer temps) and
  check whether it satisfies the market that settled YES. Strict comparators per Kalshi semantics:
  "greater 100" pays at 101°+, "less 93" pays at 92°−.
- The consensus is graded exactly like the source models, with no lookahead: its bias corrections
  for a given day use only rows from earlier days.

Everything lands in SQLite (`data/edgecast.db`): `model_days` (model grading) and
`verifications` (market settlement audit).

## Data sources

| source | used for |
|---|---|
| Kalshi public API | market prices, bucket structure, settled results |
| Open-Meteo forecast API | live NBM / HRRR / GFS point forecasts |
| Open-Meteo previous-runs API | archived day-ahead forecasts (deep history for grading) |
| NOAA/NWS ACIS | official observed daily highs — the settlement truth |

### Stations (verified, not assumed)

Kalshi settles on specific NWS stations, and the obvious guess is sometimes wrong. Every station in
the registry was verified empirically — its ACIS observations must match Kalshi's actual settled
buckets across multiple days. Traps caught so far: **Austin settles on Bergstrom** (not Camp Mabry),
**Houston on Hobby** (not Intercontinental), **Dallas on DFW** (not Love Field), **DC on Reagan
National** (not Dulles/BWI).

Full registry: `src/edgecast/live/stations.py` — 20 cities: NYC, Chicago, Miami, Austin, Denver,
Philadelphia, LA, Seattle, DC, Minneapolis, OKC, San Francisco, Atlanta, Dallas, New Orleans,
Las Vegas, Phoenix, Boston, San Antonio, Houston.

## Project layout

```
src/edgecast/
  live/            Kalshi, Open-Meteo, ACIS clients + station registry
  consensus.py     bias/spread math, normal bucket probabilities
  grade.py         day-ahead grader (models + consensus)
  model_store.py   model_days SQLite store
  verify.py        market settlement audit
  server.py        FastAPI: /api/live + dashboard
web/               React 19 + Vite + Tailwind v4 + GSAP dashboard
docs/superpowers/  design specs and implementation plans
```

## Roadmap

- **Per-day verification view** — a day-by-day breakdown: what each model said the night before
  vs what verified and which bucket paid.
- **Pre-settlement market snapshots** — record prices *before* settlement so market-vs-model
  calibration can be compared honestly (settled last-prices always look perfect in hindsight).
- **More predictors** — the grading harness makes adding a model one line plus verification:
  candidates include RRFS (when Open-Meteo carries it), ECMWF (currently excluded for heat bias —
  but grading would quantify it), ICON, GEM, and AI models like GraphCast.
- **Weighted consensus** — replace the equal-weight debiased mean with skill-weighted or
  regression-based blending once enough graded history accumulates.
- **Same-day lead** — grade and trade intraday forecast updates (the schema already carries a
  `lead` column for this).

## Disclaimer

EdgeCast is a research and verification tool. Nothing here is financial advice, and nothing here
places trades.
