"""Day-ahead snapshots: freeze the model's 11 AM ET view of tomorrow's ladder.

Kalshi's next-day high-temperature markets open at 10 AM ET; the snapshot waits
one more hour for quotes to settle, then records every bucket's market and model
probability. Once the day settles, the scorecard checks whether the bucket the
model gave the highest probability to — more than 24 hours ahead — was the one
that settled YES, with the market's 11 AM favorite as the baseline.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from edgecast.store import SnapshotRow, Store, bucket_label
from edgecast.types import ScenarioResult

ET = ZoneInfo("America/New_York")
SNAPSHOT_HOUR_ET = 11  # markets open 10 AM ET; give quotes an hour to settle


def due_event_date(now: datetime | None = None) -> str | None:
    """Tomorrow's event date once we're at/past the snapshot hour ET, else None."""
    now_et = (now or datetime.now(ET)).astimezone(ET)
    if now_et.hour < SNAPSHOT_HOUR_ET:
        return None
    return (now_et.date() + timedelta(days=1)).isoformat()


def capture_snapshot(
    store: Store,
    results: list[ScenarioResult],
    model_highs: dict[str, dict[str, float | None]],
    sigmas: dict[str, float],
    now: datetime | None = None,
    force_event_date: str | None = None,
) -> int:
    """Persist tomorrow's ladder once per event date; returns rows written.

    `results` is the live analyze output; only scenarios for the due event date
    are captured, so a same-day ladder is never recorded as a day-ahead view.
    """
    event_date = force_event_date or due_event_date(now)
    if event_date is None or store.snapshot_taken_at(event_date) is not None:
        return 0
    taken_at = (now or datetime.now(ET)).astimezone(ET).isoformat()
    rows = [
        SnapshotRow(
            market_id=r.scenario_id,
            city=r.market.location,
            event_date=r.market.event_date,
            comparator=r.market.comparator,
            threshold=r.market.threshold,
            threshold_low=r.market.threshold_low,
            threshold_high=r.market.threshold_high,
            question=r.market.question,
            market_prob=r.market_prob,
            model_prob=r.model_prob,
            consensus=model_highs.get(r.market.location, {}).get("consensus"),
            sigma=sigmas.get(r.market.location),
            taken_at=taken_at,
        )
        for r in results
        if r.market.event_date == event_date
    ]
    if not rows:
        return 0
    store.upsert_snapshots(rows)
    return len(rows)


@dataclass
class SnapshotScorecard:
    n_scored: int = 0  # (city, day) ladders with a settled outcome
    n_pending: int = 0  # snapshotted ladders not yet settled
    model_hits: int = 0
    market_hits: int = 0
    days: list[dict] = field(default_factory=list)  # newest first


def scorecard(store: Store, model: str, since_date: str) -> SnapshotScorecard:
    """Score settled snapshots: top model/market bucket vs the settled bucket."""
    snaps = store.snapshots_since(since_date)
    card = SnapshotScorecard()
    if not snaps:
        return card
    outcomes = store.outcomes_for_markets(model, [s.market_id for s in snaps])
    groups: dict[tuple[str, str], list[SnapshotRow]] = {}
    for s in snaps:
        groups.setdefault((s.event_date, s.city), []).append(s)
    by_day: dict[str, dict] = {}
    for (event_date, _city), group in sorted(groups.items()):
        settled = [s for s in group if outcomes.get(s.market_id) == 1]
        if not settled:
            card.n_pending += 1
            continue
        model_pick = max(group, key=lambda s: s.model_prob)
        market_pick = max(group, key=lambda s: s.market_prob)
        model_hit = outcomes.get(model_pick.market_id) == 1
        market_hit = outcomes.get(market_pick.market_id) == 1
        card.n_scored += 1
        card.model_hits += int(model_hit)
        card.market_hits += int(market_hit)
        day = by_day.setdefault(
            event_date,
            {"event_date": event_date, "n": 0, "model_hits": 0, "market_hits": 0},
        )
        day["n"] += 1
        day["model_hits"] += int(model_hit)
        day["market_hits"] += int(market_hit)
    card.days = sorted(by_day.values(), key=lambda d: d["event_date"], reverse=True)
    return card


def pick_label(group: list[SnapshotRow], key: str) -> str:
    """Human label for the bucket a side favored (used by the CLI report)."""
    best = max(group, key=lambda s: getattr(s, key))
    return bucket_label(best.comparator, best.threshold, best.threshold_low, best.threshold_high)
