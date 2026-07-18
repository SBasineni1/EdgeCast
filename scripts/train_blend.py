"""Train and optionally promote the day-ahead residual blend model."""

import argparse
import sys
from collections.abc import Sequence
from datetime import datetime, timezone
from pathlib import Path

from edgecast.blend.artifact import Artifact, ArtifactStore
from edgecast.blend.dataset import TrainingRow, build_dataset
from edgecast.blend.features import CITY_ORDER, FEATURE_NAMES
from edgecast.blend.gbm import parse_model
from edgecast.blend.validate import FoldResult, evaluate_model, should_promote, walk_forward
from edgecast.model_store import ModelStore


KIND = "gbm_high_temp"
PARAMS = {
    "objective": "regression",
    "num_leaves": 7,
    "max_depth": 3,
    "learning_rate": 0.03,
    "min_data_in_leaf": 25,
    "lambda_l2": 5.0,
    "feature_fraction": 0.9,
    "use_missing": True,
    "seed": 20260718,
    "verbosity": -1,
}
NUM_BOOST_ROUND = 200


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=Path("data/edgecast.db"))
    parser.add_argument("--lead", default="day_ahead")
    parser.add_argument("--min-train-dates", type=int, default=15)
    parser.add_argument("--max-folds", type=int, default=20)
    parser.add_argument("--margin", type=float, default=0.02)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="validate and report without writing an artifact",
    )
    return parser.parse_args(argv)


def _fit_booster(rows: Sequence[TrainingRow]):
    """Fit LightGBM, importing the training-only dependency on demand."""
    import lightgbm as lgb
    import numpy as np

    features = np.asarray([row.features for row in rows], dtype=float)
    labels = np.asarray([row.label for row in rows], dtype=float)
    training_data = lgb.Dataset(
        features, labels, feature_name=list(FEATURE_NAMES)
    )
    return lgb.train(
        PARAMS, training_data, num_boost_round=NUM_BOOST_ROUND
    )


def prev_comparison_dates(
    previous: Artifact | None, fold_dates: Sequence[str]
) -> list[str]:
    """Fold dates strictly after the previous artifact's training window.

    The previous model trained through its train_end_date, so scoring it on
    earlier fold dates would be in-sample and unbeatable; the head-to-head
    only counts dates neither model has seen."""
    if previous is None:
        return []
    return [d for d in fold_dates if d > previous.train_end_date]


def rescore_previous(
    previous: Artifact | None,
    dataset: list[TrainingRow],
    fold_dates: Sequence[str],
) -> float | None:
    """Score the prior model on out-of-sample folds, ignoring corrupt artifacts."""
    dates = prev_comparison_dates(previous, fold_dates)
    if previous is None or not dates:
        return None
    try:
        return evaluate_model(dataset, dates, parse_model(previous.model_json))
    except Exception:
        return None


def build_metrics(
    fold: FoldResult,
    prev_mae: float | None,
    margin: float,
    candidate_vs_prev_mae: float | None = None,
) -> dict:
    return {
        "candidate_mae": fold.candidate_mae,
        "baseline_mae": fold.baseline_mae,
        "prev_mae": prev_mae,
        "candidate_vs_prev_mae": candidate_vs_prev_mae,
        "margin": margin,
        "fold_dates": list(fold.fold_dates),
        "n_fold_rows": len(fold.candidate_abs_errors),
    }


def make_artifact(
    dataset: list[TrainingRow],
    lead: str,
    model_json: dict,
    metrics: dict,
    promote: bool,
    created_at: str | None = None,
) -> Artifact:
    return Artifact(
        kind=KIND,
        lead=lead,
        created_at=created_at or datetime.now(timezone.utc).isoformat(),
        train_end_date=max(row.event_date for row in dataset),
        n_rows=len(dataset),
        feature_names=FEATURE_NAMES,
        city_order=CITY_ORDER,
        params={**PARAMS, "num_boost_round": NUM_BOOST_ROUND},
        model_json=model_json,
        metrics=metrics,
        promoted=1 if promote else 0,
    )


def gate_reason(
    candidate_mae: float,
    baseline_mae: float,
    prev_mae: float | None,
    margin: float,
    candidate_vs_prev_mae: float | None = None,
) -> str:
    if candidate_mae > baseline_mae - margin:
        return (
            f"candidate did not beat baseline by the required {margin:.4f} MAE"
        )
    if prev_mae is None:
        return (
            "candidate cleared the baseline gate; no out-of-sample dates "
            "to compare against a previous model"
        )
    head_to_head = (
        candidate_vs_prev_mae if candidate_vs_prev_mae is not None else candidate_mae
    )
    if head_to_head > prev_mae:
        return "candidate did not match or beat the previous promoted model"
    return "candidate cleared both baseline and previous-model gates"


def _print_summary(
    dataset: list[TrainingRow],
    fold: FoldResult,
    prev_mae: float | None,
    margin: float,
    promote: bool,
    candidate_vs_prev_mae: float | None = None,
) -> None:
    dates = [row.event_date for row in dataset]
    print(f"Dataset: {len(dataset)} rows, {min(dates)} through {max(dates)}")
    print(
        f"Validation: {len(fold.fold_dates)} folds / "
        f"{len(fold.candidate_abs_errors)} rows"
    )
    print(f"Fold dates: {', '.join(fold.fold_dates)}")
    print(f"Candidate MAE: {fold.candidate_mae:.6f}")
    print(f"Baseline MAE:  {fold.baseline_mae:.6f}")
    if prev_mae is not None:
        print(
            "Head-to-head on dates after the previous model's training: "
            f"candidate {candidate_vs_prev_mae:.6f} vs previous {prev_mae:.6f}"
        )
    else:
        print("Previous MAE:  unavailable (no out-of-sample dates for it)")
    decision = "PROMOTE" if promote else "DO NOT PROMOTE"
    print(
        f"Decision: {decision} — "
        f"{gate_reason(fold.candidate_mae, fold.baseline_mae, prev_mae, margin, candidate_vs_prev_mae)}"
    )


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    dataset = build_dataset(ModelStore(args.db), args.lead)
    if not dataset:
        print("Training aborted: the dataset is empty.", file=sys.stderr)
        return 1

    import numpy as np

    def train_fn(rows: list[TrainingRow]):
        booster = _fit_booster(rows)
        return lambda features: float(
            booster.predict(np.asarray([features], dtype=float))[0]
        )

    fold = walk_forward(
        dataset, train_fn, args.min_train_dates, args.max_folds
    )
    store = ArtifactStore(args.db)
    previous = store.latest_promoted(KIND, args.lead)
    prev_mae = rescore_previous(previous, dataset, fold.fold_dates)
    candidate_vs_prev_mae = None
    if prev_mae is not None:
        candidate_vs_prev_mae = fold.candidate_mae_on(
            prev_comparison_dates(previous, fold.fold_dates)
        )
    promote = should_promote(
        fold.candidate_mae, fold.baseline_mae, prev_mae, args.margin,
        candidate_vs_prev_mae,
    )

    booster = _fit_booster(dataset)
    dump = booster.dump_model()
    try:
        pure = parse_model(dump)
        for row in dataset:
            pure_prediction = pure.predict(row.features)
            native_prediction = float(
                booster.predict(np.asarray([row.features], dtype=float))[0]
            )
            difference = abs(pure_prediction - native_prediction)
            if difference > 1e-6:
                print(
                    "Parity check failed for "
                    f"{row.city} on {row.event_date}: pure={pure_prediction!r}, "
                    f"lightgbm={native_prediction!r}, difference={difference!r}",
                    file=sys.stderr,
                )
                return 2
    except Exception as exc:
        print(f"Parity check failed: {exc}", file=sys.stderr)
        return 2

    metrics = build_metrics(fold, prev_mae, args.margin, candidate_vs_prev_mae)
    artifact = make_artifact(dataset, args.lead, dump, metrics, promote)
    _print_summary(dataset, fold, prev_mae, args.margin, promote, candidate_vs_prev_mae)
    if args.dry_run:
        print("Dry run: artifact was not written.")
    else:
        artifact_id = store.insert(artifact)
        print(f"Artifact ID: {artifact_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
