"""Point-in-time training dataset construction for the residual blend model."""

from dataclasses import dataclass

from edgecast.blend.features import CITY_ORDER, feature_vector
from edgecast.consensus import consensus_point, trailing_bias
from edgecast.live.previous_runs import SOURCE_MODELS
from edgecast.model_store import ModelStore


@dataclass(frozen=True)
class TrainingRow:
    city: str
    event_date: str
    features: tuple[float, ...]
    baseline_mu: float
    observed_high: float
    label: float


def build_dataset(
    model_store: ModelStore, lead: str = "day_ahead"
) -> list[TrainingRow]:
    """Build residual-training rows using only information available before each date."""
    stored_rows = model_store._select("lead = ?", (lead,))
    by_city_date = {}
    for row in stored_rows:
        by_city_date.setdefault((row.city, row.event_date), {})[row.model] = row

    result = []
    for (city, event_date), model_rows in by_city_date.items():
        consensus_row = model_rows.get("consensus")
        if consensus_row is None:
            continue

        preds = {
            model: model_rows[model].predicted_high
            for model in SOURCE_MODELS
            if model in model_rows
        }
        if not preds or city not in CITY_ORDER:
            continue

        biases = {
            model: trailing_bias(
                model_store.trailing_errors(model, lead, city, event_date)
            )
            for model in preds
        }
        baseline_mu = consensus_point(preds, biases)
        if abs(baseline_mu - consensus_row.predicted_high) >= 0.25:
            raise ValueError(
                f"consensus mismatch for {city} on {event_date}: "
                f"recomputed {baseline_mu}, stored {consensus_row.predicted_high}"
            )

        observed_high = consensus_row.observed_high
        result.append(
            TrainingRow(
                city=city,
                event_date=event_date,
                features=tuple(feature_vector(preds, biases, city, event_date)),
                baseline_mu=baseline_mu,
                observed_high=observed_high,
                label=observed_high - baseline_mu,
            )
        )

    return sorted(result, key=lambda row: (row.event_date, row.city))
