import json
import math
from pathlib import Path

import pytest

from edgecast.blend.gbm import parse_model


def handwritten_dump(decision_type="<="):
    return {
        "max_feature_idx": 1,
        "tree_info": [
            {
                "tree_structure": {
                    "split_feature": 0,
                    "threshold": 1.5,
                    "decision_type": decision_type,
                    "default_left": True,
                    "missing_type": "NaN",
                    "left_child": {"leaf_value": 2.0},
                    "right_child": {"leaf_value": -1.0},
                }
            },
            {
                "tree_structure": {
                    "split_feature": 1,
                    "threshold": 0.0,
                    "decision_type": "<=",
                    "default_left": False,
                    "missing_type": "None",
                    "left_child": {"leaf_value": 0.5},
                    "right_child": {"leaf_value": 3.0},
                }
            },
        ],
    }


def test_predict_normal_and_nan_paths():
    model = parse_model(handwritten_dump())
    assert model.num_features == 2
    assert model.predict([1.5, -2.0]) == pytest.approx(2.5)
    assert model.predict([2.0, 1.0]) == pytest.approx(2.0)
    assert model.predict([float("nan"), float("nan")]) == pytest.approx(5.0)


def test_rejects_unsupported_decision_type():
    with pytest.raises(ValueError):
        parse_model(handwritten_dump(decision_type="=="))


def test_lightgbm_parity_fixture():
    """Fixture encodes feature NaNs as ``"nan"`` for portable JSON."""
    fixture = Path(__file__).parent / "data" / "gbm_parity.json"
    if not fixture.exists():
        pytest.skip("LightGBM parity fixture has not been generated")
    payload = json.loads(fixture.read_text())
    model = parse_model(payload["dump"])
    for case in payload["cases"]:
        features = [
            float("nan") if value == "nan" else value
            for value in case["features"]
        ]
        assert math.fabs(model.predict(features) - case["expected"]) < 1e-9
