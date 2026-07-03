import json

import pytest

from edgecast.cli import main

SCENARIOS = {
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
def scenarios_file(tmp_path):
    p = tmp_path / "scenarios.json"
    p.write_text(json.dumps(SCENARIOS))
    return p


def test_analyze_writes_json_to_stdout(scenarios_file, capsys):
    rc = main(["analyze", str(scenarios_file)])
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    assert out["schema_version"] == "1.2"
    assert "generated_at" in out
    assert out["results"][0]["scenario_id"] == "s1"
    assert out["aggregate"]["n_settled"] == 1


def test_analyze_writes_output_file(scenarios_file, tmp_path):
    out_path = tmp_path / "out.json"
    rc = main(["analyze", str(scenarios_file), "--output", str(out_path)])
    assert rc == 0
    out = json.loads(out_path.read_text())
    assert out["results"][0]["market_prob"] == 0.72


def test_edge_threshold_flag(scenarios_file, capsys):
    # model prob 0.75 vs market 0.72 -> edge 0.03
    rc = main(["analyze", str(scenarios_file), "--edge-threshold", "0.02"])
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    assert out["results"][0]["edge"]["flag"] == "model_higher"


def test_invalid_input_exits_nonzero(tmp_path, capsys):
    bad = json.loads(json.dumps(SCENARIOS))
    bad["scenarios"][0]["market"]["yes_price"] = 2.0
    p = tmp_path / "bad.json"
    p.write_text(json.dumps(bad))
    rc = main(["analyze", str(p)])
    assert rc == 2
    err = capsys.readouterr().err
    assert "yes_price" in err
    assert "s1" in err


def test_missing_file_exits_nonzero(tmp_path, capsys):
    rc = main(["analyze", str(tmp_path / "nope.json")])
    assert rc == 2
    assert "error" in capsys.readouterr().err.lower()


def test_malformed_json_exits_nonzero(tmp_path, capsys):
    p = tmp_path / "broken.json"
    p.write_text("{not json")
    rc = main(["analyze", str(p)])
    assert rc == 2


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


def test_backfill_invokes_verifier(monkeypatch, tmp_path):
    import edgecast.verify as verify_mod
    from edgecast.verify import VerifyReport

    seen = {}

    def fake_verify(dates, store, kc, mc, model="gfs_seamless"):
        seen["dates"] = dates
        return VerifyReport(
            dates_attempted=dates, n_markets_verified=7, failures=[], mismatches=[]
        )

    monkeypatch.setattr(verify_mod, "verify_days", fake_verify)
    rc = main(["backfill", "--days", "3", "--db", str(tmp_path / "b.db")])
    assert rc == 0
    assert len(seen["dates"]) == 3
