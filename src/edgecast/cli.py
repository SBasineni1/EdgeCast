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
    return parser


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


if __name__ == "__main__":
    raise SystemExit(main())
