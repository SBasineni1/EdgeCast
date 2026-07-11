# CLAUDE.md

## Project
EdgeCast Forecast is a weather prediction-market intelligence backend for comparing market-implied probabilities against forecasts, model guidance, and realized observations.

## Stack
Python 3.11+, Pydantic, pytest, optional FastAPI, SQLite later, pandas/numpy only when needed. UI is handled separately.

## Commands
- Dev: `python scripts/demo_mock_markets.py`
- API dev: `uvicorn backend.main:app --reload`
- Build: `python -m compileall backend scripts tests`
- Test single: `pytest [path]`
- Test all: `pytest`
- Lint: `ruff check .`
- Type check: `mypy backend scripts`

## Architecture
- `backend/models/` → Pydantic models for markets, forecasts, observations, and verification results
- `backend/services/` → probability, verification, mock data, and future API service logic
- `backend/utils/` → unit conversion, time handling, and small shared helpers
- `scripts/` → runnable demos, data-fetch scripts, and local verification jobs
- `tests/` → pytest tests for probability, verification, models, and utilities
- `docs/` → methodology notes, API notes, settlement assumptions, and limitations
- `data/sample/` → tiny sample/mock data only; real data stays gitignored
- `backend/main.py` → optional FastAPI app exposing backend data for UI consumption

## Rules
- Start with mock temperature markets only; do not add real Kalshi/NWS/model API calls until the mock pipeline works.
- Keep UI out of scope unless explicitly requested.
- Never hardcode secrets, API keys, tokens, or credentials; never commit `.env`.
- Keep market data, forecast data, observations, and verification results as separate typed models.
- Keep probability and verification logic pure, small, and tested.
- Preserve timestamps: market time, forecast issued time, valid date, target date, observed time, and settled time.
- Preserve units, station/source, threshold, direction, and local date; do not assume city weather equals settlement-station weather.
- Use “model-market disagreement,” “verification,” and “calibration”; avoid financial-advice or guaranteed-profit language.
- Do not compare a market snapshot to a forecast issued after that snapshot.
- Do not use external APIs in tests.
- Make minimal changes; do not refactor unrelated files.
- IMPORTANT: point-in-time correctness matters more than making the numbers look good.

## Workflow
- Inspect the repo before editing and do not assume files exist.
- For new features, first add/adjust models, then services, then scripts/API, then tests.
- Run relevant tests after calculation changes; run all tests before calling work complete.
- Use small logical commits: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`.
- When unsure about architecture, choose the simplest mock-first approach and leave a clear extension point.
- Ask before adding major dependencies, databases, real API integrations, or UI frameworks.

## Out of scope
- Auto-trading, order execution, Kelly sizing, or portfolio management.
- Frontend/UI work unless explicitly requested.
- Real Kalshi, Polymarket, NWS, ECMWF, GFS, HRRR, Open-Meteo, or NOAA integrations in the first MVP.
- Large GRIB/NetCDF/model files, real historical archives, or production databases.
- Claims of profit, financial advice, or risk-free opportunities.