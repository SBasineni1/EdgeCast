import pytest

from edgecast.store import Store, VerificationRow, bucket_label


def make_row(**kw) -> VerificationRow:
    base = dict(
        market_id="M1", model="gfs_seamless", series="KXHIGHAUS", city="AUS",
        event_date="2026-07-02", comparator="between",
        threshold=None, threshold_low=96.0, threshold_high=97.0,
        question="q", market_prob=0.85, model_prob=0.71, model_prob_raw=0.71,
        n_members=31, observed_high=96.0, outcome=1, kalshi_result="yes",
        brier_market=0.0225, brier_model=0.0841,
        observed_source="ACIS KATT", model_source="open-meteo gfs_seamless (short-lead)",
        verified_at="2026-07-03T12:00:00+00:00",
    )
    base.update(kw)
    return VerificationRow(**base)


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "data" / "test.db")


def test_upsert_idempotent(store):
    store.upsert([make_row()])
    store.upsert([make_row(market_prob=0.9)])  # same PK, replaces
    rows = store.rows_for_date("gfs_seamless", "2026-07-02")
    assert len(rows) == 1
    assert rows[0].market_prob == 0.9


def test_covered_and_missing(store):
    store.upsert([make_row()])
    assert store.covered("gfs_seamless", ["2026-07-02"]) == {("AUS", "2026-07-02")}
    assert store.dates_missing("gfs_seamless", ["2026-07-01", "2026-07-02"]) == ["2026-07-01"]


def test_window_stats_and_hit_rate(store):
    # AUS 7/2: market favorite hits (row A outcome 1, market_prob max), model favorite misses
    store.upsert([
        make_row(market_id="A", market_prob=0.85, model_prob=0.30, outcome=1,
                 brier_market=0.0225, brier_model=0.49),
        make_row(market_id="B", market_prob=0.10, model_prob=0.60, outcome=0,
                 threshold_low=98.0, threshold_high=99.0,
                 brier_market=0.01, brier_model=0.36),
    ])
    stats = store.window_stats("gfs_seamless", since_date="2026-07-01")
    assert stats.n_markets == 2 and stats.n_days == 1
    assert stats.market.mean_brier == pytest.approx((0.0225 + 0.01) / 2)
    assert stats.market.hit_rate == 1.0   # market favorite (A) hit
    assert stats.model.hit_rate == 0.0    # model favorite (B) missed
    assert stats.better_calibrated == "market"


def test_window_stats_none_when_empty(store):
    assert store.window_stats("gfs_seamless", "2026-01-01") is None


def test_since_date_excludes_older(store):
    store.upsert([make_row(event_date="2026-06-01")])
    assert store.window_stats("gfs_seamless", "2026-07-01") is None


def test_city_stats_grouping(store):
    store.upsert([make_row(), make_row(market_id="N1", city="NYC", series="KXHIGHNY")])
    by_city = store.city_stats("gfs_seamless", "2026-07-01")
    assert set(by_city) == {"AUS", "NYC"}


def test_mismatches(store):
    store.upsert([
        make_row(),                                              # consistent
        make_row(market_id="X", kalshi_result="no", outcome=1),  # mismatch
        make_row(market_id="Y", kalshi_result=None),             # unknown, not a mismatch
    ])
    assert [r.market_id for r in store.mismatches("gfs_seamless", "2026-07-01")] == ["X"]


def test_bucket_label():
    assert bucket_label("between", None, 88.0, 89.0) == "88–89°"
    assert bucket_label(">=", 98.0, None, None) == "98° or above"
    assert bucket_label("<=", 93.0, None, None) == "93° or below"
    assert bucket_label(">", 95.0, None, None) == "above 95°"
    assert bucket_label("<", 60.0, None, None) == "below 60°"
