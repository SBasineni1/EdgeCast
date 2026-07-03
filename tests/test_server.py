import json

import pytest
from fastapi.testclient import TestClient

from edgecast.server import create_app
from edgecast.store import Store, VerificationRow

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
    assert out["schema_version"] == "1.2"
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


def _fake_live_result(**kw):
    from edgecast.live.assemble import LiveResult
    from edgecast.types import EnsembleForecast, MarketQuote, Scenario

    scenario = Scenario(
        scenario_id="KXHIGHNY-26JUL03-B88.5",
        market=MarketQuote(
            market_id="KXHIGHNY-26JUL03-B88.5",
            question="Will the high in NYC be 88-89?",
            location="NYC",
            variable="high_temp_f",
            comparator="between",
            event_date="2026-07-03",
            yes_price=0.42,
            threshold_low=88.0,
            threshold_high=89.0,
        ),
        forecast=EnsembleForecast(
            source="open-meteo gfs_seamless",
            issued_at="2026-07-03T12:00:00+00:00",
            members=tuple([87.0] * 10 + [88.5] * 20),
        ),
        observation=None,
    )
    base = dict(
        scenarios=[scenario], cities_ok=["NYC"], cities_failed=[],
        quotes_age_seconds=5, ensembles_age_seconds=100,
    )
    base.update(kw)
    return LiveResult(**base)


def test_live_endpoint_happy_path(client, monkeypatch):
    import edgecast.server as server_mod

    monkeypatch.setattr(server_mod, "build_live_scenarios", lambda *a, **k: _fake_live_result())
    r = client.get("/api/live")
    assert r.status_code == 200
    out = r.json()
    assert out["schema_version"] == "1.2"
    assert out["results"][0]["model_prob"] == pytest.approx(20 / 30)
    assert out["results"][0]["market"]["threshold_low"] == 88.0
    assert out["live"]["cities_ok"] == ["NYC"]
    assert out["live"]["cities"]["NYC"]["series"] == "KXHIGHNY"
    assert out["aggregate"]["n_settled"] == 0


def test_live_endpoint_partial_failure_reported(client, monkeypatch):
    import edgecast.server as server_mod

    monkeypatch.setattr(
        server_mod,
        "build_live_scenarios",
        lambda *a, **k: _fake_live_result(
            cities_failed=[{"city": "MIA", "reason": "kalshi: HTTP 503"}]
        ),
    )
    out = client.get("/api/live").json()
    assert out["live"]["cities_failed"][0]["city"] == "MIA"


def test_live_endpoint_total_failure_502(client, monkeypatch):
    import edgecast.server as server_mod

    monkeypatch.setattr(
        server_mod,
        "build_live_scenarios",
        lambda *a, **k: _fake_live_result(
            scenarios=[], cities_ok=[],
            cities_failed=[{"city": "NYC", "reason": "kalshi: timeout"}],
        ),
    )
    r = client.get("/api/live")
    assert r.status_code == 502
    assert "NYC" in r.json()["detail"]


def test_live_endpoint_threshold_validation(client):
    assert client.get("/api/live?edge_threshold=1.5").status_code == 422


def seed_row(**kw) -> VerificationRow:
    base = dict(
        market_id="M1", model="gfs_seamless", series="KXHIGHNY", city="NYC",
        event_date="2026-07-02", comparator="between",
        threshold=None, threshold_low=88.0, threshold_high=89.0,
        question="q", market_prob=0.8, model_prob=0.6, model_prob_raw=0.6,
        n_members=31, observed_high=88.5, outcome=1, kalshi_result="yes",
        brier_market=0.04, brier_model=0.16,
        observed_source="ACIS KNYC", model_source="open-meteo gfs_seamless (short-lead)",
        verified_at="2026-07-03T12:00:00+00:00",
    )
    base.update(kw)
    return VerificationRow(**base)


@pytest.fixture
def live_client(fixtures_dir, tmp_path, monkeypatch):
    import edgecast.server as server_mod

    from edgecast.verify import VerifyReport

    monkeypatch.setattr(server_mod, "build_live_scenarios", lambda *a, **k: _fake_live_result())
    monkeypatch.setattr(
        server_mod, "run_verification",
        lambda dates, store, kc, mc, model="gfs_seamless": VerifyReport(dates_attempted=list(dates)),
    )
    db = tmp_path / "live.db"
    Store(db).upsert([seed_row()])
    app = create_app(fixtures_dir, web_dist=tmp_path / "no-dist", db_path=db)
    return TestClient(app)


def test_live_includes_verification_block(live_client):
    out = live_client.get("/api/live").json()
    v = out["verification"]
    assert v["window_days"] == 30
    assert v["model"] == "gfs_seamless"
    assert v["n_markets"] == 1
    assert v["mean_brier_market"] == 0.04
    assert v["hit_rate_market"] == 1.0
    assert v["better_calibrated"] == "market"
    assert v["by_city"]["NYC"]["n_markets"] == 1
    assert v["kalshi_mismatches"] == []


def test_live_verification_yesterday_block(live_client, monkeypatch):
    import edgecast.server as server_mod

    monkeypatch.setattr(server_mod, "_yesterday_iso", lambda: "2026-07-02")
    out = live_client.get("/api/live").json()
    y = out["verification"]["yesterday"]["NYC"]
    assert y["observed_high"] == 88.5
    assert y["settled_bucket"] == "88–89°"
    assert y["source"] == "ACIS KNYC"


def test_live_verification_null_on_store_failure(fixtures_dir, tmp_path, monkeypatch):
    import edgecast.server as server_mod

    monkeypatch.setattr(server_mod, "build_live_scenarios", lambda *a, **k: _fake_live_result())

    class Boom:
        def __init__(self, *a, **k):
            raise RuntimeError("cannot open db")

    monkeypatch.setattr(server_mod, "Store", Boom)
    app = create_app(fixtures_dir, web_dist=tmp_path / "no-dist", db_path=tmp_path / "x.db")
    out = TestClient(app).get("/api/live").json()
    assert out["verification"] is None
