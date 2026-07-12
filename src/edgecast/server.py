"""Local API server: wraps the pipeline for the dashboard frontend."""

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from edgecast.edge import DEFAULT_EDGE_THRESHOLD
from edgecast.grade import grade_days
from edgecast.jsonio import ScenarioValidationError, build_output, read_scenarios_file
from edgecast.live.assemble import build_live_scenarios
from edgecast.live.stations import STATIONS
from edgecast.model_store import ModelStore
from edgecast.pipeline import analyze
from edgecast.store import Store
from edgecast.verify import verify_days as run_verification

WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"

# The frontend polls /api/live every 60s; without this pause a 429 from
# open-meteo turns every poll into another 20-city burst and the quota
# never recovers.
RATE_LIMIT_COOLDOWN_SECONDS = 900.0


def _had_429(failures: list[dict]) -> bool:
    return any("429" in f.get("reason", "") for f in failures)


def _no_data_dates(failures: list[dict]) -> set[str]:
    """Dates the ensemble archive has no data for — retrying them burns quota forever.

    Only dates at least 3 days old are written off; a recent date can still be
    a publication lag rather than a hole in the archive.
    """
    from datetime import date, timedelta

    cutoff = (date.today() - timedelta(days=3)).isoformat()
    return {
        f["date"]
        for f in failures
        if f.get("stage") == "open-meteo"
        and str(f.get("reason", "")).startswith("no ensemble data")
        and f.get("date", "") <= cutoff
    }


class AnalyzeRequest(BaseModel):
    file: str
    edge_threshold: float = Field(default=DEFAULT_EDGE_THRESHOLD, ge=0.0, le=1.0)


def _window_dates(days: int) -> list[str]:
    from datetime import date, timedelta

    yesterday = date.today() - timedelta(days=1)
    return [(yesterday - timedelta(days=i)).isoformat() for i in range(days)]


def create_app(
    fixtures_dir: Path,
    web_dist: Path | None = None,
    *,
    db_path: str | Path = "data/edgecast.db",
    verify_days: int = 30,
) -> FastAPI:
    app = FastAPI(title="EdgeCast")
    app.state.db_path = str(db_path)
    app.state.verify_days = verify_days
    app.state.topup_paused_until = 0.0
    app.state.dead_dates: set[str] = set()

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

    kalshi_client = httpx.Client()
    meteo_client = httpx.Client()

    @app.get("/api/live")
    def live_endpoint(edge_threshold: float = DEFAULT_EDGE_THRESHOLD) -> dict:
        if not 0.0 <= edge_threshold <= 1.0:
            raise HTTPException(status_code=422, detail="edge_threshold must be in [0, 1]")
        try:
            model_store: ModelStore | None = ModelStore(db_path)
        except Exception:  # noqa: BLE001
            model_store = None
        live = build_live_scenarios(kalshi_client, meteo_client, model_store)
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
            "model_highs": live.model_highs,
            "consensus_sigma": live.consensus_sigma,
            "cities": {
                st.city: {"name": st.name, "station": st.station, "series": st.series}
                for st in STATIONS.values()
            },
        }
        model = "gfs_seamless"
        try:
            store = Store(db_path)
            dates = _window_dates(verify_days)
            missing = [
                d for d in store.dates_missing(model, dates) if d not in app.state.dead_dates
            ][:3]
            topup_failures: list[dict] = []
            if missing and time.monotonic() >= app.state.topup_paused_until:
                topup = run_verification(missing, store, kalshi_client, meteo_client, model=model)
                topup_failures = topup.failures
                if _had_429(topup_failures):
                    app.state.topup_paused_until = time.monotonic() + RATE_LIMIT_COOLDOWN_SECONDS
                app.state.dead_dates.update(_no_data_dates(topup_failures))
            since = min(dates)
            stats = store.window_stats(model, since)
            if stats is None:
                out["verification"] = None
            else:
                out["verification"] = {
                    "window_days": verify_days,
                    "n_markets": stats.n_markets,
                    "n_days": stats.n_days,
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
        try:
            if model_store is None:
                out["model_grades"] = None
            else:
                m_dates = _window_dates(verify_days)
                m_missing = model_store.dates_missing("day_ahead", m_dates)[:3]
                if m_missing and time.monotonic() >= app.state.topup_paused_until:
                    g_report = grade_days(m_missing, model_store, kalshi_client, meteo_client)
                    if _had_429(g_report.failures):
                        app.state.topup_paused_until = (
                            time.monotonic() + RATE_LIMIT_COOLDOWN_SECONDS
                        )
                overall = model_store.overall_grades("day_ahead", min(m_dates))
                if not overall:
                    out["model_grades"] = None
                else:
                    def _grade_json(g):
                        return {
                            "n_days": g.n_days, "mae": round(g.mae, 2),
                            "bias": round(g.bias, 2),
                            "bucket_hit_rate": round(g.bucket_hit_rate, 4)
                            if g.bucket_hit_rate is not None else None,
                        }
                    out["model_grades"] = {
                        "window_days": verify_days,
                        "lead": "day_ahead",
                        "overall": {m: _grade_json(g) for m, g in overall.items()},
                        "by_city": {
                            city: {m: _grade_json(g) for m, g in models.items()}
                            for city, models in
                            model_store.city_grades("day_ahead", min(m_dates)).items()
                        },
                    }
        except Exception:  # noqa: BLE001 - grading must never break the ladder
            out["model_grades"] = None
        return out

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
