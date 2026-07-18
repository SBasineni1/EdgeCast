"""Feature construction for the residual blend model."""

import math
from datetime import date

from edgecast.consensus import consensus_point
from edgecast.live.previous_runs import SOURCE_MODELS
from edgecast.live.stations import STATIONS

CITY_ORDER: tuple[str, ...] = tuple(sorted(st.city for st in STATIONS.values()))

FEATURE_NAMES: tuple[str, ...] = (
    "pred_ncep_nbm_conus",
    "pred_gfs_hrrr",
    "pred_gfs_global",
    "debiased_mean",
    "spread",
    "n_models",
    "bias_ncep_nbm_conus",
    "bias_gfs_hrrr",
    "bias_gfs_global",
    "doy_sin",
    "doy_cos",
    "city_idx",
)


def feature_vector(
    preds: dict[str, float], biases: dict[str, float], city: str, event_date: str
) -> list[float]:
    """Build the ordered runtime feature vector for one forecast."""
    city_idx = float(CITY_ORDER.index(city))
    values = list(preds.values())
    day_of_year = date.fromisoformat(event_date).timetuple().tm_yday
    angle = 2.0 * math.pi * day_of_year / 365.25

    return [
        *(preds.get(model, float("nan")) for model in SOURCE_MODELS),
        consensus_point(preds, biases),
        max(values) - min(values),
        float(len(preds)),
        *(biases.get(model, 0.0) for model in SOURCE_MODELS),
        math.sin(angle),
        math.cos(angle),
        city_idx,
    ]
