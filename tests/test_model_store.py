import pytest

from edgecast.model_store import GradeStats, ModelDayRow, ModelStore


def row(model="gfs_hrrr", city="NYC", d="2026-07-01", pred=95.0, obs=94.0, hit=1):
    err = pred - obs
    return ModelDayRow(
        model=model, lead="day_ahead", city=city, series="KXHIGHNY",
        event_date=d, predicted_high=pred, observed_high=obs,
        error=err, abs_error=abs(err), bucket_hit=hit,
        observed_source="ACIS KNYC", model_source=f"open-meteo {model} previous_day1",
        verified_at="2026-07-04T00:00:00Z",
    )


@pytest.fixture
def store(tmp_path):
    return ModelStore(tmp_path / "t.db")


def test_upsert_idempotent_and_covered(store):
    store.upsert([row(d="2026-07-01"), row(d="2026-07-02")])
    store.upsert([row(d="2026-07-01", pred=96.0)])  # replace, not duplicate
    assert store.covered("gfs_hrrr", "day_ahead", ["2026-07-01", "2026-07-02", "2026-07-03"]) == {
        ("NYC", "2026-07-01"), ("NYC", "2026-07-02"),
    }


def test_dates_missing_keyed_on_consensus(store):
    store.upsert([row(model="gfs_hrrr", d="2026-07-01")])           # sources alone don't count
    store.upsert([row(model="consensus", d="2026-07-02")])
    missing = store.dates_missing("day_ahead", ["2026-07-01", "2026-07-02", "2026-07-03"])
    assert missing == ["2026-07-03", "2026-07-01"]                   # newest first


def test_trailing_errors_ordering_exclusivity_limit(store):
    store.upsert([row(d=f"2026-06-{dd:02d}", pred=90.0 + dd, obs=90.0) for dd in range(1, 21)])
    errs = store.trailing_errors("gfs_hrrr", "day_ahead", "NYC", "2026-06-15", limit=3)
    assert errs == [14.0, 13.0, 12.0]      # newest first, strictly before the 15th
    assert store.trailing_errors("gfs_hrrr", "day_ahead", "OTHER", "2026-06-15") == []


def test_grades_aggregate_and_null_bucket_hits(store):
    store.upsert([
        row(d="2026-07-01", pred=96.0, obs=94.0, hit=0),   # error +2
        row(d="2026-07-02", pred=93.0, obs=94.0, hit=1),   # error -1
        row(d="2026-07-03", pred=94.0, obs=94.0, hit=None), # ungraded bucket
        row(model="ncep_nbm_conus", d="2026-07-01", pred=95.0, obs=94.0, hit=None),
    ])
    overall = store.overall_grades("day_ahead", "2026-07-01")
    hrrr = overall["gfs_hrrr"]
    assert hrrr == GradeStats(n_days=3, mae=pytest.approx(1.0), bias=pytest.approx(1 / 3),
                              bucket_hit_rate=pytest.approx(0.5))   # mean of non-NULL hits
    assert overall["ncep_nbm_conus"].bucket_hit_rate is None        # all NULL -> None
    by_city = store.city_grades("day_ahead", "2026-07-01")
    assert by_city["NYC"]["gfs_hrrr"].n_days == 3
    assert store.overall_grades("day_ahead", "2027-01-01") == {}
