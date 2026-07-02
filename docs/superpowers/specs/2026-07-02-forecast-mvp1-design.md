# EdgeCast Forecast — MVP 1 Design: Mock Pipeline

**Date:** 2026-07-02
**Status:** Approved design, pre-implementation

## Purpose

EdgeCast Forecast is a weather prediction-market intelligence system. It compares market-implied probabilities against forecast-model-implied probabilities and realized weather observations. The goal is verification, calibration, and model-market disagreement analysis — **not** trading automation.

MVP 1 proves this pipeline end-to-end on mock data:

```
mock weather market
→ market-implied probability
→ model-implied probability
→ model-market disagreement / edge
→ optional settlement verification
→ Brier score
→ structured JSON output
```

## Scope

**In scope**

- Binary (yes/no) threshold markets only, e.g. "NYC high temp ≥ 90°F on 2026-07-05" priced 0–1.
- Model probabilities derived from mock ensemble forecasts (a list of simulated member values).
- Edge/disagreement metrics between market and model probabilities.
- Settlement of markets with observations, and Brier scoring of both sides.
- A CLI that reads a scenarios JSON file and emits structured JSON results.
- Checked-in sample fixtures and a pytest suite.

**Out of scope (explicitly excluded)**

- UI of any kind.
- Real API integrations (Kalshi, NWS, GEFS, etc.).
- Auto-trading, order execution, Kelly sizing, portfolio logic, or financial-advice language.
- Multi-bucket/range markets (MVP 2 candidate — a bucket is a pair of binary thresholds).
- De-vigging / bid-ask handling (single mock price has no vig; function boundary reserved).
- Persistence (SQLite verification history is an MVP 2 candidate).
- Calibration curves / reliability diagrams (need many settled samples; future).

## Architecture

Scenario-based batch pipeline. Input JSON contains a list of *scenarios*; each scenario explicitly bundles one market quote, one ensemble forecast, and optionally one observation. Explicit bundling avoids market↔forecast matching logic, which only matters once live APIs exist.

Each stage is a pure function over frozen dataclasses — no I/O, no shared state:

```
scenario
 ├─ market.py      market quote (yes_price)        → market-implied probability
 ├─ forecast.py    ensemble members                → model-implied probability
 ├─ edge.py        the two probabilities           → disagreement metrics
 └─ settlement.py  observation (if present)        → outcome + Brier scores
        ↓
 pipeline.py  orchestrates scenarios, aggregates settled results
        ↓
 cli.py       `edgecast analyze scenarios.json` → structured JSON out
```

### Package layout

```
EdgeCast/
├── pyproject.toml            # uv-managed; pytest
├── src/edgecast/
│   ├── types.py              # frozen dataclasses: MarketQuote, EnsembleForecast,
│   │                         #   Observation, Scenario, and result types
│   ├── market.py
│   ├── forecast.py
│   ├── edge.py
│   ├── settlement.py
│   ├── pipeline.py
│   └── cli.py
├── fixtures/
│   └── scenarios_sample.json # ~6 scenarios: clear edge both directions,
│                             #   agreement, settled right/wrong, unsettled
└── tests/                    # unit tests per stage + one end-to-end CLI test
```

## Math definitions

**Market-implied probability** (`market.py`): the YES price, taken directly (price 0.72 → probability 0.72). De-vigging deliberately deferred; this function is the seam where it lands later.

**Model-implied probability** (`forecast.py`): fraction of ensemble members satisfying the market's comparator/threshold. Raw fractions of finite ensembles can hit exactly 0.0 or 1.0, which breaks log-odds math and asserts false certainty, so the probability is clamped to `[1/(n+1), n/(n+1)]` where n = member count (n=30 → [0.032, 0.968]). Output reports both `model_prob_raw` (unclamped) and `model_prob` (clamped), plus `n_members`.

**Edge / disagreement** (`edge.py`):

- `edge = model_prob − market_prob` (signed; positive = model thinks YES more likely than market).
- `log_odds_diff = logit(model_prob) − logit(market_prob)` — magnifies meaningful moves near 0 and 1.
- `flag`: `"model_higher"` / `"market_higher"` / `"agreement"`, using threshold |edge| ≥ 0.05 (configurable via CLI flag `--edge-threshold`).

No sizing, no bet recommendations, no financial language — labeled strictly as disagreement.

**Settlement & Brier** (`settlement.py`): outcome = comparator applied to observed value (observed 93.1 ≥ 90 → outcome 1). Brier per side: `(prob − outcome)²`; lower is better. Per-market `brier_diff = brier_model − brier_market` (negative = model better). The clamped `model_prob` is used for scoring, keeping scoring consistent with the reported probability. Scenarios without observations skip this stage (`settlement: null`) but still get edge analysis.

**Aggregate** (`pipeline.py`): over settled scenarios only — counts, mean Brier per side, and `better_calibrated: "model" | "market" | "tie"`.

## JSON contracts

### Input (`fixtures/scenarios_sample.json`)

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
        "members": [88.5, 91.2, 90.1]
      },
      "observation": { "observed_value": 93.1 }
    }
  ]
}
```

`observation` is optional; omit it for unsettled scenarios. `members` holds ~30 values in real fixtures.

### Output

```json
{
  "schema_version": "1.0",
  "generated_at": "2026-07-02T18:00:00Z",
  "results": [
    {
      "scenario_id": "nyc-high-2026-07-05",
      "market_prob": 0.72,
      "model_prob": 0.80,
      "model_prob_raw": 0.80,
      "n_members": 30,
      "edge": { "value": 0.08, "log_odds_diff": 0.44, "flag": "model_higher" },
      "settlement": {
        "outcome": 1,
        "observed_value": 93.1,
        "brier_market": 0.0784,
        "brier_model": 0.04,
        "brier_diff": -0.0384
      }
    }
  ],
  "aggregate": {
    "n_scenarios": 6,
    "n_settled": 4,
    "mean_brier_market": 0.11,
    "mean_brier_model": 0.07,
    "better_calibrated": "model"
  }
}
```

Written to stdout by default; `--output <path>` writes to a file.

## CLI

```
edgecast analyze <scenarios.json> [--output <path>] [--edge-threshold 0.05]
```

Exposed via a `pyproject.toml` entry point. `analyze` is a subcommand so later verbs (e.g. `settle`, `report`) slot in without breaking the interface.

## Error handling

Strict validation at load time: `yes_price` in [0,1], non-empty `members`, comparator in `{>=, >, <=, <}`, ISO dates, required fields present, unique `scenario_id`s. Any invalid scenario fails the whole run with a message naming the scenario and field; exit code ≠ 0. No partial/best-effort output in MVP 1 — fixtures are hand-authored, so errors mean typos, and silence would hide them.

## Testing

pytest, written TDD-style:

- **Unit, per stage:** probability math; clamping bounds (all-members-yes, all-members-no, empty rejection); edge signs and flag thresholds; log-odds known values; Brier known values (perfect, worst, 0.5); settlement under each comparator including boundary equality (observed exactly at threshold).
- **Validation:** each rejection rule produces a clear error naming scenario and field.
- **End-to-end:** run the CLI against the sample fixture; assert output structure, key computed values, and aggregate correctness. Timestamp field excluded from exact matching.

## Model usage during implementation (per global CLAUDE.md)

Planning and review: fable-5 / opus-4.8. Bulk implementation: gpt-5.5 via `codex exec` (self-contained prompts). Commits are made by the user only — no auto-commits, no Claude attribution.

## Success criteria

`uv run edgecast analyze fixtures/scenarios_sample.json` produces valid JSON with per-scenario probabilities, edge metrics, settlement + Brier where observations exist, and a correct aggregate — with all tests passing.
