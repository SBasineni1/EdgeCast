"""Opt-in real-network test: EDGECAST_LIVE_TESTS=1 uv run pytest tests/test_live_integration.py"""

import os

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("EDGECAST_LIVE_TESTS") != "1",
    reason="set EDGECAST_LIVE_TESTS=1 to hit real Kalshi/Open-Meteo APIs",
)


def test_live_assembly_against_real_apis():
    import httpx

    from edgecast.live.assemble import build_live_scenarios
    from edgecast.types import NormalForecast

    with httpx.Client() as kc, httpx.Client() as mc:
        result = build_live_scenarios(kc, mc)
    assert result.cities_ok, f"all cities failed: {result.cities_failed}"
    assert result.scenarios
    s = result.scenarios[0]
    assert 0.0 < s.market.yes_price < 1.0
    assert isinstance(s.forecast, NormalForecast)
    assert s.forecast.n_models >= 1


def test_backfill_two_days_against_real_apis(tmp_path):
    import httpx

    from edgecast.store import Store
    from edgecast.verify import verify_days
    from datetime import date, timedelta

    dates = [(date.today() - timedelta(days=i)).isoformat() for i in (1, 2)]
    store = Store(tmp_path / "real.db")
    with httpx.Client() as kc, httpx.Client() as mc:
        report = verify_days(dates, store, kc, mc)
    assert report.n_markets_verified > 0, f"failures: {report.failures}"
    stats = store.window_stats("gfs_seamless", min(dates))
    assert stats is not None and stats.n_days >= 1
