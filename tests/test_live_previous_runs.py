import json
from pathlib import Path

import httpx
import pytest

from edgecast.live.previous_runs import (
    SOURCE_MODELS,
    _daily_highs_by_model,
    fetch_live_model_highs,
    fetch_previous_day1_highs,
)

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures_live" / "openmeteo_previous_runs.json").read_text()
)


def test_source_models_exact():
    assert SOURCE_MODELS == ("ncep_nbm_conus", "gfs_hrrr", "gfs_global")


def test_reduces_fixture_to_per_model_daily_highs():
    out = _daily_highs_by_model(FIXTURE, SOURCE_MODELS, "temperature_2m_previous_day1")
    assert set(out) == set(SOURCE_MODELS)
    for m in SOURCE_MODELS:
        assert set(out[m]) == {"2026-06-28", "2026-06-29", "2026-06-30"}
        # each high equals the max of that model's hourly values on the date
        key = f"temperature_2m_previous_day1_{m}"
        expected = max(
            v for t, v in zip(FIXTURE["hourly"]["time"], FIXTURE["hourly"][key])
            if t.startswith("2026-06-29") and v is not None
        )
        assert out[m]["2026-06-29"] == pytest.approx(expected)


def test_single_model_bare_key():
    payload = {"hourly": {"time": ["2026-07-01T00:00", "2026-07-01T12:00"],
                          "temperature_2m_previous_day1": [70.0, 88.5]}}
    out = _daily_highs_by_model(payload, ("gfs_hrrr",), "temperature_2m_previous_day1")
    assert out == {"gfs_hrrr": {"2026-07-01": 88.5}}


def test_all_null_model_yields_empty_dict():
    payload = {"hourly": {"time": ["2026-07-01T00:00"],
                          "temperature_2m_previous_day1_gfs_hrrr": [None],
                          "temperature_2m_previous_day1_gfs_global": [80.0]}}
    out = _daily_highs_by_model(payload, ("gfs_hrrr", "gfs_global"), "temperature_2m_previous_day1")
    assert out["gfs_hrrr"] == {}
    assert out["gfs_global"] == {"2026-07-01": 80.0}


def _transport(payload):
    return httpx.MockTransport(lambda req: httpx.Response(200, json=payload))


def test_fetch_previous_day1_highs_params_and_shape():
    seen = {}

    def handler(req):
        seen.update(dict(req.url.params))
        return httpx.Response(200, json=FIXTURE)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    out = fetch_previous_day1_highs(40.783, -73.967, "2026-06-28", "2026-06-30",
                                    "America/New_York", client)
    assert seen["models"] == "ncep_nbm_conus,gfs_hrrr,gfs_global"
    assert seen["hourly"] == "temperature_2m_previous_day1"
    assert seen["temperature_unit"] == "fahrenheit"
    assert seen["start_date"] == "2026-06-28" and seen["end_date"] == "2026-06-30"
    assert set(out) == set(SOURCE_MODELS)


def test_fetch_live_model_highs_returns_none_for_missing_model():
    payload = {"hourly": {"time": ["2026-07-05T00:00", "2026-07-05T14:00"],
                          "temperature_2m_ncep_nbm_conus": [80.0, 96.4],
                          "temperature_2m_gfs_hrrr": [None, None],
                          "temperature_2m_gfs_global": [82.0, 102.2]}}
    client = httpx.Client(transport=_transport(payload))
    out = fetch_live_model_highs(30.195, -97.670, "2026-07-05", "America/Chicago", client)
    assert out == {"ncep_nbm_conus": 96.4, "gfs_hrrr": None, "gfs_global": 102.2}
