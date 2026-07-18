"""Generate the offline LightGBM/runtime parity fixture.

Feature NaNs are written as the string ``"nan"`` because JSON has no portable
NaN value.  The parity test converts those strings back to ``float("nan")``.
"""

import json
import math
import random
from pathlib import Path

import lightgbm as lgb
import numpy as np

from edgecast.blend.features import FEATURE_NAMES


def main() -> None:
    rng = random.Random(20260718)
    features: list[list[float]] = []
    targets: list[float] = []
    for _ in range(300):
        row = [rng.uniform(-3.0, 3.0) for _ in FEATURE_NAMES]
        if rng.random() < 0.25:
            row[rng.randrange(3)] = float("nan")
        if rng.random() < 0.15:
            row[rng.randrange(6, 9)] = float("nan")
        signal = sum(
            weight * (0.0 if math.isnan(value) else value)
            for weight, value in zip((1.7, -0.8, 0.4, 1.2), row[:4])
        )
        targets.append(signal + rng.gauss(0.0, 0.2))
        features.append(row)

    feature_array = np.asarray(features, dtype=float)
    dataset = lgb.Dataset(
        feature_array, label=np.asarray(targets), feature_name=list(FEATURE_NAMES)
    )
    booster = lgb.train(
        {
            "objective": "regression",
            "num_leaves": 7,
            "min_data_in_leaf": 10,
            "learning_rate": 0.1,
            "use_missing": True,
            "seed": 20260718,
            "verbosity": -1,
        },
        dataset,
        num_boost_round=25,
    )

    case_features = feature_array[:50]
    expected = booster.predict(case_features)
    cases = [
        {
            "features": [
                "nan" if math.isnan(value) else float(value) for value in row
            ],
            "expected": float(prediction),
        }
        for row, prediction in zip(case_features, expected)
    ]
    output = Path(__file__).parents[1] / "tests" / "data" / "gbm_parity.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps({"dump": booster.dump_model(), "cases": cases}, indent=2) + "\n"
    )


if __name__ == "__main__":
    main()
