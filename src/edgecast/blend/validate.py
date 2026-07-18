"""Walk-forward validation helpers for residual blend models."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

from edgecast.blend.dataset import TrainingRow


class PredictingModel(Protocol):
    def predict(self, features: Sequence[float]) -> float: ...


@dataclass(frozen=True)
class FoldResult:
    fold_dates: tuple[str, ...]
    row_dates: tuple[str, ...]
    candidate_abs_errors: tuple[float, ...]
    baseline_abs_errors: tuple[float, ...]

    @property
    def candidate_mae(self) -> float:
        if not self.candidate_abs_errors:
            raise ValueError("cannot compute candidate MAE for an empty fold")
        return sum(self.candidate_abs_errors) / len(self.candidate_abs_errors)

    @property
    def baseline_mae(self) -> float:
        if not self.baseline_abs_errors:
            raise ValueError("cannot compute baseline MAE for an empty fold")
        return sum(self.baseline_abs_errors) / len(self.baseline_abs_errors)

    def candidate_mae_on(self, dates: Sequence[str]) -> float:
        selected = set(dates)
        errors = [
            e for d, e in zip(self.row_dates, self.candidate_abs_errors) if d in selected
        ]
        if not errors:
            raise ValueError("no fold rows on the requested dates")
        return sum(errors) / len(errors)


def walk_forward(
    dataset: list[TrainingRow],
    train_fn: Callable[[list[TrainingRow]], Callable[[Sequence[float]], float]],
    min_train_dates: int = 15,
    max_folds: int = 20,
) -> FoldResult:
    dates = sorted({row.event_date for row in dataset})
    if len(dates) <= min_train_dates:
        raise ValueError("dataset does not contain enough dates for validation")

    n_folds = min(max_folds, len(dates) - min_train_dates)
    fold_dates = tuple(dates[-n_folds:])
    row_dates = []
    candidate_errors = []
    baseline_errors = []

    for fold_date in fold_dates:
        predict = train_fn([row for row in dataset if row.event_date < fold_date])
        for row in dataset:
            if row.event_date != fold_date:
                continue
            row_dates.append(row.event_date)
            candidate_errors.append(
                abs(row.baseline_mu + predict(row.features) - row.observed_high)
            )
            baseline_errors.append(abs(row.baseline_mu - row.observed_high))

    return FoldResult(
        fold_dates=fold_dates,
        row_dates=tuple(row_dates),
        candidate_abs_errors=tuple(candidate_errors),
        baseline_abs_errors=tuple(baseline_errors),
    )


def evaluate_model(
    dataset: list[TrainingRow], fold_dates: Sequence[str], model: PredictingModel
) -> float:
    selected_dates = set(fold_dates)
    errors = [
        abs(row.baseline_mu + model.predict(row.features) - row.observed_high)
        for row in dataset
        if row.event_date in selected_dates
    ]
    if not errors:
        raise ValueError("cannot evaluate a model without matching rows")
    return sum(errors) / len(errors)


def should_promote(
    candidate_mae: float,
    baseline_mae: float,
    prev_mae: float | None,
    margin: float = 0.02,
    candidate_vs_prev_mae: float | None = None,
) -> bool:
    """prev_mae and candidate_vs_prev_mae must be scored on the same dates,
    all strictly after the previous artifact's train_end_date — dates the
    previous model trained on would score it in-sample and block promotion."""
    if candidate_mae > baseline_mae - margin:
        return False
    if prev_mae is None:
        return True
    head_to_head = (
        candidate_vs_prev_mae if candidate_vs_prev_mae is not None else candidate_mae
    )
    return head_to_head <= prev_mae
