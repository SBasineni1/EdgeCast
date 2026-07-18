from dataclasses import dataclass

import pytest

from edgecast.blend.dataset import TrainingRow
from edgecast.blend.validate import evaluate_model, should_promote, walk_forward


def training_row(day, city="NYC", baseline=10.0, observed=11.0, feature=0.0):
    return TrainingRow(
        city=city,
        event_date=f"2026-01-{day:02d}",
        features=(feature,),
        baseline_mu=baseline,
        observed_high=observed,
        label=observed - baseline,
    )


def test_fold_dates_and_training_rows_are_strictly_earlier():
    dataset = [training_row(day) for day in range(1, 21)]
    training_dates = []

    def train_fn(rows):
        training_dates.append(tuple(row.event_date for row in rows))
        return lambda features: 0.0

    result = walk_forward(dataset, train_fn, min_train_dates=15)

    expected_folds = tuple(f"2026-01-{day:02d}" for day in range(16, 21))
    assert result.fold_dates == expected_folds
    assert len(training_dates) == 5
    for seen, fold_date in zip(training_dates, expected_folds):
        assert seen
        assert all(date < fold_date for date in seen)
        assert seen[-1] < fold_date


def test_paired_errors_align_and_zero_residual_matches_baseline():
    dataset = [training_row(1), training_row(2)]
    dataset.extend(
        [
            training_row(3, city="CHI", baseline=20.0, observed=18.0),
            training_row(3, city="NYC", baseline=30.0, observed=33.0),
        ]
    )

    result = walk_forward(
        dataset, lambda rows: lambda features: 0.0, min_train_dates=2
    )

    assert result.candidate_abs_errors == (2.0, 3.0)
    assert result.baseline_abs_errors == (2.0, 3.0)
    assert result.candidate_mae == result.baseline_mae == pytest.approx(2.5)


def test_not_enough_dates_raises():
    with pytest.raises(ValueError):
        walk_forward(
            [training_row(day) for day in range(1, 16)],
            lambda rows: lambda features: 0.0,
            min_train_dates=15,
        )


@pytest.mark.parametrize(
    ("candidate", "baseline", "previous", "expected"),
    [
        (0.98, 1.0, None, True),
        (0.98, 1.0, 0.97, False),
        (0.99, 1.0, None, False),
        (0.90, 1.0, 0.95, True),
    ],
)
def test_should_promote_truth_table(candidate, baseline, previous, expected):
    assert should_promote(candidate, baseline, previous) is expected


def test_should_promote_head_to_head_uses_out_of_sample_mae():
    # Overall candidate MAE loses to previous, but on the shared
    # out-of-sample dates the candidate wins - promote.
    assert should_promote(0.98, 1.2, 0.97, candidate_vs_prev_mae=0.96) is True
    # And the reverse: overall wins, head-to-head loses - do not promote.
    assert should_promote(0.90, 1.2, 0.95, candidate_vs_prev_mae=0.99) is False


def test_candidate_mae_on_restricts_to_dates():
    dataset = [
        training_row(1),
        training_row(2, baseline=10.0, observed=14.0),
        training_row(3, baseline=10.0, observed=12.0),
    ]
    result = walk_forward(
        dataset, lambda rows: lambda features: 0.0, min_train_dates=1
    )

    assert result.row_dates == ("2026-01-02", "2026-01-03")
    assert result.candidate_mae_on(["2026-01-03"]) == pytest.approx(2.0)
    with pytest.raises(ValueError):
        result.candidate_mae_on(["2026-01-04"])


@dataclass
class StubModel:
    residual: float

    def predict(self, features):
        return self.residual + features[0]


def test_evaluate_model_scores_only_requested_dates():
    dataset = [
        training_row(1, baseline=10.0, observed=50.0, feature=0.0),
        training_row(2, baseline=10.0, observed=12.0, feature=1.0),
        training_row(3, baseline=20.0, observed=21.0, feature=-1.0),
    ]

    mae = evaluate_model(
        dataset, ("2026-01-02", "2026-01-03"), StubModel(residual=1.0)
    )

    assert mae == pytest.approx(0.5)
