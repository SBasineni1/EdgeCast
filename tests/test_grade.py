import pytest

import edgecast.grade as grade_mod
from edgecast.blend.artifact import Artifact, ArtifactStore, GBM_KIND
from edgecast.blend.features import FEATURE_NAMES
from edgecast.grade import GradeReport, bucket_hit, grade_days
from edgecast.model_store import ModelStore
from edgecast.types import MarketQuote


def q_between(lo, hi, city="NYC"):
    return MarketQuote(
        market_id="M", question="q", location=city, variable="high_temp_f",
        comparator="between", event_date="2026-07-01", yes_price=0.99,
        threshold_low=lo, threshold_high=hi,
    )


def test_bucket_hit_rounds_half_up_to_integer_bins():
    assert bucket_hit(95.5, q_between(95.0, 96.0)) == 1   # floor(96.0) = 96 in [95,96]
    assert bucket_hit(96.6, q_between(95.0, 96.0)) == 0   # floor(97.1) = 97 outside
    assert bucket_hit(94.4, q_between(95.0, 96.0)) == 0   # floor(94.9) = 94 outside
    assert bucket_hit(95.5, None) is None


@pytest.fixture
def store(tmp_path):
    return ModelStore(tmp_path / "g.db")


def _patch_sources(monkeypatch, observed, preds, yes_markets=None):
    """observed: {sid: {date: high}}; preds: {model: {date: high}} (same for all cities)."""
    monkeypatch.setattr(
        grade_mod, "fetch_observed_highs",
        lambda sid, start, end, client: observed.get(sid, {}),
    )
    monkeypatch.setattr(
        grade_mod, "fetch_previous_day1_highs",
        lambda lat, lon, start, end, tz, client: preds,
    )
    monkeypatch.setattr(
        grade_mod, "fetch_event_markets",
        lambda ticker, client: (_ for _ in ()).throw(RuntimeError("kalshi down"))
        if yes_markets is None else yes_markets.get(ticker, []),
    )


def test_grade_days_stores_sources_and_consensus_rows(monkeypatch, store):
    observed = {sid: {"2026-07-01": 94.0} for sid in
                ("KNYC", "KMDW", "KMIA", "KAUS", "KDEN", "KPHL", "KLAX")}
    preds = {"ncep_nbm_conus": {"2026-07-01": 95.0},
             "gfs_hrrr": {"2026-07-01": 93.0},
             "gfs_global": {"2026-07-01": 97.0}}
    _patch_sources(monkeypatch, observed, preds)   # kalshi unreachable -> bucket_hit NULL
    report = grade_days(["2026-07-01"], store, None, None)
    assert isinstance(report, GradeReport)
    assert report.n_rows == 7 * 4                  # 7 cities x (3 sources + consensus)
    grades = store.overall_grades("day_ahead", "2026-07-01")
    assert grades["consensus"].bias == pytest.approx(1.0)   # mean(95,93,97)=95 vs 94
    assert grades["consensus"].bucket_hit_rate is None
    assert "gbm" not in grades


def test_consensus_subtracts_trailing_bias(monkeypatch, store):
    from tests.test_model_store import row   # reuse the row factory
    # NYC: NBM has 5 graded days all +2 warm; HRRR has no history
    store.upsert([row(model="ncep_nbm_conus", d=f"2026-06-{dd:02d}", pred=92.0, obs=90.0)
                  for dd in range(20, 25)])
    observed = {"KNYC": {"2026-07-01": 90.0}}
    preds = {"ncep_nbm_conus": {"2026-07-01": 90.0},
             "gfs_hrrr": {"2026-07-01": 89.0},
             "gfs_global": {}}                      # GFS missing this date
    _patch_sources(monkeypatch, observed, preds)
    grade_days(["2026-07-01"], store, None, None)
    errs = store.trailing_errors("consensus", "day_ahead", "NYC", "2026-07-02")
    # consensus = mean(90 - 2, 89 - 0) = 88.5 -> error -1.5
    assert errs[0] == pytest.approx(-1.5)


def test_grade_days_isolates_acis_failure(monkeypatch, store):
    _patch_sources(monkeypatch, {}, {"ncep_nbm_conus": {}, "gfs_hrrr": {}, "gfs_global": {}})
    report = grade_days(["2026-07-01"], store, None, None)
    assert report.n_rows == 0
    assert all(f["stage"] in ("acis", "open-meteo") for f in report.failures)


def test_kalshi_fetch_retries_on_429_then_succeeds(monkeypatch):
    import httpx

    calls = {"n": 0}
    req = httpx.Request("GET", "https://x")

    def flaky(ticker, client):
        calls["n"] += 1
        if calls["n"] < 3:
            raise httpx.HTTPStatusError(
                "429", request=req, response=httpx.Response(429, request=req)
            )
        return [{"ticker": ticker}]

    monkeypatch.setattr(grade_mod, "fetch_event_markets", flaky)
    monkeypatch.setattr(grade_mod.time, "sleep", lambda s: None)
    assert grade_mod._fetch_markets_retrying("T", None) == [{"ticker": "T"}]
    assert calls["n"] == 3


def test_kalshi_fetch_does_not_retry_other_errors(monkeypatch):
    import httpx

    req = httpx.Request("GET", "https://x")

    def broken(ticker, client):
        raise httpx.HTTPStatusError(
            "503", request=req, response=httpx.Response(503, request=req)
        )

    monkeypatch.setattr(grade_mod, "fetch_event_markets", broken)
    with pytest.raises(httpx.HTTPStatusError):
        grade_mod._fetch_markets_retrying("T", None)


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


def _artifact(train_end_date):
    return Artifact(
        kind=GBM_KIND, lead="day_ahead", created_at="2026-07-04T00:00:00Z",
        train_end_date=train_end_date, n_rows=10,
        feature_names=FEATURE_NAMES, city_order=("NYC",), params={},
        model_json=_handwritten_dump(), metrics={}, promoted=1,
    )


def _single_day_sources(monkeypatch):
    observed = {"KNYC": {"2026-07-01": 94.0}}
    preds = {
        "ncep_nbm_conus": {"2026-07-01": 95.0},
        "gfs_hrrr": {"2026-07-01": 93.0},
        "gfs_global": {"2026-07-01": 97.0},
    }
    _patch_sources(monkeypatch, observed, preds)


def test_grade_days_adds_point_in_time_gbm_row(monkeypatch, store, tmp_path):
    _single_day_sources(monkeypatch)
    artifact_store = ArtifactStore(tmp_path / "artifacts.db")
    artifact_store.insert(_artifact("2026-06-30"))

    report = grade_days(
        ["2026-07-01"], store, None, None, artifact_store=artifact_store
    )

    gbm_rows = store._select("model = ?", ("gbm",))
    assert report.n_rows == 5
    assert len(gbm_rows) == 1
    # Consensus is 95.0; the two trees contribute 2.0 + 0.5.
    assert gbm_rows[0].predicted_high == pytest.approx(97.5)
    assert gbm_rows[0].model_source.startswith("gbm-v")


@pytest.mark.parametrize("train_end_date", ["2026-07-01", "2026-07-02"])
def test_grade_days_skips_gbm_row_at_or_before_train_end(
    monkeypatch, store, tmp_path, train_end_date
):
    _single_day_sources(monkeypatch)
    artifact_store = ArtifactStore(tmp_path / "artifacts.db")
    artifact_store.insert(_artifact(train_end_date))

    report = grade_days(
        ["2026-07-01"], store, None, None, artifact_store=artifact_store
    )

    assert report.n_rows == 4
    assert "gbm" not in store.overall_grades("day_ahead", "2026-07-01")
