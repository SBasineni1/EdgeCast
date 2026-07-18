"""Pure-stdlib inference for numerical LightGBM regression trees."""

import math
from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class Node:
    split_feature: int | None = None
    threshold: float | None = None
    default_left: bool = False
    left: "Node | None" = None
    right: "Node | None" = None
    leaf_value: float | None = None


@dataclass(frozen=True)
class GBMModel:
    trees: tuple[Node, ...]
    num_features: int

    def predict(self, features: Sequence[float]) -> float:
        total = 0.0
        for root in self.trees:
            node = root
            while node.leaf_value is None:
                assert node.split_feature is not None
                assert node.threshold is not None
                assert node.left is not None
                assert node.right is not None
                value = features[node.split_feature]
                if math.isnan(value):
                    node = node.left if node.default_left else node.right
                else:
                    node = node.left if value <= node.threshold else node.right
            total += node.leaf_value
        return total


def _parse_node(raw: dict) -> Node:
    if "leaf_value" in raw:
        return Node(leaf_value=float(raw["leaf_value"]))

    if raw["decision_type"] != "<=":
        decision_type = raw["decision_type"]
        raise ValueError(f"unsupported LightGBM decision type: {decision_type!r}")
    if raw["missing_type"] not in ("None", "NaN"):
        raise ValueError(f"unsupported LightGBM missing type: {raw['missing_type']!r}")

    return Node(
        split_feature=int(raw["split_feature"]),
        threshold=float(raw["threshold"]),
        default_left=bool(raw["default_left"]),
        left=_parse_node(raw["left_child"]),
        right=_parse_node(raw["right_child"]),
    )


def parse_model(dump: dict) -> GBMModel:
    """Parse the supported subset of ``Booster.dump_model()`` output."""
    feature_names = dump.get("feature_names")
    num_features = (
        len(feature_names)
        if feature_names is not None
        else int(dump["max_feature_idx"]) + 1
    )
    trees = tuple(_parse_node(info["tree_structure"]) for info in dump["tree_info"])
    return GBMModel(trees=trees, num_features=num_features)
