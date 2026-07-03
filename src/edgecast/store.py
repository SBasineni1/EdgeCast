"""SQLite verification store: settled markets scored per model."""

import sqlite3
from dataclasses import dataclass, fields
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS verifications (
  market_id TEXT NOT NULL,
  model TEXT NOT NULL,
  series TEXT NOT NULL,
  city TEXT NOT NULL,
  event_date TEXT NOT NULL,
  comparator TEXT NOT NULL,
  threshold REAL, threshold_low REAL, threshold_high REAL,
  question TEXT NOT NULL,
  market_prob REAL NOT NULL,
  model_prob REAL NOT NULL,
  model_prob_raw REAL NOT NULL,
  n_members INTEGER NOT NULL,
  observed_high REAL NOT NULL,
  outcome INTEGER NOT NULL,
  kalshi_result TEXT,
  brier_market REAL NOT NULL,
  brier_model REAL NOT NULL,
  observed_source TEXT NOT NULL,
  model_source TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  PRIMARY KEY (market_id, model)
);
CREATE INDEX IF NOT EXISTS idx_verifications_date ON verifications(event_date);
"""


@dataclass(frozen=True)
class VerificationRow:
    market_id: str
    model: str
    series: str
    city: str
    event_date: str
    comparator: str
    threshold: float | None
    threshold_low: float | None
    threshold_high: float | None
    question: str
    market_prob: float
    model_prob: float
    model_prob_raw: float
    n_members: int
    observed_high: float
    outcome: int
    kalshi_result: str | None
    brier_market: float
    brier_model: float
    observed_source: str
    model_source: str
    verified_at: str


_COLS = [f.name for f in fields(VerificationRow)]


@dataclass(frozen=True)
class SideStats:
    mean_brier: float
    hit_rate: float


@dataclass(frozen=True)
class WindowStats:
    n_markets: int
    n_days: int
    market: SideStats
    model: SideStats
    better_calibrated: str


def bucket_label(
    comparator: str,
    threshold: float | None,
    threshold_low: float | None,
    threshold_high: float | None,
) -> str:
    def fmt(x: float) -> str:
        return f"{x:g}"

    if comparator == "between":
        return f"{fmt(threshold_low)}–{fmt(threshold_high)}°"
    if comparator == ">=":
        return f"{fmt(threshold)}° or above"
    if comparator == "<=":
        return f"{fmt(threshold)}° or below"
    if comparator == ">":
        return f"above {fmt(threshold)}°"
    return f"below {fmt(threshold)}°"


def _stats(rows: list[VerificationRow]) -> WindowStats:
    n = len(rows)
    groups: dict[tuple[str, str], list[VerificationRow]] = {}
    for r in rows:
        groups.setdefault((r.city, r.event_date), []).append(r)
    market_hits = sum(
        1 for g in groups.values() if max(g, key=lambda r: r.market_prob).outcome == 1
    )
    model_hits = sum(
        1 for g in groups.values() if max(g, key=lambda r: r.model_prob).outcome == 1
    )
    n_groups = len(groups)
    mean_bm = sum(r.brier_market for r in rows) / n
    mean_bd = sum(r.brier_model for r in rows) / n
    if mean_bd < mean_bm:
        better = "model"
    elif mean_bd > mean_bm:
        better = "market"
    else:
        better = "tie"
    return WindowStats(
        n_markets=n,
        n_days=len({r.event_date for r in rows}),
        market=SideStats(mean_brier=mean_bm, hit_rate=market_hits / n_groups),
        model=SideStats(mean_brier=mean_bd, hit_rate=model_hits / n_groups),
        better_calibrated=better,
    )


class Store:
    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._path)
        self._conn.executescript(_SCHEMA)

    def upsert(self, rows: list[VerificationRow]) -> None:
        placeholders = ", ".join("?" for _ in _COLS)
        with self._conn:
            self._conn.executemany(
                f"INSERT OR REPLACE INTO verifications ({', '.join(_COLS)}) "
                f"VALUES ({placeholders})",
                [tuple(getattr(r, c) for c in _COLS) for r in rows],
            )

    def _select(self, where: str, params: tuple) -> list[VerificationRow]:
        cur = self._conn.execute(
            f"SELECT {', '.join(_COLS)} FROM verifications WHERE {where}", params
        )
        return [VerificationRow(**dict(zip(_COLS, row))) for row in cur.fetchall()]

    def covered(self, model: str, dates: list[str]) -> set[tuple[str, str]]:
        if not dates:
            return set()
        marks = ", ".join("?" for _ in dates)
        cur = self._conn.execute(
            f"SELECT DISTINCT city, event_date FROM verifications "
            f"WHERE model = ? AND event_date IN ({marks})",
            (model, *dates),
        )
        return set(cur.fetchall())

    def dates_missing(self, model: str, dates: list[str]) -> list[str]:
        have = {d for _, d in self.covered(model, dates)}
        return sorted((d for d in dates if d not in have), reverse=True)

    def rows_for_date(self, model: str, event_date: str) -> list[VerificationRow]:
        return self._select("model = ? AND event_date = ?", (model, event_date))

    def window_stats(self, model: str, since_date: str) -> WindowStats | None:
        rows = self._select("model = ? AND event_date >= ?", (model, since_date))
        return _stats(rows) if rows else None

    def city_stats(self, model: str, since_date: str) -> dict[str, WindowStats]:
        rows = self._select("model = ? AND event_date >= ?", (model, since_date))
        by_city: dict[str, list[VerificationRow]] = {}
        for r in rows:
            by_city.setdefault(r.city, []).append(r)
        return {city: _stats(city_rows) for city, city_rows in by_city.items()}

    def mismatches(self, model: str, since_date: str) -> list[VerificationRow]:
        rows = self._select(
            "model = ? AND event_date >= ? AND kalshi_result IS NOT NULL",
            (model, since_date),
        )
        return [
            r for r in rows if (r.kalshi_result == "yes") != (r.outcome == 1)
        ]
