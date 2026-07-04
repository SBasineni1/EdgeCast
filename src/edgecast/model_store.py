"""SQLite model-grading store: day-ahead predictions scored per model."""

import sqlite3
from dataclasses import dataclass, fields
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS model_days (
  model TEXT NOT NULL,
  lead TEXT NOT NULL,
  city TEXT NOT NULL,
  series TEXT NOT NULL,
  event_date TEXT NOT NULL,
  predicted_high REAL NOT NULL,
  observed_high REAL NOT NULL,
  error REAL NOT NULL,
  abs_error REAL NOT NULL,
  bucket_hit INTEGER,
  observed_source TEXT NOT NULL,
  model_source TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  PRIMARY KEY (model, lead, city, event_date)
);
CREATE INDEX IF NOT EXISTS idx_model_days_date ON model_days(lead, event_date);
"""


@dataclass(frozen=True)
class ModelDayRow:
    model: str
    lead: str
    city: str
    series: str
    event_date: str
    predicted_high: float
    observed_high: float
    error: float
    abs_error: float
    bucket_hit: int | None
    observed_source: str
    model_source: str
    verified_at: str


_COLS = [f.name for f in fields(ModelDayRow)]


@dataclass(frozen=True)
class GradeStats:
    n_days: int
    mae: float
    bias: float
    bucket_hit_rate: float | None


def _stats(rows: list[ModelDayRow]) -> GradeStats:
    n = len(rows)
    hits = [r.bucket_hit for r in rows if r.bucket_hit is not None]
    return GradeStats(
        n_days=n,
        mae=sum(r.abs_error for r in rows) / n,
        bias=sum(r.error for r in rows) / n,
        bucket_hit_rate=(sum(hits) / len(hits)) if hits else None,
    )


class ModelStore:
    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._path)
        self._conn.executescript(_SCHEMA)

    def upsert(self, rows: list[ModelDayRow]) -> None:
        placeholders = ", ".join("?" for _ in _COLS)
        with self._conn:
            self._conn.executemany(
                f"INSERT OR REPLACE INTO model_days ({', '.join(_COLS)}) "
                f"VALUES ({placeholders})",
                [tuple(getattr(r, c) for c in _COLS) for r in rows],
            )

    def _select(self, where: str, params: tuple) -> list[ModelDayRow]:
        cur = self._conn.execute(
            f"SELECT {', '.join(_COLS)} FROM model_days WHERE {where}", params
        )
        return [ModelDayRow(**dict(zip(_COLS, row))) for row in cur.fetchall()]

    def covered(self, model: str, lead: str, dates: list[str]) -> set[tuple[str, str]]:
        if not dates:
            return set()
        marks = ", ".join("?" for _ in dates)
        cur = self._conn.execute(
            f"SELECT DISTINCT city, event_date FROM model_days "
            f"WHERE model = ? AND lead = ? AND event_date IN ({marks})",
            (model, lead, *dates),
        )
        return set(cur.fetchall())

    def dates_missing(self, lead: str, dates: list[str]) -> list[str]:
        have = {d for _, d in self.covered("consensus", lead, dates)}
        return sorted((d for d in dates if d not in have), reverse=True)

    def trailing_errors(
        self, model: str, lead: str, city: str, before_date: str, limit: int = 15
    ) -> list[float]:
        cur = self._conn.execute(
            "SELECT error FROM model_days "
            "WHERE model = ? AND lead = ? AND city = ? AND event_date < ? "
            "ORDER BY event_date DESC LIMIT ?",
            (model, lead, city, before_date, limit),
        )
        return [row[0] for row in cur.fetchall()]

    def overall_grades(self, lead: str, since_date: str) -> dict[str, GradeStats]:
        rows = self._select("lead = ? AND event_date >= ?", (lead, since_date))
        by_model: dict[str, list[ModelDayRow]] = {}
        for r in rows:
            by_model.setdefault(r.model, []).append(r)
        return {m: _stats(rs) for m, rs in by_model.items()}

    def city_grades(self, lead: str, since_date: str) -> dict[str, dict[str, GradeStats]]:
        rows = self._select("lead = ? AND event_date >= ?", (lead, since_date))
        by_city: dict[str, dict[str, list[ModelDayRow]]] = {}
        for r in rows:
            by_city.setdefault(r.city, {}).setdefault(r.model, []).append(r)
        return {
            city: {m: _stats(rs) for m, rs in models.items()}
            for city, models in by_city.items()
        }
