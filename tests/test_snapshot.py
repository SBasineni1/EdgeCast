from datetime import datetime
from zoneinfo import ZoneInfo

from edgecast.snapshot import ET, capture_snapshot, due_event_date, scorecard
from edgecast.store import SnapshotRow, Store
from edgecast.types import EdgeMetrics, MarketQuote, ScenarioResult

from tests.test_server import seed_row


def _result(market_id: str, lo: float, hi: float, market_prob: float, model_prob: float,
            event_date: str = "2026-07-13", city: str = "NYC") -> ScenarioResult:
    return ScenarioResult(
        scenario_id=market_id,
        market=MarketQuote(
            market_id=market_id, question=f"q {market_id}", location=city,
            variable="high_temp_f", comparator="between", event_date=event_date,
            yes_price=market_prob, threshold_low=lo, threshold_high=hi,
        ),
        market_prob=market_prob,
        model_prob=model_prob,
        model_prob_raw=model_prob,
        n_members=3,
        edge=EdgeMetrics(value=model_prob - market_prob, log_odds_diff=0.0, flag="agreement"),
        settlement=None,
    )


def test_due_event_date_respects_the_11am_et_gate():
    before = datetime(2026, 7, 12, 10, 59, tzinfo=ET)
    after = datetime(2026, 7, 12, 11, 0, tzinfo=ET)
    assert due_event_date(before) is None
    assert due_event_date(after) == "2026-07-13"
    # 3 PM UTC on Jul 12 is 11 AM ET — timezone conversion, not naive hours
    utc = datetime(2026, 7, 12, 15, 0, tzinfo=ZoneInfo("UTC"))
    assert due_event_date(utc) == "2026-07-13"


def test_capture_freezes_only_tomorrows_ladder_once(tmp_path):
    store = Store(tmp_path / "s.db")
    now = datetime(2026, 7, 12, 11, 5, tzinfo=ET)
    results = [
        _result("M-88", 88, 89, 0.4, 0.5),
        _result("M-90", 90, 91, 0.3, 0.3),
        _result("TODAY", 88, 89, 0.9, 0.9, event_date="2026-07-12"),
    ]
    highs = {"NYC": {"consensus": 89.1}}
    sigmas = {"NYC": 1.7}
    assert capture_snapshot(store, results, highs, sigmas, now=now) == 2
    snaps = store.snapshots_since("2026-07-13")
    assert {s.market_id for s in snaps} == {"M-88", "M-90"}
    assert all(s.consensus == 89.1 and s.sigma == 1.7 for s in snaps)
    assert all(s.taken_at.startswith("2026-07-12T11:05") for s in snaps)
    # second capture for the same event date is a no-op
    assert capture_snapshot(store, results, highs, sigmas, now=now) == 0


def test_capture_skips_before_11am(tmp_path):
    store = Store(tmp_path / "s.db")
    now = datetime(2026, 7, 12, 9, 0, tzinfo=ET)
    assert capture_snapshot(store, [_result("M", 88, 89, 0.4, 0.5)], {}, {}, now=now) == 0


def _snap(market_id: str, lo: float, hi: float, market_prob: float, model_prob: float,
          city: str = "NYC", event_date: str = "2026-07-02") -> SnapshotRow:
    return SnapshotRow(
        market_id=market_id, city=city, event_date=event_date, comparator="between",
        threshold=None, threshold_low=lo, threshold_high=hi, question=f"q {market_id}",
        market_prob=market_prob, model_prob=model_prob, consensus=88.6, sigma=1.5,
        taken_at="2026-07-01T11:02:00-04:00",
    )


def test_scorecard_scores_model_and_market_picks(tmp_path):
    store = Store(tmp_path / "s.db")
    # model favored 88-89 (settled YES); the 11 AM market favored 90-91
    store.upsert_snapshots([
        _snap("KXHIGHNY-26JUL02-B88.5", 88, 89, market_prob=0.30, model_prob=0.55),
        _snap("KXHIGHNY-26JUL02-B90.5", 90, 91, market_prob=0.45, model_prob=0.25),
    ])
    store.upsert(
        [
            seed_row(market_id="KXHIGHNY-26JUL02-B88.5", outcome=1),
            seed_row(market_id="KXHIGHNY-26JUL02-B90.5", outcome=0),
        ]
    )
    card = scorecard(store, "gfs_seamless", "2026-06-12")
    assert card.n_scored == 1
    assert card.model_hits == 1
    assert card.market_hits == 0
    assert card.days == [
        {"event_date": "2026-07-02", "n": 1, "model_hits": 1, "market_hits": 0}
    ]


def test_scorecard_counts_unsettled_snapshots_as_pending(tmp_path):
    store = Store(tmp_path / "s.db")
    store.upsert_snapshots([_snap("M-1", 88, 89, 0.4, 0.5, event_date="2026-07-13")])
    card = scorecard(store, "gfs_seamless", "2026-06-12")
    assert card.n_scored == 0
    assert card.n_pending == 1
    assert card.days == []
