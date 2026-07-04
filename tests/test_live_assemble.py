import pytest

import edgecast.live.assemble as assemble_mod
from edgecast.live.cache import TTLCache
from edgecast.live.assemble import build_live_scenarios
from edgecast.types import NormalForecast


def test_ttl_cache_hit_expiry_and_stale():
    t = {"now": 1000.0}
    c = TTLCache(clock=lambda: t["now"])
    assert c.get("k", 30) is None
    c.put("k", "v")
    assert c.get("k", 30) == "v"
    t["now"] += 31
    assert c.get("k", 30) is None          # expired for fresh reads
    assert c.get_stale("k") == ("v", 31)   # still available as stale
    assert c.get_stale("missing") is None


def _kalshi_payload():
    return {"markets": [{
        "ticker": "KXHIGHNY-26JUL05-B95.5", "event_ticker": "KXHIGHNY-26JUL05",
        "title": "95-96", "strike_type": "between",
        "floor_strike": 95.0, "cap_strike": 96.0, "last_price": 40,
    }], "cursor": None}


def test_live_scenarios_use_normal_consensus(monkeypatch, tmp_path):
    assemble_mod.QUOTES_CACHE._store.clear()      # isolation from other tests
    assemble_mod.ENSEMBLES_CACHE._store.clear()
    monkeypatch.setattr(
        assemble_mod, "fetch_markets", lambda series, client: _kalshi_payload()["markets"]
    )
    monkeypatch.setattr(
        assemble_mod, "fetch_live_model_highs",
        lambda lat, lon, d, tz, client: {"ncep_nbm_conus": 96.0, "gfs_hrrr": 95.0,
                                         "gfs_global": None},
    )
    result = build_live_scenarios(None, None, model_store=None)
    nyc = [s for s in result.scenarios if s.market.location == "NYC"]
    assert nyc and isinstance(nyc[0].forecast, NormalForecast)
    f = nyc[0].forecast
    assert f.mu == pytest.approx(95.5) and f.n_models == 2       # GFS missing, no bias
    assert f.sigma == 2.5                                         # no store -> default
    assert result.model_highs["NYC"] == {
        "ncep_nbm_conus": 96.0, "gfs_hrrr": 95.0, "gfs_global": None, "consensus": 95.5,
    }
    assert result.consensus_sigma["NYC"] == 2.5
