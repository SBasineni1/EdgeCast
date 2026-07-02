# EdgeCast Dashboard v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web app (`uv run edgecast serve`) showing an instrument-panel dashboard of EdgeCast analyses: market vs model probability bars, orange edge flags, settlement + Brier rows, and an aggregate calibration verdict, with live re-run on file/threshold change.

**Architecture:** FastAPI (`src/edgecast/server.py`) wraps the existing pipeline unchanged and serves the built frontend; a `serve` CLI subcommand starts uvicorn. The frontend is a React 19 + Vite + Tailwind v4 + TypeScript app in `web/` with four custom components and zero component/chart/icon libraries. One additive backend change first: results gain a `market` metadata block (output schema "1.1") so cards can show the question/date.

**Tech Stack:** Python ≥3.12, FastAPI + uvicorn (optional `server` extra), pytest + httpx; Node ≥20, React 19, Vite 6+, Tailwind v4 (`@tailwindcss/vite`), TypeScript, Vitest + Testing Library, `@fontsource` self-hosted fonts.

**Spec:** `docs/superpowers/specs/2026-07-02-dashboard-design.md` — its **Anti-slop contract** and **Visual tokens** sections bind every frontend task.

## Global Constraints

- **No agent commits.** The user commits manually. Never run `git commit`/`git push`; never add `Co-Authored-By`. Tasks end when their tests pass.
- Core pipeline stays stdlib-only: `fastapi`/`uvicorn` go in `[project.optional-dependencies] server`; test deps in the `dev` group.
- Server binds 127.0.0.1 only. `POST /api/analyze` rejects path traversal (400), unknown file (404), invalid scenarios/malformed JSON/out-of-range threshold (422 with the pipeline's scenario/field message where applicable).
- Output schema: `schema_version "1.1"`, input stays `"1.0"`. Each result gains `market: {question, location, variable, comparator, threshold, event_date}`.
- Frontend: no component library, no chart library, no icon pack, no CDN assets (fonts via `@fontsource`), no state-management library.
- **Anti-slop contract (verbatim from spec, binding on all UI code):** no gradients; no glassmorphism/backdrop blur; no drop shadows (sole exception: the sanctioned text glow on edge flags); no emoji; corner radius ≤ 4px (this build uses square corners); no purple-on-dark palette; no skeleton shimmer (use dimmed `ANALYZING…` text); no sidebars/avatars/notification bells/breadcrumbs; exactly one accent color `#FF6A00`, used ONLY on edge flags; all numerals mono (JetBrains Mono); labels uppercase + letterspaced; body text never center-aligned (full-screen state screens may center their block).
- Visual tokens (exact): ink `#0A0E12`, panel `#0E141B`, text `#E6EDF3`/`#8B98A5`/`#4D5866`, hairline `rgba(255,255,255,0.12)`, signal `#FF6A00`; JetBrains Mono for data, Inter for sentences; only bars animate (width, 200ms ease-out).
- All commands run from the repo root unless a step says otherwise. Python tests: `uv run pytest …`. Frontend commands run in `web/`.
- Model split: Tasks 1–3 (mechanical backend, complete code below) → gpt-5.5 via codex exec. Tasks 4–9 (taste-heavy frontend + audit) → fable-5 inline.

---

### Task 1: Output schema — add market metadata block

**Files:**
- Modify: `src/edgecast/types.py` (ScenarioResult)
- Modify: `src/edgecast/pipeline.py` (analyze_scenario)
- Modify: `src/edgecast/jsonio.py` (OUTPUT_SCHEMA_VERSION, _result_dict, build_output)
- Modify: `tests/test_jsonio.py` (2 assertions + 1 new test)
- Modify: `tests/test_cli.py` (1 assertion)

**Interfaces:**
- Consumes: existing `MarketQuote`, `ScenarioResult`, `build_output`.
- Produces: `ScenarioResult` gains field `market: MarketQuote` (second position, after `scenario_id`). `jsonio.OUTPUT_SCHEMA_VERSION = "1.1"`. Each result dict gains key `"market"` = `{"question", "location", "variable", "comparator", "threshold", "event_date"}`. `build_output(...)["schema_version"] == "1.1"`. Input validation still requires `"1.0"`.

- [ ] **Step 1: Update the tests (failing first)**

In `tests/test_jsonio.py`, update the import line to include `OUTPUT_SCHEMA_VERSION`:

```python
from edgecast.jsonio import (
    OUTPUT_SCHEMA_VERSION,
    SCHEMA_VERSION,
    ScenarioValidationError,
    build_output,
    load_scenarios,
)
```

In `test_build_output_shape_and_rounding`, change the schema assertion and add market-block assertions. Replace the line `assert out["schema_version"] == SCHEMA_VERSION` with:

```python
    assert out["schema_version"] == OUTPUT_SCHEMA_VERSION
    assert r["market"] == {
        "question": "NYC high temp >= 90F on 2026-07-05?",
        "location": "NYC",
        "variable": "high_temp_f",
        "comparator": ">=",
        "threshold": 90.0,
        "event_date": "2026-07-05",
    }
```

(`r` is already defined two lines below the original assertion — move the `r = out["results"][0]` line up so it precedes the new assertions.)

In `tests/test_cli.py`, in `test_analyze_writes_json_to_stdout`, change `assert out["schema_version"] == "1.0"` to:

```python
    assert out["schema_version"] == "1.1"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_jsonio.py tests/test_cli.py -v`
Expected: FAIL — `ImportError: cannot import name 'OUTPUT_SCHEMA_VERSION'`.

- [ ] **Step 3: Implement**

`src/edgecast/types.py` — add the `market` field to `ScenarioResult` (full class after change):

```python
@dataclass(frozen=True)
class ScenarioResult:
    scenario_id: str
    market: MarketQuote
    market_prob: float
    model_prob: float      # clamped
    model_prob_raw: float
    n_members: int
    edge: EdgeMetrics
    settlement: Settlement | None
```

`src/edgecast/pipeline.py` — in `analyze_scenario`, pass the market through (full return statement after change):

```python
    return ScenarioResult(
        scenario_id=scenario.scenario_id,
        market=scenario.market,
        market_prob=market_prob,
        model_prob=model.clamped,
        model_prob_raw=model.raw,
        n_members=model.n_members,
        edge=edge,
        settlement=settlement,
    )
```

`src/edgecast/jsonio.py` — below `SCHEMA_VERSION = "1.0"` add:

```python
OUTPUT_SCHEMA_VERSION = "1.1"
```

In `_result_dict`, add a `"market"` key right after `"scenario_id"` (full return statement after change):

```python
    return {
        "scenario_id": r.scenario_id,
        "market": {
            "question": r.market.question,
            "location": r.market.location,
            "variable": r.market.variable,
            "comparator": r.market.comparator,
            "threshold": r.market.threshold,
            "event_date": r.market.event_date,
        },
        "market_prob": _round6(r.market_prob),
        "model_prob": _round6(r.model_prob),
        "model_prob_raw": _round6(r.model_prob_raw),
        "n_members": r.n_members,
        "edge": {
            "value": _round6(r.edge.value),
            "log_odds_diff": _round6(r.edge.log_odds_diff),
            "flag": r.edge.flag,
        },
        "settlement": settlement,
    }
```

In `build_output`, change `"schema_version": SCHEMA_VERSION,` to:

```python
        "schema_version": OUTPUT_SCHEMA_VERSION,
```

- [ ] **Step 4: Run the full suite**

Run: `uv run pytest -v`
Expected: all 64 tests pass (the two edited assertions now pass; nothing else asserts the output schema version).

---

### Task 2: FastAPI server — scenario listing + analyze endpoint

**Files:**
- Create: `src/edgecast/server.py`
- Modify: `pyproject.toml` (optional-dependencies + dev group)
- Test: `tests/test_server.py`

**Interfaces:**
- Consumes: `read_scenarios_file`, `ScenarioValidationError`, `build_output`, `analyze`, `DEFAULT_EDGE_THRESHOLD` (all existing).
- Produces: `edgecast.server.create_app(fixtures_dir: Path, web_dist: Path | None = None) -> FastAPI`. Routes: `GET /api/scenario-files` → `{"files": [str]}`; `POST /api/analyze` (body `{"file": str, "edge_threshold": float=0.05}`) → the build_output dict. Task 3 mounts this app from the CLI.

- [ ] **Step 1: Add dependencies to pyproject.toml**

Add after the `[dependency-groups]` section's existing content — full sections after change:

```toml
[project.optional-dependencies]
server = ["fastapi>=0.115", "uvicorn>=0.30"]

[dependency-groups]
dev = ["pytest>=8", "httpx>=0.27", "fastapi>=0.115", "uvicorn>=0.30"]
```

Run: `uv sync`
Expected: fastapi, starlette, uvicorn, httpx, pydantic installed.

- [ ] **Step 2: Write the failing tests**

`tests/test_server.py`:

```python
import json

import pytest
from fastapi.testclient import TestClient

from edgecast.server import create_app

SCENARIO = {
    "schema_version": "1.0",
    "scenarios": [
        {
            "scenario_id": "s1",
            "market": {
                "market_id": "MOCK-1",
                "question": "NYC high temp >= 90F on 2026-07-05?",
                "location": "NYC",
                "variable": "high_temp_f",
                "comparator": ">=",
                "threshold": 90.0,
                "event_date": "2026-07-05",
                "yes_price": 0.72,
            },
            "forecast": {
                "source": "mock-ensemble",
                "issued_at": "2026-07-03T12:00:00Z",
                "members": [88.0, 91.0, 91.5, 92.0],
            },
            "observation": {"observed_value": 93.1},
        }
    ],
}


@pytest.fixture
def fixtures_dir(tmp_path):
    d = tmp_path / "fixtures"
    d.mkdir()
    (d / "sample.json").write_text(json.dumps(SCENARIO))
    return d


@pytest.fixture
def client(fixtures_dir, tmp_path):
    app = create_app(fixtures_dir, web_dist=tmp_path / "no-dist")
    return TestClient(app)


def test_lists_scenario_files(client):
    r = client.get("/api/scenario-files")
    assert r.status_code == 200
    assert r.json() == {"files": ["sample.json"]}


def test_listing_is_sorted_and_non_recursive(client, fixtures_dir):
    (fixtures_dir / "a.json").write_text(json.dumps(SCENARIO))
    (fixtures_dir / "notes.txt").write_text("x")
    sub = fixtures_dir / "sub"
    sub.mkdir()
    (sub / "nested.json").write_text(json.dumps(SCENARIO))
    assert client.get("/api/scenario-files").json() == {"files": ["a.json", "sample.json"]}


def test_empty_dir_lists_nothing(tmp_path):
    d = tmp_path / "empty"
    d.mkdir()
    client = TestClient(create_app(d, web_dist=tmp_path / "no-dist"))
    assert client.get("/api/scenario-files").json() == {"files": []}


def test_analyze_happy_path(client):
    r = client.post("/api/analyze", json={"file": "sample.json"})
    assert r.status_code == 200
    out = r.json()
    assert out["schema_version"] == "1.1"
    result = out["results"][0]
    assert result["market_prob"] == 0.72
    assert result["model_prob"] == 0.75  # 3 of 4 members >= 90
    assert result["market"]["question"] == "NYC high temp >= 90F on 2026-07-05?"
    assert result["edge"]["flag"] == "agreement"  # |0.03| < default 0.05
    assert out["aggregate"]["n_settled"] == 1
    assert "generated_at" in out


def test_analyze_custom_threshold_changes_flag(client):
    r = client.post("/api/analyze", json={"file": "sample.json", "edge_threshold": 0.02})
    assert r.json()["results"][0]["edge"]["flag"] == "model_higher"


def test_analyze_unknown_file_404(client):
    assert client.post("/api/analyze", json={"file": "nope.json"}).status_code == 404


@pytest.mark.parametrize(
    "name",
    ["../sample.json", "sub/nested.json", "/etc/passwd", "..", "a\\b.json", ""],
)
def test_analyze_rejects_traversal(client, name):
    assert client.post("/api/analyze", json={"file": name}).status_code == 400


def test_analyze_invalid_scenario_422_names_field(client, fixtures_dir):
    bad = json.loads(json.dumps(SCENARIO))
    bad["scenarios"][0]["market"]["yes_price"] = 2.0
    (fixtures_dir / "bad.json").write_text(json.dumps(bad))
    r = client.post("/api/analyze", json={"file": "bad.json"})
    assert r.status_code == 422
    assert "yes_price" in r.json()["detail"]
    assert "s1" in r.json()["detail"]


def test_analyze_malformed_json_422(client, fixtures_dir):
    (fixtures_dir / "broken.json").write_text("{not json")
    r = client.post("/api/analyze", json={"file": "broken.json"})
    assert r.status_code == 422
    assert "malformed" in r.json()["detail"].lower()


@pytest.mark.parametrize("threshold", [-0.1, 1.5])
def test_analyze_threshold_out_of_range_422(client, threshold):
    r = client.post("/api/analyze", json={"file": "sample.json", "edge_threshold": threshold})
    assert r.status_code == 422


def test_root_without_build_returns_hint(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "npm run build" in r.text
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_server.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'edgecast.server'`.

- [ ] **Step 4: Implement**

`src/edgecast/server.py`:

```python
"""Local API server: wraps the pipeline for the dashboard frontend."""

import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from edgecast.edge import DEFAULT_EDGE_THRESHOLD
from edgecast.jsonio import ScenarioValidationError, build_output, read_scenarios_file
from edgecast.pipeline import analyze

WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"


class AnalyzeRequest(BaseModel):
    file: str
    edge_threshold: float = Field(default=DEFAULT_EDGE_THRESHOLD, ge=0.0, le=1.0)


def create_app(fixtures_dir: Path, web_dist: Path | None = None) -> FastAPI:
    app = FastAPI(title="EdgeCast")

    @app.get("/api/scenario-files")
    def scenario_files() -> dict:
        files = sorted(p.name for p in fixtures_dir.glob("*.json") if p.is_file())
        return {"files": files}

    @app.post("/api/analyze")
    def analyze_endpoint(req: AnalyzeRequest) -> dict:
        name = req.file
        if (
            "/" in name
            or "\\" in name
            or name in {"", ".", ".."}
            or name != Path(name).name
        ):
            raise HTTPException(status_code=400, detail="file must be a bare filename")
        path = (fixtures_dir / name).resolve()
        if path.parent != fixtures_dir.resolve():
            raise HTTPException(
                status_code=400, detail="file must be inside the fixtures directory"
            )
        if not path.is_file():
            raise HTTPException(status_code=404, detail=f"no such scenario file: {name}")
        try:
            scenarios = read_scenarios_file(path)
        except ScenarioValidationError as e:
            raise HTTPException(status_code=422, detail=str(e))
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=422, detail=f"malformed JSON: {e}")
        results, agg = analyze(scenarios, edge_threshold=req.edge_threshold)
        return build_output(
            results, agg, generated_at=datetime.now(timezone.utc).isoformat()
        )

    dist = web_dist if web_dist is not None else WEB_DIST
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="web")
    else:

        @app.get("/", response_class=PlainTextResponse)
        def no_build() -> str:
            return (
                "EdgeCast API is running. Frontend build not found - "
                "run: cd web && npm install && npm run build"
            )

    return app
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_server.py -v`
Expected: PASS (17 tests). Then `uv run pytest` — full suite passes.

---

### Task 3: `edgecast serve` subcommand

**Files:**
- Modify: `src/edgecast/cli.py`
- Test: append to `tests/test_cli.py`

**Interfaces:**
- Consumes: `create_app(fixtures_dir, web_dist=None)` from Task 2.
- Produces: `edgecast serve [--port 8000] [--fixtures-dir fixtures]` — builds the app and calls `uvicorn.run(app, host="127.0.0.1", port=port)`. `main` now dispatches on `args.command`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_cli.py`:

```python
def test_serve_invokes_uvicorn(monkeypatch, tmp_path):
    import uvicorn

    calls = {}

    def fake_run(app, host, port):
        calls["host"], calls["port"] = host, port
        calls["has_analyze_route"] = any(
            getattr(r, "path", None) == "/api/analyze" for r in app.routes
        )

    monkeypatch.setattr(uvicorn, "run", fake_run)
    rc = main(["serve", "--port", "8123", "--fixtures-dir", str(tmp_path)])
    assert rc == 0
    assert calls == {"host": "127.0.0.1", "port": 8123, "has_analyze_route": True}


def test_serve_defaults(monkeypatch):
    import uvicorn

    calls = {}
    monkeypatch.setattr(
        uvicorn, "run", lambda app, host, port: calls.update(port=port)
    )
    assert main(["serve"]) == 0
    assert calls["port"] == 8000
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_cli.py -v`
Expected: the two new tests FAIL (argparse: `invalid choice: 'serve'` → SystemExit); the six existing tests still pass.

- [ ] **Step 3: Implement**

In `src/edgecast/cli.py`, add to `_build_parser` after the `analyze` subparser block:

```python
    p_serve = sub.add_parser("serve", help="serve the dashboard API and UI locally")
    p_serve.add_argument("--port", type=int, default=8000)
    p_serve.add_argument(
        "--fixtures-dir", default="fixtures", help="directory of scenario JSON files"
    )
```

Rework `main` to dispatch on the command (full function after change):

```python
def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    if args.command == "serve":
        return _serve(args)
    return _analyze(args)


def _analyze(args) -> int:
    try:
        scenarios = read_scenarios_file(args.scenarios_file)
    except (ScenarioValidationError, OSError, json.JSONDecodeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    results, agg = analyze(scenarios, edge_threshold=args.edge_threshold)
    out = build_output(
        results, agg, generated_at=datetime.now(timezone.utc).isoformat()
    )
    text = json.dumps(out, indent=2)
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    return 0


def _serve(args) -> int:
    try:
        import uvicorn

        from edgecast.server import create_app
    except ImportError:
        print(
            "error: server dependencies not installed - run: uv sync --extra server",
            file=sys.stderr,
        )
        return 2
    app = create_app(Path(args.fixtures_dir))
    print(f"EdgeCast serving on http://127.0.0.1:{args.port}")
    uvicorn.run(app, host="127.0.0.1", port=args.port)
    return 0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest -v`
Expected: full suite passes (existing 6 CLI tests + 2 new; server tests unaffected).

---

### Task 4: Web scaffold — Vite/React/Tailwind/Vitest + types + API client

**Files (all under `web/`):**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.gitignore`
- Create: `src/theme.css`, `src/types.ts`, `src/api.ts`, `src/test-setup.ts`, `src/main.tsx`, `src/App.tsx` (placeholder, replaced in Task 8)
- Test: `src/api.test.ts`

**Interfaces:**
- Consumes: the API routes from Task 2 (via Vite dev proxy or same-origin in production).
- Produces: `types.ts` exports `MarketMeta`, `EdgeMetrics`, `SettlementResult`, `ScenarioResult`, `Aggregate`, `AnalysisOutput`. `api.ts` exports `getScenarioFiles(): Promise<string[]>`, `analyze(file: string, edgeThreshold: number): Promise<AnalysisOutput>`, `class InputError extends Error`. Design tokens exist as Tailwind utilities: `bg-ink`, `bg-panel`, `text-text-1/2/3`, `border-hairline`, `text-signal`, `font-mono` (JetBrains Mono), `font-sans` (Inter).

- [ ] **Step 0: Verify Node is available**

Run: `node --version && npm --version`
Expected: Node ≥ 20. If missing, STOP and report BLOCKED (Node must be installed by the user).

- [ ] **Step 1: Write the scaffold files**

`web/package.json`:

```json
{
  "name": "edgecast-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "preview": "vite preview"
  },
  "dependencies": {
    "@fontsource/inter": "^5.1.0",
    "@fontsource/jetbrains-mono": "^5.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "~5.7.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

`web/vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
    globals: true,
  },
});
```

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="data:," />
    <title>EdgeCast</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/.gitignore`:

```
node_modules/
dist/
```

`web/src/theme.css`:

```css
@import "tailwindcss";
@import "@fontsource/jetbrains-mono/400.css";
@import "@fontsource/jetbrains-mono/500.css";
@import "@fontsource/jetbrains-mono/700.css";
@import "@fontsource/inter/400.css";
@import "@fontsource/inter/500.css";

@theme {
  --color-ink: #0a0e12;
  --color-panel: #0e141b;
  --color-text-1: #e6edf3;
  --color-text-2: #8b98a5;
  --color-text-3: #4d5866;
  --color-hairline: rgba(255, 255, 255, 0.12);
  --color-signal: #ff6a00;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
  --font-sans: "Inter", system-ui, sans-serif;
}

body {
  background: var(--color-ink);
  color: var(--color-text-1);
  font-family: var(--font-mono);
}
```

`web/src/types.ts`:

```ts
export interface MarketMeta {
  question: string;
  location: string;
  variable: string;
  comparator: string;
  threshold: number;
  event_date: string;
}

export interface EdgeMetrics {
  value: number;
  log_odds_diff: number;
  flag: "model_higher" | "market_higher" | "agreement";
}

export interface SettlementResult {
  outcome: 0 | 1;
  observed_value: number;
  brier_market: number;
  brier_model: number;
  brier_diff: number;
}

export interface ScenarioResult {
  scenario_id: string;
  market: MarketMeta;
  market_prob: number;
  model_prob: number;
  model_prob_raw: number;
  n_members: number;
  edge: EdgeMetrics;
  settlement: SettlementResult | null;
}

export interface Aggregate {
  n_scenarios: number;
  n_settled: number;
  mean_brier_market: number | null;
  mean_brier_model: number | null;
  better_calibrated: "model" | "market" | "tie" | null;
}

export interface AnalysisOutput {
  schema_version: string;
  generated_at: string;
  results: ScenarioResult[];
  aggregate: Aggregate;
}
```

`web/src/api.ts`:

```ts
import type { AnalysisOutput } from "./types";

export class InputError extends Error {}

export async function getScenarioFiles(): Promise<string[]> {
  const res = await fetch("/api/scenario-files");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { files: string[] };
  return data.files;
}

export async function analyze(
  file: string,
  edgeThreshold: number,
): Promise<AnalysisOutput> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file, edge_threshold: edgeThreshold }),
  });
  if (res.status === 400 || res.status === 404 || res.status === 422) {
    const body = (await res.json()) as { detail?: unknown };
    throw new InputError(
      typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail),
    );
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as AnalysisOutput;
}
```

`web/src/test-setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

`web/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`web/src/App.tsx` (placeholder — replaced in Task 8):

```tsx
export default function App() {
  return <main className="p-6 tracking-[0.35em]">EDGECAST</main>;
}
```

- [ ] **Step 2: Install and write the failing API test**

Run in `web/`: `npm install`
Expected: clean install, lockfile created.

`web/src/api.test.ts`:

```ts
import { afterEach, expect, it, vi } from "vitest";
import { analyze, getScenarioFiles, InputError } from "./api";

afterEach(() => vi.unstubAllGlobals());

function fakeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

it("getScenarioFiles returns the file list", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(fakeResponse(200, { files: ["a.json", "b.json"] })),
  );
  expect(await getScenarioFiles()).toEqual(["a.json", "b.json"]);
});

it("analyze posts file and threshold", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(fakeResponse(200, { results: [], aggregate: {} }));
  vi.stubGlobal("fetch", fetchMock);
  await analyze("a.json", 0.1);
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/analyze",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ file: "a.json", edge_threshold: 0.1 }),
    }),
  );
});

it("analyze throws InputError with the detail on 422", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(fakeResponse(422, { detail: "scenario 's1': field 'x' bad" })),
  );
  await expect(analyze("a.json", 0.05)).rejects.toThrow(InputError);
  await expect(analyze("a.json", 0.05)).rejects.toThrow("scenario 's1'");
});

it("analyze throws plain Error on server failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(500, {})));
  await expect(analyze("a.json", 0.05)).rejects.toThrow("HTTP 500");
  await expect(analyze("a.json", 0.05)).rejects.not.toThrow(InputError);
});
```

Note: the last assertion pair — `rejects.not.toThrow(InputError)` is not valid vitest semantics; instead write:

```ts
it("analyze throws plain Error (not InputError) on server failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(500, {})));
  const err = await analyze("a.json", 0.05).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(Error);
  expect(err).not.toBeInstanceOf(InputError);
  expect((err as Error).message).toBe("HTTP 500");
});
```

Use this second version; do not include the first `rejects.not` variant.

- [ ] **Step 3: Run tests and build**

Run in `web/`: `npm test`
Expected: 4 tests pass.

Run in `web/`: `npm run build`
Expected: tsc clean, `dist/` produced with the placeholder app.

---

### Task 5: ProbBar component

**Files:**
- Create: `web/src/components/ProbBar.tsx`
- Test: `web/src/components/ProbBar.test.tsx`

**Interfaces:**
- Consumes: theme tokens (CSS variables) from Task 4.
- Produces: `ProbBar({ label, value, variant }: { label: string; value: number; variant: "solid" | "hatched" })` — an SVG bar; fill rect has `data-testid="probbar-fill"` and `width` attribute `"<pct>%"`. Task 6 renders two of these per card.

- [ ] **Step 1: Write the failing test**

`web/src/components/ProbBar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ProbBar } from "./ProbBar";

it("renders fill width proportional to value", () => {
  render(<ProbBar label="MARKET" value={0.72} variant="solid" />);
  expect(screen.getByTestId("probbar-fill")).toHaveAttribute("width", "72%");
});

it("clamps out-of-range values into 0..100%", () => {
  render(<ProbBar label="X" value={1.2} variant="solid" />);
  expect(screen.getByTestId("probbar-fill")).toHaveAttribute("width", "100%");
});

it("shows the numeric value to two decimals", () => {
  render(<ProbBar label="MODEL" value={0.8} variant="hatched" />);
  expect(screen.getByText("0.80")).toBeInTheDocument();
});

it("hatched variant fills via pattern, solid via flat color", () => {
  const { container, rerender } = render(
    <ProbBar label="MODEL" value={0.5} variant="hatched" />,
  );
  expect(container.querySelector("pattern")).not.toBeNull();
  expect(screen.getByTestId("probbar-fill").getAttribute("fill")).toMatch(/^url\(#/);
  rerender(<ProbBar label="MARKET" value={0.5} variant="solid" />);
  expect(container.querySelector("pattern")).toBeNull();
  expect(screen.getByTestId("probbar-fill").getAttribute("fill")).toBe(
    "var(--color-text-2)",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run in `web/`: `npm test`
Expected: FAIL — cannot resolve `./ProbBar`.

- [ ] **Step 3: Implement**

`web/src/components/ProbBar.tsx`:

```tsx
import { useId } from "react";

interface ProbBarProps {
  label: string;
  value: number; // 0..1
  variant: "solid" | "hatched";
}

export function ProbBar({ label, value, variant }: ProbBarProps) {
  const patternId = useId().replace(/:/g, "");
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 10000) / 100;
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-xs tracking-[0.2em] text-text-2">
        {label}
      </span>
      <svg
        className="h-3 flex-1"
        preserveAspectRatio="none"
        role="meter"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={1}
      >
        {variant === "hatched" && (
          <defs>
            <pattern
              id={patternId}
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="2" height="5" fill="var(--color-text-2)" />
            </pattern>
          </defs>
        )}
        <rect
          width="100%"
          height="100%"
          fill="none"
          stroke="var(--color-hairline)"
          strokeWidth="1"
        />
        <rect
          height="100%"
          width={`${pct}%`}
          fill={variant === "solid" ? "var(--color-text-2)" : `url(#${patternId})`}
          style={{ transition: "width 200ms ease-out" }}
          data-testid="probbar-fill"
        />
      </svg>
      <span className="w-12 shrink-0 text-right text-sm tabular-nums">
        {value.toFixed(2)}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run in `web/`: `npm test`
Expected: all tests pass (api + ProbBar).

---

### Task 6: MarketCard component

**Files:**
- Create: `web/src/components/MarketCard.tsx`
- Test: `web/src/components/MarketCard.test.tsx`

**Interfaces:**
- Consumes: `ProbBar` (Task 5), `ScenarioResult` type (Task 4).
- Produces: `MarketCard({ result }: { result: ScenarioResult })`. Test hooks: `data-testid="edge-flag"` (orange flagged line) / `data-testid="edge-agreement"`. Task 8 renders a grid of these.

- [ ] **Step 1: Write the failing test**

`web/src/components/MarketCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ScenarioResult } from "../types";
import { MarketCard } from "./MarketCard";

const base: ScenarioResult = {
  scenario_id: "s1",
  market: {
    question: "NYC high temp >= 90F on 2026-07-05?",
    location: "NYC",
    variable: "high_temp_f",
    comparator: ">=",
    threshold: 90,
    event_date: "2026-07-05",
  },
  market_prob: 0.72,
  model_prob: 0.8,
  model_prob_raw: 0.8,
  n_members: 30,
  edge: { value: 0.08, log_odds_diff: 0.44, flag: "model_higher" },
  settlement: {
    outcome: 1,
    observed_value: 93.1,
    brier_market: 0.0784,
    brier_model: 0.04,
    brier_diff: -0.0384,
  },
};

it("shows question and formatted date", () => {
  render(<MarketCard result={base} />);
  expect(screen.getByText("NYC high temp >= 90F on 2026-07-05?")).toBeInTheDocument();
  expect(screen.getByText("JUL 05")).toBeInTheDocument();
});

it("flags model_higher in signal style with arrow and signed value", () => {
  render(<MarketCard result={base} />);
  const flag = screen.getByTestId("edge-flag");
  expect(flag).toHaveTextContent("▲ +0.08 MODEL HIGHER");
});

it("flags market_higher with down arrow and minus sign", () => {
  render(
    <MarketCard
      result={{
        ...base,
        edge: { value: -0.15, log_odds_diff: -0.6, flag: "market_higher" },
      }}
    />,
  );
  expect(screen.getByTestId("edge-flag")).toHaveTextContent("▼ -0.15 MARKET HIGHER");
});

it("shows dimmed agreement instead of a flag", () => {
  render(
    <MarketCard
      result={{ ...base, edge: { value: 0.03, log_odds_diff: 0.1, flag: "agreement" } }}
    />,
  );
  expect(screen.queryByTestId("edge-flag")).toBeNull();
  expect(screen.getByTestId("edge-agreement")).toHaveTextContent("AGREEMENT");
});

it("settled card shows outcome, observation and winner dot on lower brier", () => {
  render(<MarketCard result={base} />);
  expect(screen.getByText(/SETTLED YES/)).toBeInTheDocument();
  expect(screen.getByText(/OBSERVED 93.1/)).toBeInTheDocument();
  expect(screen.getByText(/MDL 0.040 ●/)).toBeInTheDocument();
});

it("unsettled card shows awaiting state", () => {
  render(<MarketCard result={{ ...base, settlement: null }} />);
  expect(screen.getByText("AWAITING OBSERVATION")).toBeInTheDocument();
});

it("shows clamp annotation only when raw differs", () => {
  const { rerender } = render(<MarketCard result={base} />);
  expect(screen.queryByText(/raw/)).toBeNull();
  rerender(
    <MarketCard result={{ ...base, model_prob_raw: 1.0, model_prob: 0.967742 }} />,
  );
  expect(screen.getByText("raw 1.00 → 0.97")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run in `web/`: `npm test`
Expected: FAIL — cannot resolve `./MarketCard`.

- [ ] **Step 3: Implement**

`web/src/components/MarketCard.tsx`:

```tsx
import type { ScenarioResult } from "../types";
import { ProbBar } from "./ProbBar";

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function formatDate(isoDate: string): string {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${String(d ?? 1).padStart(2, "0")}`;
}

const FLAG_TEXT = {
  model_higher: "MODEL HIGHER",
  market_higher: "MARKET HIGHER",
} as const;

export function MarketCard({ result }: { result: ScenarioResult }) {
  const { market, edge, settlement } = result;
  const clamped = result.model_prob_raw !== result.model_prob;
  return (
    <article className="space-y-3 border border-hairline bg-panel p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs uppercase tracking-[0.15em]">{market.question}</h3>
        <span className="shrink-0 text-xs text-text-3">
          {formatDate(market.event_date)}
        </span>
      </header>
      <div className="space-y-2">
        <ProbBar label="MARKET" value={result.market_prob} variant="solid" />
        <ProbBar label="MODEL" value={result.model_prob} variant="hatched" />
        {clamped && (
          <p className="pl-[76px] text-[10px] text-text-3">
            raw {result.model_prob_raw.toFixed(2)} → {result.model_prob.toFixed(2)}
          </p>
        )}
      </div>
      {edge.flag === "agreement" ? (
        <p className="text-sm text-text-3" data-testid="edge-agreement">
          — AGREEMENT
        </p>
      ) : (
        <p
          className="text-sm text-signal"
          style={{ textShadow: "0 0 8px rgba(255, 106, 0, 0.45)" }}
          data-testid="edge-flag"
        >
          {edge.value >= 0 ? "▲ +" : "▼ "}
          {edge.value.toFixed(2)} {FLAG_TEXT[edge.flag]}
        </p>
      )}
      <footer className="border-t border-hairline pt-2 text-xs text-text-2">
        {settlement ? (
          <>
            <p>
              SETTLED {settlement.outcome === 1 ? "YES" : "NO"} · OBSERVED{" "}
              {settlement.observed_value}
            </p>
            <p>
              BRIER MKT {settlement.brier_market.toFixed(3)}
              {settlement.brier_market < settlement.brier_model ? " ●" : ""} · MDL{" "}
              {settlement.brier_model.toFixed(3)}
              {settlement.brier_model < settlement.brier_market ? " ●" : ""}
            </p>
          </>
        ) : (
          <p className="text-text-3">AWAITING OBSERVATION</p>
        )}
      </footer>
    </article>
  );
}
```

Note on the flag line: for negative values `edge.value.toFixed(2)` already renders the minus (`-0.15`), so the negative branch prefixes only `▼ `. The sanctioned text glow is the ONLY shadow in the app.

- [ ] **Step 4: Run test to verify it passes**

Run in `web/`: `npm test`
Expected: all tests pass.

---

### Task 7: AggregateStrip + CommandBar components

**Files:**
- Create: `web/src/components/AggregateStrip.tsx`, `web/src/components/CommandBar.tsx`
- Test: `web/src/components/AggregateStrip.test.tsx`, `web/src/components/CommandBar.test.tsx`

**Interfaces:**
- Consumes: `Aggregate` type (Task 4).
- Produces:
  - `AggregateStrip({ aggregate }: { aggregate: Aggregate })` — verdict element has `data-testid="verdict"`.
  - `CommandBar({ files, selected, onSelect, threshold, onThreshold, onAnalyze, busy }: { files: string[]; selected: string | null; onSelect: (f: string) => void; threshold: number; onThreshold: (t: number) => void; onAnalyze: () => void; busy: boolean })`.

- [ ] **Step 1: Write the failing tests**

`web/src/components/AggregateStrip.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { Aggregate } from "../types";
import { AggregateStrip } from "./AggregateStrip";

const agg: Aggregate = {
  n_scenarios: 6,
  n_settled: 4,
  mean_brier_market: 0.1946,
  mean_brier_model: 0.294722,
  better_calibrated: "market",
};

it("renders counts and dotless brier figures", () => {
  render(<AggregateStrip aggregate={agg} />);
  expect(screen.getByText("6")).toBeInTheDocument();
  expect(screen.getByText("4")).toBeInTheDocument();
  expect(screen.getByText(".195")).toBeInTheDocument();
  expect(screen.getByText(".295")).toBeInTheDocument();
});

it.each([
  ["market", "MARKET BETTER CALIBRATED"],
  ["model", "MODEL BETTER CALIBRATED"],
  ["tie", "MARKET AND MODEL TIED"],
] as const)("verdict for %s", (better, text) => {
  render(<AggregateStrip aggregate={{ ...agg, better_calibrated: better }} />);
  expect(screen.getByTestId("verdict")).toHaveTextContent(text);
});

it("shows awaiting state when nothing is settled", () => {
  render(
    <AggregateStrip
      aggregate={{
        n_scenarios: 2,
        n_settled: 0,
        mean_brier_market: null,
        mean_brier_model: null,
        better_calibrated: null,
      }}
    />,
  );
  expect(screen.getByTestId("verdict")).toHaveTextContent("AWAITING SETTLEMENTS");
  expect(screen.getAllByText("—")).toHaveLength(2);
});
```

`web/src/components/CommandBar.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CommandBar } from "./CommandBar";

const props = {
  files: ["a.json", "b.json"],
  selected: "a.json",
  onSelect: vi.fn(),
  threshold: 0.05,
  onThreshold: vi.fn(),
  onAnalyze: vi.fn(),
  busy: false,
};

it("renders segmented buttons for few files and selects on click", () => {
  render(<CommandBar {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "b.json" }));
  expect(props.onSelect).toHaveBeenCalledWith("b.json");
});

it("renders a select beyond 4 files", () => {
  render(
    <CommandBar
      {...props}
      files={["a.json", "b.json", "c.json", "d.json", "e.json"]}
    />,
  );
  expect(screen.getByRole("combobox")).toBeInTheDocument();
});

it("steps the threshold within [0,1]", () => {
  const onThreshold = vi.fn();
  render(<CommandBar {...props} threshold={0.0} onThreshold={onThreshold} />);
  fireEvent.click(screen.getByRole("button", { name: "decrease threshold" }));
  expect(onThreshold).toHaveBeenCalledWith(0);
  fireEvent.click(screen.getByRole("button", { name: "increase threshold" }));
  expect(onThreshold).toHaveBeenCalledWith(0.01);
});

it("fires onAnalyze and shows busy state", () => {
  const { rerender } = render(<CommandBar {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /ANALYZE/ }));
  expect(props.onAnalyze).toHaveBeenCalled();
  rerender(<CommandBar {...props} busy={true} />);
  expect(screen.getByText("ANALYZING…")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run in `web/`: `npm test`
Expected: FAIL — cannot resolve `./AggregateStrip` / `./CommandBar`.

- [ ] **Step 3: Implement**

`web/src/components/AggregateStrip.tsx`:

```tsx
import type { Aggregate } from "../types";

const VERDICT: Record<"model" | "market" | "tie", string> = {
  model: "MODEL BETTER CALIBRATED",
  market: "MARKET BETTER CALIBRATED",
  tie: "MARKET AND MODEL TIED",
};

function fmtBrier(x: number | null): string {
  return x === null ? "—" : x.toFixed(3).replace(/^0/, "");
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.2em] text-text-3">{label}</div>
      <div className="text-3xl font-medium tabular-nums">{value}</div>
    </div>
  );
}

export function AggregateStrip({ aggregate }: { aggregate: Aggregate }) {
  const verdict = aggregate.better_calibrated
    ? VERDICT[aggregate.better_calibrated]
    : "AWAITING SETTLEMENTS";
  return (
    <section className="flex flex-wrap items-end gap-x-10 gap-y-3 border-b border-hairline px-6 py-5">
      <Stat label="SCENARIOS" value={String(aggregate.n_scenarios)} />
      <Stat label="SETTLED" value={String(aggregate.n_settled)} />
      <Stat label="BRIER MKT" value={fmtBrier(aggregate.mean_brier_market)} />
      <Stat label="BRIER MDL" value={fmtBrier(aggregate.mean_brier_model)} />
      <p
        className="ml-auto text-xl font-bold tracking-[0.1em]"
        data-testid="verdict"
      >
        {verdict}
      </p>
    </section>
  );
}
```

`web/src/components/CommandBar.tsx`:

```tsx
interface CommandBarProps {
  files: string[];
  selected: string | null;
  onSelect: (f: string) => void;
  threshold: number;
  onThreshold: (t: number) => void;
  onAnalyze: () => void;
  busy: boolean;
}

export function CommandBar({
  files,
  selected,
  onSelect,
  threshold,
  onThreshold,
  onAnalyze,
  busy,
}: CommandBarProps) {
  const step = (d: number) =>
    onThreshold(Math.min(1, Math.max(0, Math.round((threshold + d) * 100) / 100)));
  return (
    <header className="flex items-center gap-6 border-b border-hairline px-6 py-3">
      <span className="text-sm font-bold tracking-[0.35em]">EDGECAST</span>
      <nav className="flex gap-1" aria-label="scenario file">
        {files.length <= 4 ? (
          files.map((f) => (
            <button
              key={f}
              onClick={() => onSelect(f)}
              className={`border px-2 py-1 text-xs tracking-wider ${
                f === selected
                  ? "border-text-2 text-text-1"
                  : "border-hairline text-text-3"
              }`}
            >
              {f}
            </button>
          ))
        ) : (
          <select
            value={selected ?? ""}
            onChange={(e) => onSelect(e.target.value)}
            className="border border-hairline bg-ink px-2 py-1 text-xs"
          >
            {files.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
      </nav>
      <div className="ml-auto flex items-center gap-4">
        {busy && <span className="text-xs text-text-3">ANALYZING…</span>}
        <div className="flex items-center gap-2 text-xs">
          <span className="tracking-widest text-text-3">FLAG ≥</span>
          <button
            aria-label="decrease threshold"
            onClick={() => step(-0.01)}
            className="border border-hairline px-1.5"
          >
            −
          </button>
          <span className="w-8 text-center tabular-nums">
            {threshold.toFixed(2)}
          </span>
          <button
            aria-label="increase threshold"
            onClick={() => step(0.01)}
            className="border border-hairline px-1.5"
          >
            +
          </button>
        </div>
        <button
          onClick={onAnalyze}
          className="border border-text-2 px-3 py-1 text-xs tracking-widest"
        >
          ANALYZE ▸
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run in `web/`: `npm test`
Expected: all tests pass.

---

### Task 8: App assembly — data flow, states, build

**Files:**
- Modify: `web/src/App.tsx` (replace placeholder entirely)
- Test: `web/src/App.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 4–7.
- Produces: the complete app. States: `loading` (blank), `offline` (`SIGNAL LOST`), `empty` (`NO SCENARIO FILES…`), `ready` (command bar + aggregate strip + card grid, `INPUT ERROR` strip on 422, 40%-dim while busy).

- [ ] **Step 1: Write the failing tests**

`web/src/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";

afterEach(() => vi.unstubAllGlobals());

function fakeResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const OUTPUT = {
  schema_version: "1.1",
  generated_at: "2026-07-02T18:00:00+00:00",
  results: [
    {
      scenario_id: "s1",
      market: {
        question: "NYC high temp >= 90F on 2026-07-05?",
        location: "NYC",
        variable: "high_temp_f",
        comparator: ">=",
        threshold: 90,
        event_date: "2026-07-05",
      },
      market_prob: 0.72,
      model_prob: 0.8,
      model_prob_raw: 0.8,
      n_members: 30,
      edge: { value: 0.08, log_odds_diff: 0.44, flag: "model_higher" },
      settlement: null,
    },
  ],
  aggregate: {
    n_scenarios: 1,
    n_settled: 0,
    mean_brier_market: null,
    mean_brier_model: null,
    better_calibrated: null,
  },
};

it("shows SIGNAL LOST when the API is unreachable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
  render(<App />);
  expect(await screen.findByText("SIGNAL LOST")).toBeInTheDocument();
});

it("shows empty state when no scenario files exist", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(fakeResponse(200, { files: [] })),
  );
  render(<App />);
  expect(await screen.findByText(/NO SCENARIO FILES/)).toBeInTheDocument();
});

it("loads files, auto-analyzes the first, renders strip and cards", async () => {
  const fetchMock = vi.fn(async (url: string) =>
    url === "/api/scenario-files"
      ? fakeResponse(200, { files: ["sample.json"] })
      : fakeResponse(200, OUTPUT),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);
  expect(await screen.findByTestId("verdict")).toHaveTextContent(
    "AWAITING SETTLEMENTS",
  );
  expect(
    screen.getByText("NYC high temp >= 90F on 2026-07-05?"),
  ).toBeInTheDocument();
});

it("shows INPUT ERROR strip on 422 detail", async () => {
  const fetchMock = vi.fn(async (url: string) =>
    url === "/api/scenario-files"
      ? fakeResponse(200, { files: ["bad.json"] })
      : fakeResponse(422, { detail: "scenario 's1': field 'yes_price' bad" }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);
  expect(await screen.findByText(/INPUT ERROR/)).toBeInTheDocument();
  expect(screen.getByText(/yes_price/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run in `web/`: `npm test`
Expected: App tests FAIL (placeholder renders none of this).

- [ ] **Step 3: Implement**

`web/src/App.tsx` (replace entirely):

```tsx
import { useCallback, useEffect, useState } from "react";
import { analyze, getScenarioFiles, InputError } from "./api";
import type { AnalysisOutput } from "./types";
import { AggregateStrip } from "./components/AggregateStrip";
import { CommandBar } from "./components/CommandBar";
import { MarketCard } from "./components/MarketCard";

type Status = "loading" | "ready" | "offline" | "empty";

export default function App() {
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.05);
  const [output, setOutput] = useState<AnalysisOutput | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [inputError, setInputError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getScenarioFiles()
      .then((fs) => {
        setFiles(fs);
        if (fs.length === 0) {
          setStatus("empty");
        } else {
          setSelected(fs[0]);
          setStatus("ready");
        }
      })
      .catch(() => setStatus("offline"));
  }, []);

  const run = useCallback(async (file: string, th: number) => {
    setBusy(true);
    setInputError(null);
    try {
      setOutput(await analyze(file, th));
    } catch (e) {
      if (e instanceof InputError) setInputError(e.message);
      else setStatus("offline");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (selected !== null) void run(selected, threshold);
  }, [selected, threshold, run]);

  if (status === "offline") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3">
        <h1 className="text-4xl font-bold tracking-[0.3em]">SIGNAL LOST</h1>
        <p className="font-sans text-sm text-text-3">
          is the server running? → uv run edgecast serve
        </p>
      </main>
    );
  }
  if (status === "empty") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="tracking-widest text-text-2">
          NO SCENARIO FILES — drop a scenarios JSON into fixtures/
        </p>
      </main>
    );
  }
  return (
    <main className="min-h-screen">
      <CommandBar
        files={files}
        selected={selected}
        onSelect={setSelected}
        threshold={threshold}
        onThreshold={setThreshold}
        onAnalyze={() => selected !== null && void run(selected, threshold)}
        busy={busy}
      />
      {inputError !== null && (
        <p className="border-b border-hairline px-6 py-2 text-xs text-text-2">
          <span className="font-bold text-text-1">INPUT ERROR</span> {inputError}
        </p>
      )}
      {output !== null && (
        <div className={`transition-opacity ${busy ? "opacity-40" : ""}`}>
          <AggregateStrip aggregate={output.aggregate} />
          <section className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
            {output.results.map((r) => (
              <MarketCard key={r.scenario_id} result={r} />
            ))}
          </section>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run tests, typecheck, build**

Run in `web/`: `npm test`
Expected: full frontend suite passes.

Run in `web/`: `npm run build`
Expected: clean tsc + `dist/` build.

---

### Task 9: Integration verify + anti-slop audit

**Files:** none created (verification only).

**Interfaces:** consumes everything.

- [ ] **Step 1: Full test suites**

Run: `uv run pytest -v` (repo root) and `npm test` (in `web/`).
Expected: everything passes.

- [ ] **Step 2: Serve and probe the real app**

Run in background: `uv run edgecast serve --port 8000`
Then:
- `curl -s http://127.0.0.1:8000/api/scenario-files` → `{"files":["scenarios_sample.json"]}`
- `curl -s -X POST http://127.0.0.1:8000/api/analyze -H 'Content-Type: application/json' -d '{"file":"scenarios_sample.json"}'` → JSON with 6 results, aggregate `better_calibrated: "market"`, and each result carrying a `market.question`.
- `curl -s http://127.0.0.1:8000/` → the built `index.html` (contains `EdgeCast` title).

- [ ] **Step 3: Browser verification (use the `verify` skill / run skill patterns)**

Open `http://127.0.0.1:8000` in a browser (or drive headless): confirm the command bar, aggregate strip (`MARKET BETTER CALIBRATED`), 6 cards with bars; step threshold to 0.10 → NYC card demotes to `— AGREEMENT`; kill the server and reload → `SIGNAL LOST`.

- [ ] **Step 4: Anti-slop audit (item by item, against the spec contract)**

Inspect the rendered UI and grep the source. Every item must pass:

- `grep -rn "gradient\|backdrop-blur\|box-shadow\|shadow-" web/src/` → only the sanctioned `textShadow` glow in `MarketCard.tsx`.
- `grep -rn "rounded" web/src/` → no matches (square corners).
- No emoji anywhere in `web/src/` (arrows ▲▼▸●— are typography, not emoji).
- Orange (`text-signal` / `#FF6A00` / `255, 106, 0`) appears ONLY in `MarketCard.tsx`'s edge flag block and `theme.css`'s token definition.
- All numerals render in JetBrains Mono (mono is the body font; only the two sentence strings use `font-sans`).
- Labels uppercase + letterspaced; no center-aligned body text (full-screen states center their block, which the contract permits).
- No component/chart/icon libraries in `web/package.json` beyond the listed deps.
- Loading is dim + `ANALYZING…` text; no spinners or shimmer.

Record the audit outcome (pass, or each violation + fix) in the progress ledger.

---

## Model delegation notes (per global CLAUDE.md)

- **Tasks 1–3** (backend, fully specified): gpt-5.5 via `codex exec`, xhigh, one task per dispatch with the task brief.
- **Tasks 4–9** (frontend + audit, taste-heavy): fable-5 inline in-session.
- Reviews: fable-5 after each task. The user commits; agents never do.
