from datetime import date, datetime, timezone

import httpx
import pytest

from edgecast.store import Store
from edgecast.verify import verify_days

# Minimal fake upstream data: one city (patched registry), one date, two markets.
FAKE_MARKETS = [
    {
        "ticker": "KXHIGHAUS-26JUL02-B96.5",
        "event_ticker": "KXHIGHAUS-26JUL02",
        "title": "96-97?",
        "strike_type": "between",
        "floor_strike": 96.0,
        "cap_strike": 97.0,
        "last_price_dollars": "0.8500",
        "result": "yes",
    },
    {
        "ticker": "KXHIGHAUS-26JUL02-T98",
        "event_ticker": "KXHIGHAUS-26JUL02",
        "title": ">=98?",
        "strike_type": "greater",
        "floor_strike": 97.5,
        "last_price_dollars": "0.1000",
        "result": "yes",  # deliberately wrong vs observed 96.0 -> mismatch
    },
]


@pytest.fixture
def patched(monkeypatch):
    import edgecast.verify as v
    from edgecast.live.stations import Station

    station = Station(
        "KXHIGHAUS", "AUS", "Austin", "Camp Mabry", 30.321, -97.760,
        "America/Chicago", "KATT",
    )
    monkeypatch.setattr(v, "STATIONS", {"KXHIGHAUS": station})
    monkeypatch.setattr(v, "fetch_event_markets", lambda et, c: FAKE_MARKETS)
    monkeypatch.setattr(
        v, "fetch_observed_highs", lambda sid, s, e, c: {"2026-07-02": 96.0}
    )
    monkeypatch.setattr(
        v,
        "fetch_ensemble_past_highs",
        lambda lat, lon, dates, tz, c, model="gfs_seamless": {
            "2026-07-02": tuple([96.2] * 20 + [95.0] * 10)
        },
    )
    return v


def test_verify_days_scores_and_stores(patched, tmp_path):
    store = Store(tmp_path / "v.db")
    report = verify_days(["2026-07-02"], store, None, None)
    assert report.n_markets_verified == 2
    rows = {r.market_id: r for r in store.rows_for_date("gfs_seamless", "2026-07-02")}
    between = rows["KXHIGHAUS-26JUL02-B96.5"]
    assert between.outcome == 1                      # 96.0 in [96, 97]
    assert between.observed_high == 96.0
    assert between.market_prob == 0.85
    assert between.brier_market == pytest.approx(0.0225)
    # model prob: 20/30 in range -> clamped stays 2/3
    assert between.model_prob == pytest.approx(20 / 30)
    assert between.observed_source == "ACIS KATT"
    # mismatch captured: T98 kalshi says yes, we compute 0
    assert report.mismatches == [
        {
            "market_id": "KXHIGHAUS-26JUL02-T98",
            "kalshi_result": "yes",
            "edgecast_outcome": 0,
        }
    ]


def test_verify_skips_covered(patched, tmp_path):
    store = Store(tmp_path / "v.db")
    verify_days(["2026-07-02"], store, None, None)
    calls = {"n": 0}
    patched.fetch_event_markets = None  # would crash if called again

    def counting(et, c):
        calls["n"] += 1
        return FAKE_MARKETS

    import edgecast.verify as v

    v.fetch_event_markets = counting
    report = verify_days(["2026-07-02"], store, None, None)
    assert calls["n"] == 0
    assert report.n_markets_verified == 0


def test_verify_isolates_stage_failures(patched, tmp_path, monkeypatch):
    import edgecast.verify as v

    monkeypatch.setattr(
        v, "fetch_observed_highs",
        lambda *a, **k: (_ for _ in ()).throw(v.AcisUnavailable("boom")),
    )
    store = Store(tmp_path / "v.db")
    report = verify_days(["2026-07-02"], store, None, None)
    assert report.n_markets_verified == 0
    assert report.failures == [
        {"city": "AUS", "date": "2026-07-02", "stage": "acis", "reason": "boom"}
    ]


def _http_429():
    req = httpx.Request("GET", "https://ensemble-api.open-meteo.com/v1/ensemble")
    return httpx.HTTPStatusError(
        "429 Too Many Requests", request=req, response=httpx.Response(429, request=req)
    )


def test_verify_retries_ensemble_on_429(patched, tmp_path, monkeypatch):
    import edgecast.verify as v

    calls = {"n": 0}

    def flaky(lat, lon, dates, tz, c, model="gfs_seamless"):
        calls["n"] += 1
        if calls["n"] < 3:
            raise _http_429()
        return {"2026-07-02": tuple([96.2] * 20 + [95.0] * 10)}

    monkeypatch.setattr(v, "fetch_ensemble_past_highs", flaky)
    sleeps: list[float] = []
    monkeypatch.setattr(v.time, "sleep", lambda s: sleeps.append(s))
    store = Store(tmp_path / "v.db")
    report = verify_days(["2026-07-02"], store, None, None)
    assert calls["n"] == 3
    assert sleeps == [2.0, 8.0]
    assert report.n_markets_verified == 2
    assert report.failures == []


def test_verify_gives_up_after_persistent_429(patched, tmp_path, monkeypatch):
    import edgecast.verify as v

    monkeypatch.setattr(
        v, "fetch_ensemble_past_highs",
        lambda *a, **k: (_ for _ in ()).throw(_http_429()),
    )
    monkeypatch.setattr(v.time, "sleep", lambda s: None)
    store = Store(tmp_path / "v.db")
    report = verify_days(["2026-07-02"], store, None, None)
    assert report.n_markets_verified == 0
    assert len(report.failures) == 1
    assert report.failures[0]["stage"] == "open-meteo"
    assert "429" in report.failures[0]["reason"]


def test_verify_does_not_retry_non_429(patched, tmp_path, monkeypatch):
    import edgecast.verify as v

    req = httpx.Request("GET", "https://ensemble-api.open-meteo.com/v1/ensemble")
    err = httpx.HTTPStatusError(
        "500", request=req, response=httpx.Response(500, request=req)
    )
    calls = {"n": 0}

    def failing(*a, **k):
        calls["n"] += 1
        raise err

    monkeypatch.setattr(v, "fetch_ensemble_past_highs", failing)
    store = Store(tmp_path / "v.db")
    report = verify_days(["2026-07-02"], store, None, None)
    assert calls["n"] == 1
    assert report.failures[0]["stage"] == "open-meteo"
