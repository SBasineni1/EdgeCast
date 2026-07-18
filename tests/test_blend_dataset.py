import math

import pytest

from edgecast.blend.dataset import build_dataset
from edgecast.blend.features import CITY_ORDER
from edgecast.model_store import ModelDayRow, ModelStore


def row(model, d, pred, obs, city="NYC"):
    error = pred - obs
    return ModelDayRow(
        model=model,
        lead="day_ahead",
        city=city,
        series="KXHIGHNY",
        event_date=d,
        predicted_high=pred,
        observed_high=obs,
        error=error,
        abs_error=abs(error),
        bucket_hit=None,
        observed_source="test observation",
        model_source="test model",
        verified_at="2026-07-01T00:00:00Z",
    )


@pytest.fixture
def store(tmp_path):
    return ModelStore(tmp_path / "blend.db")


def test_builds_features_baseline_and_label(store):
    d = "2026-07-10"
    store.upsert(
        [
            row("ncep_nbm_conus", d, 80.0, 83.0),
            row("gfs_hrrr", d, 84.0, 83.0),
            row("consensus", d, 82.0, 83.0),
        ]
    )

    result = build_dataset(store)

    assert len(result) == 1
    training_row = result[0]
    assert training_row.city == "NYC"
    assert training_row.event_date == d
    assert training_row.baseline_mu == pytest.approx(82.0)
    assert training_row.observed_high == 83.0
    assert training_row.label == pytest.approx(1.0)
    assert training_row.features[:9] == pytest.approx(
        [80.0, 84.0, math.nan, 82.0, 4.0, 2.0, 0.0, 0.0, 0.0],
        nan_ok=True,
    )
    assert training_row.features[-1] == float(CITY_ORDER.index("NYC"))


def test_bias_features_are_strictly_point_in_time(store):
    history = [
        row("gfs_hrrr", f"2026-07-{day:02d}", 90.0, 90.0)
        for day in range(1, 6)
    ]
    on_date = "2026-07-06"
    later_date = "2026-07-07"
    store.upsert(
        history
        + [
            row("gfs_hrrr", on_date, 140.0, 90.0),
            row("consensus", on_date, 140.0, 90.0),
            row("gfs_hrrr", later_date, 90.0, 90.0),
            row("consensus", later_date, 90.0 - 50.0 / 6.0, 90.0),
        ]
    )

    by_date = {r.event_date: r for r in build_dataset(store)}

    assert by_date[on_date].features[7] == pytest.approx(0.0)
    assert by_date[on_date].baseline_mu == pytest.approx(140.0)
    assert by_date[later_date].features[7] == pytest.approx(50.0 / 6.0)
    assert by_date[later_date].baseline_mu == pytest.approx(90.0 - 50.0 / 6.0)


def test_consensus_mismatch_raises_with_city_and_date(store):
    d = "2026-07-10"
    store.upsert(
        [
            row("gfs_hrrr", d, 80.0, 80.0),
            row("consensus", d, 81.0, 80.0),
        ]
    )

    with pytest.raises(ValueError, match=f"NYC.*{d}"):
        build_dataset(store)


def test_missing_model_produces_nan_and_uses_available_prediction(store):
    d = "2026-07-10"
    store.upsert(
        [
            row("gfs_global", d, 77.0, 78.0),
            row("consensus", d, 77.0, 78.0),
        ]
    )

    training_row = build_dataset(store)[0]

    assert math.isnan(training_row.features[0])
    assert math.isnan(training_row.features[1])
    assert training_row.features[2] == 77.0
    assert training_row.baseline_mu == 77.0

