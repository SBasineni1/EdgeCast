import json
from pathlib import Path

import pytest

from edgecast.live.openmeteo import daily_highs

PAYLOAD = json.loads(
    (Path(__file__).parent / "fixtures_live" / "openmeteo_ensemble.json").read_text()
)
FIXTURE_DATE = PAYLOAD["hourly"]["time"][0][:10]


def test_daily_highs_one_value_per_member():
    member_keys = [k for k in PAYLOAD["hourly"] if k.startswith("temperature_2m")]
    highs = daily_highs(PAYLOAD, FIXTURE_DATE)
    assert len(highs) == len(member_keys)
    assert all(isinstance(h, float) for h in highs)
    assert all(-60.0 < h < 140.0 for h in highs)


def test_daily_highs_is_max_within_local_date():
    hourly = {
        "time": ["2026-07-03T00:00", "2026-07-03T12:00", "2026-07-04T00:00"],
        "temperature_2m": [70.0, 91.5, 99.0],
        "temperature_2m_member01": [68.0, 89.0, 55.0],
    }
    assert daily_highs({"hourly": hourly}, "2026-07-03") == (91.5, 89.0)


def test_daily_highs_skips_members_with_missing_data():
    hourly = {
        "time": ["2026-07-03T00:00", "2026-07-03T12:00"],
        "temperature_2m": [70.0, 91.5],
        "temperature_2m_member01": [None, None],
    }
    assert daily_highs({"hourly": hourly}, "2026-07-03") == (91.5,)


def test_daily_highs_empty_date_raises():
    hourly = {"time": ["2026-07-03T00:00"], "temperature_2m": [70.0]}
    with pytest.raises(ValueError, match="no hourly data"):
        daily_highs({"hourly": hourly}, "2026-07-09")

from edgecast.live.openmeteo import past_days_for, reduce_past_highs


def test_reduce_past_highs_per_date():
    hourly = {
        "time": ["2026-07-01T00:00", "2026-07-01T12:00", "2026-07-02T12:00"],
        "temperature_2m": [70.0, 91.5, 88.0],
        "temperature_2m_member01": [68.0, 89.0, 90.5],
    }
    out = reduce_past_highs({"hourly": hourly}, ["2026-07-01", "2026-07-02", "2026-07-09"])
    assert out["2026-07-01"] == (91.5, 89.0)
    assert out["2026-07-02"] == (88.0, 90.5)
    assert "2026-07-09" not in out


def test_past_days_for_spans_earliest_date():
    from datetime import date

    n = past_days_for(["2026-07-01", "2026-06-25"], today=date(2026, 7, 3))
    assert n == 9  # (7/3 - 6/25) + 1, clamped to [1, 92]
    assert past_days_for(["2026-07-02"], today=date(2026, 7, 3)) == 2


def test_reduce_past_highs_omits_all_null_dates():
    hourly = {
        "time": ["2026-06-03T12:00", "2026-06-04T12:00"],
        "temperature_2m": [None, 88.0],
        "temperature_2m_member01": [None, 90.5],
    }
    out = reduce_past_highs({"hourly": hourly}, ["2026-06-03", "2026-06-04"])
    assert "2026-06-03" not in out
    assert out["2026-06-04"] == (88.0, 90.5)
