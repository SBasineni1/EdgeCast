import json
from pathlib import Path

import pytest

from edgecast.live.kalshi import event_date_from_ticker, to_quote
from edgecast.live.stations import STATIONS

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures_live" / "kalshi_markets.json").read_text()
)


def test_stations_registry_shape():
    assert "KXHIGHNY" in STATIONS
    ny = STATIONS["KXHIGHNY"]
    assert ny.city == "NYC"
    assert 40 < ny.lat < 41 and -75 < ny.lon < -73
    assert all(s.tz for s in STATIONS.values())


def test_event_date_from_ticker():
    assert event_date_from_ticker("KXHIGHNY-26JUL03") == "2026-07-03"
    assert event_date_from_ticker("KXHIGHCHI-26DEC31") == "2026-12-31"


def test_event_date_rejects_garbage():
    with pytest.raises(ValueError):
        event_date_from_ticker("KXHIGHNY")


def test_to_quote_maps_fixture_markets():
    quotes = [to_quote(m, "NYC") for m in FIXTURE["markets"]]
    usable = [q for q in quotes if q is not None]
    assert usable, "fixture should yield at least one usable quote"
    for q in usable:
        assert 0.0 < q.yes_price < 1.0
        assert q.location == "NYC"
        if q.comparator == "between":
            assert q.threshold_low is not None and q.threshold_low <= q.threshold_high
        else:
            assert q.comparator in (">", "<") and q.threshold is not None


def test_to_quote_price_fallback_and_skips():
    base = dict(FIXTURE["markets"][0])
    base.update(strike_type="greater", floor_strike=90.0, last_price=0, yes_bid=40, yes_ask=44)
    q = to_quote(base, "NYC")
    assert q is not None and q.yes_price == pytest.approx(0.42)
    base.update(last_price=0, yes_bid=0, yes_ask=0)
    assert to_quote(base, "NYC") is None
    base.update(strike_type="weird_new_type", last_price=50)
    assert to_quote(base, "NYC") is None

from datetime import date

from edgecast.live.kalshi import event_ticker_for, to_result


def test_event_ticker_format():
    assert event_ticker_for("KXHIGHNY", date(2026, 7, 2)) == "KXHIGHNY-26JUL02"
    assert event_ticker_for("KXHIGHCHI", date(2026, 12, 9)) == "KXHIGHCHI-26DEC09"


def test_to_result():
    assert to_result({"result": "yes"}) == "yes"
    assert to_result({"result": "no"}) == "no"
    assert to_result({"result": ""}) is None
    assert to_result({}) is None
