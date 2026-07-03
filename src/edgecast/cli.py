"""CLI: `edgecast analyze <scenarios.json> [--output PATH] [--edge-threshold X]`."""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from edgecast.edge import DEFAULT_EDGE_THRESHOLD
from edgecast.jsonio import ScenarioValidationError, build_output, read_scenarios_file
from edgecast.pipeline import analyze


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="edgecast",
        description=(
            "Compare weather prediction-market probabilities against "
            "forecast-model probabilities and verify against observations."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)
    p_analyze = sub.add_parser(
        "analyze", help="analyze a scenarios JSON file and emit results JSON"
    )
    p_analyze.add_argument("scenarios_file", help="path to input scenarios JSON")
    p_analyze.add_argument(
        "--output", help="write results JSON to this path instead of stdout"
    )
    p_analyze.add_argument(
        "--edge-threshold",
        type=float,
        default=DEFAULT_EDGE_THRESHOLD,
        help=f"|edge| at or above this is flagged (default {DEFAULT_EDGE_THRESHOLD})",
    )
    p_serve = sub.add_parser("serve", help="serve the dashboard API and UI locally")
    p_serve.add_argument("--port", type=int, default=8000)
    p_serve.add_argument(
        "--fixtures-dir", default="fixtures", help="directory of scenario JSON files"
    )
    p_serve.add_argument("--db", default="data/edgecast.db")
    p_serve.add_argument("--verify-days", type=int, default=30)
    p_backfill = sub.add_parser(
        "backfill", help="verify past days of settled markets into the local store"
    )
    p_backfill.add_argument("--days", type=int, default=30)
    p_backfill.add_argument("--db", default="data/edgecast.db")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    if args.command == "serve":
        return _serve(args)
    if args.command == "backfill":
        return _backfill(args)
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
    app = create_app(
        Path(args.fixtures_dir), db_path=args.db, verify_days=args.verify_days
    )
    print(f"EdgeCast serving on http://127.0.0.1:{args.port}")
    uvicorn.run(app, host="127.0.0.1", port=args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
