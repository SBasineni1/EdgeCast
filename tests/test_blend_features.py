import math
from datetime import date

import pytest

from edgecast.blend.features import CITY_ORDER, FEATURE_NAMES, feature_vector


def test_feature_names_exact_order():
    assert FEATURE_NAMES == (
        "pred_ncep_nbm_conus", "pred_gfs_hrrr", "pred_gfs_global",
        "debiased_mean", "spread", "n_models", "bias_ncep_nbm_conus",
        "bias_gfs_hrrr", "bias_gfs_global", "doy_sin", "doy_cos", "city_idx",
    )


def test_full_feature_vector():
    preds = {"ncep_nbm_conus": 90.0, "gfs_hrrr": 94.0, "gfs_global": 92.0}
    biases = {"ncep_nbm_conus": 1.0, "gfs_hrrr": -1.0, "gfs_global": 2.0}
    result = feature_vector(preds, biases, "NYC", "2026-01-01")
    angle = 2.0 * math.pi / 365.25
    assert result == pytest.approx([
        90.0, 94.0, 92.0, (89.0 + 95.0 + 90.0) / 3.0, 4.0, 3.0,
        1.0, -1.0, 2.0, math.sin(angle), math.cos(angle),
        float(CITY_ORDER.index("NYC")),
    ])


def test_missing_model_and_default_bias():
    result = feature_vector(
        {"ncep_nbm_conus": 80.0, "gfs_global": 84.0},
        {"ncep_nbm_conus": 2.0},
        "AUS",
        "2026-07-01",
    )
    assert math.isnan(result[1])
    assert result[3] == pytest.approx((78.0 + 84.0) / 2.0)
    assert result[4:9] == pytest.approx([4.0, 2.0, 2.0, 0.0, 0.0])


def test_day_of_year_features_for_known_date():
    result = feature_vector({"gfs_hrrr": 70.0}, {}, "CHI", "2024-12-31")
    day_of_year = date(2024, 12, 31).timetuple().tm_yday
    angle = 2.0 * math.pi * day_of_year / 365.25
    assert result[9:11] == pytest.approx([math.sin(angle), math.cos(angle)])


def test_city_index_and_unknown_city():
    city = CITY_ORDER[3]
    assert feature_vector({"gfs_hrrr": 70.0}, {}, city, "2026-01-01")[-1] == 3.0
    with pytest.raises(ValueError):
        feature_vector({"gfs_hrrr": 70.0}, {}, "UNKNOWN", "2026-01-01")
