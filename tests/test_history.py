from datetime import datetime, timezone

import httpx
import pytest

import edgecast.history as h
from edgecast.history import (
    HistoryReport,
    backfill_forecasts,
    backfill_markets,
    date_chunks,
    grade_history,
    issued_by,
    list_settled_markets,
    price_target,
)
from edgecast.history_store import HistoryStore
from edgecast.live.kalshi import quote_at
from edgecast.live.previous_runs import LeadHigh, fetch_previous_highs
from edgecast.live.stations import STATIONS
from edgecast.model_store import ModelStore


def ts(*a):
    return int(datetime(*a, tzinfo=timezone.utc).timestamp())


def no_sleep(_):
    pass


# --- point-in-time helpers ---------------------------------------------------

def test_price_target_is_11am_et_the_day_before_across_dst():
    assert price_target("2024-02-01") == datetime(2024, 1, 31, 16, tzinfo=timezone.utc)  # EST
    assert price_target("2025-07-04") == datetime(2025, 7, 3, 15, tzinfo=timezone.utc)   # EDT


def test_issued_by_subtracts_lead_hours_from_last_valid_local_hour():
    # 23:00 EDT = 03:00Z next day; lead 1 -> 24 h earlier
    assert issued_by("2025-07-04T23:00", "America/New_York", 1) == "2025-07-04T03:00:00+00:00"
    assert issued_by("2025-07-04T23:00", "America/New_York", 2) == "2025-07-03T03:00:00+00:00"
    # Phoenix never shifts: 23:00 MST = 06:00Z
    assert issued_by("2024-02-01T23:00", "America/Phoenix", 1) == "2024-02-01T06:00:00+00:00"


def test_date_chunks_cover_range_without_overlap():
    assert date_chunks("2024-02-28", "2024-03-03", 3) == [
        ("2024-02-28", "2024-03-01"), ("2024-03-02", "2024-03-03"),
    ]


# --- Kalshi candle -> quote ---------------------------------------------------

HIST_CANDLES = [  # historical shape: sparse hours, "close" keys
    {"end_period_ts": ts(2024, 1, 31, 16), "volume": "0.00",
     "yes_bid": {"close": "0.0000"}, "yes_ask": {"close": "0.2900"},
     "price": {"close": None}},
    {"end_period_ts": ts(2024, 1, 31, 19), "volume": "5.00",
     "yes_bid": {"close": "0.0900"}, "yes_ask": {"close": "0.1300"},
     "price": {"close": "0.1000"}},
]


def test_quote_at_uses_last_candle_ending_by_target():
    q = quote_at(HIST_CANDLES, ts(2024, 1, 31, 18))
    assert q["as_of_ts"] == ts(2024, 1, 31, 16)
    assert (q["yes_bid"], q["yes_ask"], q["last_price"]) == (0.0, 0.29, None)
    later = quote_at(HIST_CANDLES, ts(2024, 1, 31, 20))
    assert later["yes_ask"] == 0.13 and later["volume"] == 5.0


def test_quote_at_reads_live_dollar_keys_and_none_before_first_candle():
    live = [{"end_period_ts": 100, "volume_fp": "33.00",
             "yes_bid": {"close_dollars": "0.0300"}, "yes_ask": {"close_dollars": "0.0500"},
             "price": {"close_dollars": "0.0400"}}]
    assert quote_at(live, 100)["last_price"] == 0.04
    assert quote_at(live, 99) is None


# --- forecasts ------------------------------------------------------------------

def _om_payload():
    times = [f"2024-02-01T{hh:02d}:00" for hh in range(24)]
    return {"hourly": {
        "time": times,
        "temperature_2m_previous_day1_gfs_global": [40.0 + i for i in range(24)],
        "temperature_2m_previous_day2_gfs_global": [30.0] * 23 + [None],
        "temperature_2m_previous_day1_ecmwf_ifs025": [None] * 24,
    }}


def test_fetch_previous_highs_tracks_hours_and_last_valid():
    client = httpx.Client(transport=httpx.MockTransport(
        lambda req: httpx.Response(200, json=_om_payload())))
    out = fetch_previous_highs(0, 0, "2024-02-01", "2024-02-01", "UTC", client,
                               models=("gfs_global", "ecmwf_ifs025"))
    assert out[("gfs_global", 1)]["2024-02-01"] == LeadHigh(63.0, 24, "2024-02-01T23:00")
    assert out[("gfs_global", 2)]["2024-02-01"] == LeadHigh(30.0, 23, "2024-02-01T22:00")
    assert out[("ecmwf_ifs025", 1)] == {}


def test_backfill_forecasts_writes_issue_times_and_skips_done_chunks(tmp_path, monkeypatch):
    monkeypatch.setattr(h, "STATIONS", {"KXHIGHNY": STATIONS["KXHIGHNY"]})
    calls = []

    def handler(req):
        calls.append(req)
        return httpx.Response(200, json=_om_payload())

    client = httpx.Client(transport=httpx.MockTransport(handler))
    store = HistoryStore(tmp_path / "h.db")
    report = HistoryReport()
    backfill_forecasts(store, "2024-02-01", "2024-02-01", client, report, sleep=no_sleep)
    assert report.forecast_rows == 2
    assert calls[0].url.params["hourly"] == (
        "temperature_2m_previous_day1,temperature_2m_previous_day2")
    rows = store._conn.execute(
        "SELECT model, lead_days, predicted_high, n_hours, issued_by FROM forecast_history "
        "ORDER BY lead_days").fetchall()
    # NYC 23:00 EST = 04:00Z Feb 2; minus 24 h / 48 h (day-2's last hour is 22:00)
    assert rows == [
        ("gfs_global", 1, 63.0, 24, "2024-02-01T04:00:00+00:00"),
        ("gfs_global", 2, 30.0, 23, "2024-01-31T03:00:00+00:00"),
    ]
    backfill_forecasts(store, "2024-02-01", "2024-02-01", client, report, sleep=no_sleep)
    assert len(calls) == 1  # chunk already complete


# --- markets --------------------------------------------------------------------

LEGACY_MARKETS = [
    {"ticker": "HIGHNY-24FEB01-B45.5", "event_ticker": "HIGHNY-24FEB01",
     "strike_type": "between", "floor_strike": 45, "cap_strike": 46, "result": "yes",
     "expiration_value": "46.00", "open_time": "2024-01-31T15:00:00Z",
     "close_time": "2024-02-02T04:59:00Z", "settlement_ts": "2024-02-02T14:04:00Z",
     "last_price_dollars": "0.9900", "title": "46"},
    {"ticker": "HIGHNY-24FEB01-T52", "event_ticker": "HIGHNY-24FEB01",
     "strike_type": "greater", "floor_strike": 52, "result": "no",
     "expiration_value": "", "open_time": "2024-01-31T15:00:00Z",
     "last_price_dollars": "0.0100"},
    {"ticker": "HIGHNY-23JAN01-T40", "event_ticker": "HIGHNY-23JAN01",  # out of range
     "strike_type": "greater", "floor_strike": 40, "result": "no"},
]


def _kalshi_handler(calls):
    def handler(req):
        calls.append(req)
        path = req.url.path
        if path.endswith("/historical/cutoff"):
            return httpx.Response(200, json={"market_settled_ts": "2026-07-25T00:00:00Z"})
        if path.endswith("/historical/markets"):
            return httpx.Response(200, json={"markets": LEGACY_MARKETS, "cursor": ""})
        if path.endswith("/markets"):
            return httpx.Response(200, json={"markets": [], "cursor": ""})
        if path.endswith("/candlesticks"):
            return httpx.Response(200, json={"candlesticks": HIST_CANDLES})
        return httpx.Response(404)
    return handler


@pytest.fixture
def one_city(monkeypatch):
    monkeypatch.setattr(h, "STATIONS", {"KXHIGHNY": STATIONS["KXHIGHNY"]})


def test_markets_backfill_records_settlement_and_pre_settlement_quote(tmp_path, one_city):
    calls = []
    client = httpx.Client(transport=httpx.MockTransport(_kalshi_handler(calls)))
    report = HistoryReport()
    markets = list_settled_markets("2024-02-01", "2024-02-01", client, report, sleep=no_sleep)
    assert [m["ticker"] for m, _ in markets["KXHIGHNY"]] == [
        "HIGHNY-24FEB01-B45.5", "HIGHNY-24FEB01-T52"]
    store = HistoryStore(tmp_path / "h.db")
    backfill_markets(store, "2024-02-01", "2024-02-01", markets, client, report, sleep=no_sleep)
    assert (report.markets, report.quotes, report.failures) == (2, 2, [])

    candle_req = next(r for r in calls if r.url.path.endswith("/candlesticks"))
    assert candle_req.url.path.endswith("/historical/markets/HIGHNY-24FEB01-B45.5/candlesticks")
    assert int(candle_req.url.params["end_ts"]) == ts(2024, 1, 31, 16)  # 11 AM EST

    row = store._conn.execute(
        "SELECT city, event_date, result, settled_value, price_target_at, "
        "price_observed_at, yes_bid, yes_ask FROM market_history WHERE ticker = ?",
        ("HIGHNY-24FEB01-B45.5",)).fetchone()
    assert row == ("NYC", "2024-02-01", "yes", 46.0, "2024-01-31T16:00:00+00:00",
                   "2024-01-31T16:00:00+00:00", 0.0, 0.29)

    n_before = len(calls)
    backfill_markets(store, "2024-02-01", "2024-02-01", markets, client, report, sleep=no_sleep)
    assert len(calls) == n_before  # quotes already fetched; metadata refresh keeps them
    assert store._conn.execute(
        "SELECT yes_ask FROM market_history WHERE ticker = 'HIGHNY-24FEB01-B45.5'"
    ).fetchone() == (0.29,)


def test_archive_skipped_when_range_is_after_cutoff(one_city):
    calls = []
    client = httpx.Client(transport=httpx.MockTransport(_kalshi_handler(calls)))
    list_settled_markets("2026-09-01", "2026-09-02", client, HistoryReport(), sleep=no_sleep)
    assert not any(r.url.path.endswith("/historical/markets") for r in calls)
    live = next(r for r in calls if r.url.path.endswith("/markets"))
    assert live.url.params["status"] == "settled"


def test_retrying_backs_off_on_429_then_succeeds():
    attempts = []

    def flaky():
        attempts.append(1)
        if len(attempts) < 3:
            raise httpx.HTTPStatusError(
                "429", request=httpx.Request("GET", "http://x"),
                response=httpx.Response(429))
        return "ok"

    slept = []
    assert h._retrying(flaky, sleep=slept.append) == "ok"
    assert slept == [2.0, 8.0]


# --- grading uses the listing, not per-day Kalshi calls -------------------------

def test_grade_history_grades_against_listed_settled_bucket(tmp_path, one_city, monkeypatch):
    import edgecast.grade as grade_mod

    monkeypatch.setattr(grade_mod, "STATIONS", {"KXHIGHNY": STATIONS["KXHIGHNY"]})
    monkeypatch.setattr(grade_mod, "fetch_observed_highs",
                        lambda sid, s, e, c: {"2024-02-01": 46.0})
    monkeypatch.setattr(grade_mod, "fetch_previous_day1_highs",
                        lambda *a: {"gfs_global": {"2024-02-01": 45.6}})
    monkeypatch.setattr(grade_mod, "fetch_event_markets",
                        lambda *a: pytest.fail("per-day Kalshi call"))
    markets = {"KXHIGHNY": [(m, "historical") for m in LEGACY_MARKETS[:2]]}
    store = ModelStore(tmp_path / "g.db")
    report = HistoryReport()
    grade_history(store, "2024-02-01", "2024-02-01", markets, None, None, report)
    assert report.graded_rows == 2  # gfs_global + consensus
    hits = store._conn.execute(
        "SELECT model, bucket_hit FROM model_days ORDER BY model").fetchall()
    assert hits == [("consensus", 1), ("gfs_global", 1)]  # 45.6 rounds to 46 in [45,46]
