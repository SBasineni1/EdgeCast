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
