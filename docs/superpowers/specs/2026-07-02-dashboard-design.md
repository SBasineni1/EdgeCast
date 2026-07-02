# EdgeCast Forecast — Dashboard v1 Design: Meteorological Terminal

**Date:** 2026-07-02
**Status:** Approved design, pre-implementation
**Depends on:** MVP 1 pipeline (`docs/superpowers/specs/2026-07-02-forecast-mvp1-design.md`), complete.

## Purpose

A local web app that visualizes EdgeCast analyses: market vs model probabilities, edge flags, settlement verification, and aggregate Brier calibration. The user runs one command, the browser opens an instrument panel, and analyses re-run live as they switch scenario files or adjust the edge threshold.

Product intent: this is v1 of the real product surface. The frontend must be deployable later (e.g., Vercel) unchanged; only the API host would change.

## Scope

**In scope**

- FastAPI server wrapping the existing pipeline (no pipeline changes).
- `edgecast serve` CLI subcommand.
- React + Vite + Tailwind v4 + TypeScript frontend in `web/`, custom components only.
- View + re-run: switch scenario files, adjust edge threshold, re-run live.
- The "meteorological terminal" visual system (below), with an explicit anti-slop contract.
- Backend endpoint tests (pytest) and frontend component tests (Vitest).

**Out of scope**

- Creating/editing scenarios in the UI (v2 candidate).
- Real market/weather data, auth, hosting, persistence.
- Charts beyond the bespoke probability bars and calibration figures (no chart library).
- Mobile-first layouts (must not break on a narrow window, but desktop is the target).

## Architecture

```
uv run edgecast serve [--port 8000] [--fixtures-dir fixtures]
        │
        ├─ FastAPI (src/edgecast/server.py)
        │    ├─ GET  /api/scenario-files      → list *.json in fixtures dir
        │    ├─ POST /api/analyze             → run pipeline, return results JSON
        │    └─ GET  /                        → serve web/dist/ static build
        │
        └─ React app (web/)
             ├─ CommandBar    (file picker · threshold stepper · ANALYZE ▸)
             ├─ AggregateStrip (oversized stats + calibration verdict)
             └─ MarketCard grid (per-scenario instrument cards)
```

### Backend (`src/edgecast/server.py`)

- `GET /api/scenario-files` → `{"files": ["scenarios_sample.json", ...]}`. Non-recursive listing of `*.json` in the fixtures directory, sorted by name. Empty list is a valid response.
- `POST /api/analyze` with body `{"file": "<name.json>", "edge_threshold": 0.05}`:
  - Resolves `file` strictly within the fixtures directory (reject path traversal: any `file` containing a path separator or resolving outside the fixtures dir → 400).
  - `edge_threshold` optional, defaults to 0.05; must be a number in [0, 1] → else 422.
  - Runs `read_scenarios_file` → `analyze` → `build_output` and returns that JSON verbatim (same schema as the CLI; `generated_at` = current UTC time).
  - **Additive output-schema change (also affects the CLI):** each result gains a `market` block — `{question, location, variable, comparator, threshold, event_date}` — because the cards must display the question and date, which the v1.0 output lacked. Output `schema_version` becomes `"1.1"`; the input schema stays `"1.0"`.
  - `ScenarioValidationError` → 422 with `{"detail": "<the error message>"}` so the UI shows scenario/field verbatim. Missing file → 404. Malformed JSON → 422.
- Serves `web/dist/` at `/` when the build exists; if it doesn't, `/` returns a plain-text hint to run the web build.
- New CLI subcommand `serve` in `cli.py`: `edgecast serve [--port 8000] [--fixtures-dir fixtures]`, starts uvicorn bound to 127.0.0.1 and prints the URL. Import of server deps happens inside the subcommand so `analyze` keeps working without the server extras installed.
- Dependencies: `fastapi` and `uvicorn` in an optional `server` dependency group. The core pipeline stays stdlib-only.

### Frontend (`web/`)

React 19 + Vite + Tailwind v4 + TypeScript. No component library, no chart library, no icon pack. Files:

```
web/src/
├── api.ts            # typed fetch wrappers: getScenarioFiles(), analyze(file, threshold)
├── types.ts          # TS mirror of results JSON schema (ScenarioResult, Aggregate, ...)
├── theme.css         # design tokens as CSS custom properties + Tailwind theme
├── App.tsx           # layout + data flow (single fetch state, no state library)
└── components/
    ├── CommandBar.tsx
    ├── AggregateStrip.tsx
    ├── MarketCard.tsx
    └── ProbBar.tsx
```

Dev proxy: Vite proxies `/api` → `http://127.0.0.1:8000` so `npm run dev` works against a running server.

## Screen design

One screen, three zones, top to bottom. No sidebar, no nav tabs, no avatars, no settings pages.

**1. Command bar** (slim, hairline bottom border): `EDGECAST` wordmark left (mono, letterspaced). Center: scenario file selector (segmented control when ≤4 files, dropdown beyond). Right: edge-threshold stepper labeled `FLAG ≥ 0.05` (steps of 0.01, min 0, max 1) and `ANALYZE ▸` button. File or threshold changes re-run automatically; the button is an explicit re-run affordance.

**2. Aggregate strip**: four oversized mono figures — `SCENARIOS 6 · SETTLED 4 · BRIER MKT .195 · BRIER MDL .295` — and the verdict as the boldest text on screen: `MARKET BETTER CALIBRATED` (or `MODEL …`, `TIE`, or `AWAITING SETTLEMENTS` when n_settled = 0). Verdict is white-on-ink, not orange.

**3. Market grid**: responsive card grid (1–3 columns by width). Each card:

- Header: market question as uppercase mono label; event date right-aligned, dimmed.
- Two probability bars (custom SVG): `MARKET 0.72` solid fill in gray; `MODEL 0.80` hatched/striped fill in lighter gray. Same scale, 0–1. Values as mono numerals right of each bar. When `model_prob_raw` ≠ `model_prob` (clamped), show `raw 1.00 → 0.97` dimmed beneath the model bar.
- Edge line: when `|edge| ≥ threshold`, signal orange: `▲ +0.08 MODEL HIGHER` / `▼ −0.15 MARKET HIGHER` with a subtle text glow; otherwise dimmed gray `— AGREEMENT`.
- Settlement row (settled cards): `SETTLED YES · OBSERVED 93.1` plus `BRIER MKT .078 · MDL .040` with a `●` next to the winner (lower Brier). Unsettled cards: `AWAITING OBSERVATION` dimmed.

## Visual tokens (the theme contract)

- Background: `#0A0E12` deep ink (slightly blue, not pure black). Card background: `#0E141B`. 
- Text: three steps — `#E6EDF3` (primary), `#8B98A5` (secondary), `#4D5866` (dimmed).
- Hairlines: 1px, `rgba(255,255,255,0.12)`.
- Accent: `#FF6A00` signal orange. **Used exclusively for edge flags** (the triangle, the number, the direction word, and their glow). Nothing else on screen may be orange.
- Type: JetBrains Mono for all numerals, labels, and data; Inter only for full sentences (error messages, empty states). Both self-hosted via `@fontsource` packages (no CDN).
- Motion: probability bars animate width 200ms ease-out on load and re-run. Nothing else animates.

### Anti-slop contract (enforced at audit)

Prohibited anywhere in the UI: gradients; glassmorphism/backdrop blur; drop shadows; emoji; icon libraries; rounded-XL "bubble" cards (corner radius ≤ 4px); purple-on-dark default palettes; skeleton shimmer loaders (use a dimmed `ANALYZING…` mono text state); generic dashboard furniture (sidebars, avatar menus, notification bells, breadcrumbs); more than one accent color; center-aligned body text. Orange appears only on edge flags. Every number is mono. Labels are uppercase with letterspacing.

## Error and empty states (all in-theme, mono, never a raw browser error)

- API unreachable: full-screen `SIGNAL LOST` + `is the server running? → uv run edgecast serve` in dimmed text.
- 422 from analyze: the detail message shown in a hairline-bordered strip beneath the command bar, prefixed `INPUT ERROR`.
- Empty fixtures dir: `NO SCENARIO FILES — drop a scenarios JSON into fixtures/`.
- While analyzing: aggregate strip and cards dim to 40% with `ANALYZING…` in the command bar; no spinners, no shimmer.

## Testing

- **Backend (pytest, TestClient):** scenario-files listing (populated, empty, non-recursive); analyze happy path returns pipeline-identical JSON; custom threshold changes flags; unknown file → 404; path traversal (`../`, absolute, separators) → 400; invalid scenario JSON → 422 with scenario/field named; threshold out of range → 422.
- **Frontend (Vitest + Testing Library):** ProbBar renders width proportional to probability; MarketCard shows orange edge only at/above threshold, agreement state below it; settled vs unsettled rows; clamp annotation appears only when raw ≠ clamped; AggregateStrip verdict variants incl. `AWAITING SETTLEMENTS`.
- **Manual verify:** run `edgecast serve` with the sample fixture; confirm live re-run on threshold change and both error states (server killed, bad file).
- **Anti-slop audit:** final in-browser review against the contract above, item by item, before completion.

## Success criteria

`uv run edgecast serve` (after `npm run build` in `web/`) opens an instrument-panel dashboard showing the sample fixture's 6 markets with correct values from the pipeline; changing the threshold to 0.10 live-demotes the NYC card's edge flag to agreement; killing the server shows `SIGNAL LOST`; the anti-slop audit passes every item.

## Model usage during implementation (per global CLAUDE.md)

UI is taste-heavy: fable-5/opus-4.8 implement the frontend and theme. gpt-5.5 via codex may take the mechanical backend (server.py + tests, which have a complete spec). Reviews: fable-5. Commits: user only.
