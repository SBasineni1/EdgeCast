import importlib.util
from pathlib import Path
from types import SimpleNamespace

from edgecast.blend.dataset import TrainingRow
from edgecast.blend.features import CITY_ORDER, FEATURE_NAMES
from edgecast.blend.validate import FoldResult


SCRIPT = Path(__file__).parents[1] / "scripts" / "train_blend.py"
SPEC = importlib.util.spec_from_file_location("train_blend", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
train_blend = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(train_blend)


def row(event_date: str) -> TrainingRow:
    return TrainingRow(
        city="NYC",
        event_date=event_date,
        features=(0.0,) * len(FEATURE_NAMES),
        baseline_mu=70.0,
        observed_high=71.0,
        label=1.0,
    )


def test_metrics_and_artifact_assembly_records_training_contract():
    fold = FoldResult(
        fold_dates=("2026-07-16", "2026-07-17"),
        row_dates=("2026-07-16", "2026-07-17"),
        candidate_abs_errors=(0.5, 0.7),
        baseline_abs_errors=(1.0, 1.2),
    )
    metrics = train_blend.build_metrics(
        fold, prev_mae=0.8, margin=0.02, candidate_vs_prev_mae=0.7
    )
    artifact = train_blend.make_artifact(
        [row("2026-07-15"), row("2026-07-18")],
        "day_ahead",
        {"tree_info": []},
        metrics,
        promote=True,
        created_at="2026-07-18T12:00:00+00:00",
    )

    assert artifact.promoted == 1
    assert artifact.train_end_date == "2026-07-18"
    assert artifact.feature_names == FEATURE_NAMES
    assert artifact.city_order == CITY_ORDER
    assert artifact.metrics == {
        "candidate_mae": 0.6,
        "baseline_mae": 1.1,
        "prev_mae": 0.8,
        "candidate_vs_prev_mae": 0.7,
        "margin": 0.02,
        "fold_dates": ["2026-07-16", "2026-07-17"],
        "n_fold_rows": 2,
    }


def test_make_artifact_records_rejected_gate():
    artifact = train_blend.make_artifact(
        [row("2026-07-18")],
        "day_ahead",
        {},
        {},
        promote=False,
        created_at="2026-07-18T12:00:00+00:00",
    )

    assert artifact.promoted == 0


def test_corrupt_previous_artifact_is_ignored():
    corrupt = SimpleNamespace(
        model_json={"tree_info": [{}]}, train_end_date="2026-07-17"
    )

    assert (
        train_blend.rescore_previous(
            corrupt, [row("2026-07-18")], ("2026-07-18",)
        )
        is None
    )


def test_previous_artifact_with_no_out_of_sample_dates_abstains():
    """A previous model trained through the last fold date has seen every fold
    row; scoring it there would be in-sample and unbeatable, so it abstains."""
    previous = SimpleNamespace(
        model_json={"tree_info": []}, train_end_date="2026-07-18"
    )

    assert train_blend.prev_comparison_dates(previous, ("2026-07-17", "2026-07-18")) == []
    assert (
        train_blend.rescore_previous(
            previous, [row("2026-07-18")], ("2026-07-17", "2026-07-18")
        )
        is None
    )
    assert train_blend.prev_comparison_dates(
        previous, ("2026-07-18", "2026-07-19")
    ) == ["2026-07-19"]
