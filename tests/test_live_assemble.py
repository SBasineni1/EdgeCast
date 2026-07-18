import pytest

import edgecast.live.assemble as assemble_mod
from edgecast.blend.artifact import Artifact, ArtifactStore, GBM_KIND
from edgecast.blend.features import FEATURE_NAMES
from edgecast.consensus import MIN_GRADED_DAYS, consensus_sigma
from edgecast.live.cache import TTLCache
from edgecast.live.assemble import build_live_scenarios
from edgecast.model_store import ModelStore
from edgecast.types import NormalForecast


@pytest.fixture(autouse=True)
def clear_live_caches():
    assemble_mod.QUOTES_CACHE._store.clear()
    assemble_mod.ENSEMBLES_CACHE._store.clear()
    assemble_mod.ARTIFACT_CACHE._store.clear()


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


def _handwritten_dump():
    return {
        "max_feature_idx": 1,
        "tree_info": [
            {"tree_structure": {
                "split_feature": 0, "threshold": 95.5, "decision_type": "<=",
                "default_left": True, "missing_type": "NaN",
                "left_child": {"leaf_value": 2.0},
                "right_child": {"leaf_value": -1.0},
            }},
            {"tree_structure": {
                "split_feature": 1, "threshold": 94.0, "decision_type": "<=",
                "default_left": False, "missing_type": "None",
                "left_child": {"leaf_value": 0.5},
                "right_child": {"leaf_value": -0.5},
            }},
        ],
    }


def _artifact(feature_names=FEATURE_NAMES, city_order=("NYC",)):
    return Artifact(
        kind=GBM_KIND, lead="day_ahead", created_at="2026-07-04T00:00:00Z",
        train_end_date="2026-07-03", n_rows=10,
        feature_names=tuple(feature_names), city_order=tuple(city_order),
        params={}, model_json=_handwritten_dump(), metrics={}, promoted=1,
    )


def _patch_live_sources(monkeypatch):
    monkeypatch.setattr(
        assemble_mod, "fetch_markets", lambda series, client: _kalshi_payload()["markets"]
    )
    monkeypatch.setattr(
        assemble_mod, "fetch_live_model_highs",
        lambda lat, lon, d, tz, client: {
            "ncep_nbm_conus": 96.0, "gfs_hrrr": 95.0, "gfs_global": None,
        },
    )


def _nyc_forecast(result):
    return next(s.forecast for s in result.scenarios if s.market.location == "NYC")


def test_live_scenarios_add_promoted_gbm_residual(monkeypatch, tmp_path):
    _patch_live_sources(monkeypatch)
    artifact_store = ArtifactStore(tmp_path / "live.db")
    artifact_store.insert(_artifact())

    forecast = _nyc_forecast(
        build_live_scenarios(None, None, artifact_store=artifact_store)
    )

    # baseline 95.5; feature[0] takes -1.0 and feature[1] takes -0.5.
    assert forecast.mu == pytest.approx(94.0)
    assert forecast.source.startswith("gbm-v")


@pytest.mark.parametrize(
    "artifact",
    [
        None,
        _artifact(feature_names=("wrong",)),
        _artifact(city_order=("MIA",)),
    ],
    ids=["no-artifact", "wrong-features", "city-missing"],
)
def test_live_scenarios_fall_back_to_consensus(monkeypatch, tmp_path, artifact):
    _patch_live_sources(monkeypatch)
    artifact_store = ArtifactStore(tmp_path / "live.db")
    if artifact is not None:
        artifact_store.insert(artifact)

    forecast = _nyc_forecast(
        build_live_scenarios(None, None, artifact_store=artifact_store)
    )

    assert forecast.mu == pytest.approx(95.5)
    assert forecast.source == "consensus(gfs_hrrr,ncep_nbm_conus)"


@pytest.mark.parametrize("n_gbm", [MIN_GRADED_DAYS - 1, MIN_GRADED_DAYS])
def test_live_sigma_prefers_sufficient_gbm_errors(monkeypatch, tmp_path, n_gbm):
    from tests.test_model_store import row

    _patch_live_sources(monkeypatch)
    model_store = ModelStore(tmp_path / "live.db")
    consensus_errors = [0.0, 2.0, 4.0, 6.0, 8.0]
    gbm_errors = [-2.0, -1.0, 0.0, 1.0, 2.0][:n_gbm]
    model_store.upsert([
        row(model="consensus", d=f"2026-06-{i + 1:02d}", pred=90.0 + error, obs=90.0)
        for i, error in enumerate(consensus_errors)
    ] + [
        row(model="gbm", d=f"2026-05-{i + 1:02d}", pred=90.0 + error, obs=90.0)
        for i, error in enumerate(gbm_errors)
    ])

    forecast = _nyc_forecast(build_live_scenarios(None, None, model_store=model_store))
    expected_errors = gbm_errors if n_gbm >= MIN_GRADED_DAYS else consensus_errors
    assert forecast.sigma == pytest.approx(consensus_sigma(expected_errors))
