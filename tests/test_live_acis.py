import json
from pathlib import Path

import pytest

from edgecast.live.acis import AcisUnavailable, parse_stndata
from edgecast.live.stations import STATIONS

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures_live" / "acis_stndata.json").read_text()
)


def test_stations_have_acis_sids():
    assert STATIONS["KXHIGHAUS"].acis_sid == "KAUS"  # Kalshi settles Bergstrom
    assert STATIONS["KXHIGHNY"].acis_sid == "KNYC"
    assert all(s.acis_sid.startswith("K") for s in STATIONS.values())


def test_parse_fixture_range():
    highs = parse_stndata(FIXTURE)
    assert len(highs) >= 25
    for d, v in highs.items():
        assert len(d) == 10 and d[4] == "-"
        assert -60.0 < v < 130.0


def test_parse_skips_missing():
    payload = {"data": [["2026-07-01", "96"], ["2026-07-02", "M"], ["2026-07-03", "101"]]}
    assert parse_stndata(payload) == {"2026-07-01": 96.0, "2026-07-03": 101.0}


def test_parse_error_payload_raises():
    with pytest.raises(AcisUnavailable, match="no data"):
        parse_stndata({"error": "no data available"})
