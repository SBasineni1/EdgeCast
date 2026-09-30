"""SQLite history store: archived model forecasts and settled Kalshi markets.

Point-in-time columns:
- forecast_history.issued_by: no model run behind the predicted high was
  initialised after this UTC time.
- market_history.price_target_at: the fixed pre-settlement decision time the
  quote is taken for; price_observed_at: when that quote was last set (end of
  the candle it comes from, always <= price_target_at).
"""

from dataclasses import dataclass, fields
from pathlib import Path

from edgecast import db

_SCHEMA = """
CREATE TABLE IF NOT EXISTS forecast_history (
  model TEXT NOT NULL,
  lead_days INTEGER NOT NULL,
  city TEXT NOT NULL,
  series TEXT NOT NULL,
  event_date TEXT NOT NULL,
  predicted_high REAL NOT NULL,
  n_hours INTEGER NOT NULL,
  issued_by TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (model, lead_days, city, event_date)
);
CREATE INDEX IF NOT EXISTS idx_forecast_history_date ON forecast_history(city, event_date);
CREATE TABLE IF NOT EXISTS market_history (
  ticker TEXT NOT NULL PRIMARY KEY,
  event_ticker TEXT NOT NULL,
  series TEXT NOT NULL,
  city TEXT NOT NULL,
  event_date TEXT NOT NULL,
  strike_type TEXT NOT NULL,
  floor_strike REAL,
  cap_strike REAL,
  result TEXT,
  settled_value REAL,
  open_time TEXT,
  close_time TEXT,
  settlement_ts TEXT,
  source TEXT NOT NULL,
  price_target_at TEXT NOT NULL,
  price_observed_at TEXT,
  yes_bid REAL,
  yes_ask REAL,
  last_price REAL,
  volume_to_target REAL,
  quote_fetched_at TEXT,
  fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_market_history_date ON market_history(city, event_date)
"""


@dataclass(frozen=True)
class ForecastHistoryRow:
    model: str
    lead_days: int
    city: str
    series: str
    event_date: str
    predicted_high: float
    n_hours: int
    issued_by: str
    source: str
    fetched_at: str


_F_COLS = [f.name for f in fields(ForecastHistoryRow)]


@dataclass(frozen=True)
class MarketHistoryRow:
    """Settlement metadata for one market; the quote columns are filled separately."""

    ticker: str
    event_ticker: str
    series: str
    city: str
    event_date: str
    strike_type: str
    floor_strike: float | None
    cap_strike: float | None
    result: str | None
    settled_value: float | None
    open_time: str | None
    close_time: str | None
    settlement_ts: str | None
    source: str
    price_target_at: str
    fetched_at: str


_M_COLS = [f.name for f in fields(MarketHistoryRow)]


@dataclass(frozen=True)
class PendingQuote:
    ticker: str
    series: str
    source: str
    open_time: str | None
    price_target_at: str


class HistoryStore:
    def __init__(self, path: str | Path) -> None:
        self._conn = db.connect(path)
        db.apply_schema(self._conn, _SCHEMA)

    def upsert_forecasts(self, rows: list[ForecastHistoryRow]) -> None:
        placeholders = ", ".join("?" for _ in _F_COLS)
        self._conn.executemany(
            f"INSERT OR REPLACE INTO forecast_history ({', '.join(_F_COLS)}) "
            f"VALUES ({placeholders})",
            [tuple(getattr(r, c) for c in _F_COLS) for r in rows],
        )
        self._conn.commit()

    def forecast_dates(self, model: str, lead_days: int, city: str,
                       start: str, end: str) -> set[str]:
        cur = self._conn.execute(
            "SELECT event_date FROM forecast_history WHERE model = ? AND lead_days = ? "
            "AND city = ? AND event_date BETWEEN ? AND ?",
            (model, lead_days, city, start, end),
        )
        return {row[0] for row in cur.fetchall()}

    def upsert_markets(self, rows: list[MarketHistoryRow]) -> None:
        """Insert or refresh settlement metadata without touching fetched quotes."""
        placeholders = ", ".join("?" for _ in _M_COLS)
        updates = ", ".join(f"{c} = excluded.{c}" for c in _M_COLS if c != "ticker")
        self._conn.executemany(
            f"INSERT INTO market_history ({', '.join(_M_COLS)}) VALUES ({placeholders}) "
            f"ON CONFLICT(ticker) DO UPDATE SET {updates}",
            [tuple(getattr(r, c) for c in _M_COLS) for r in rows],
        )
        self._conn.commit()

    def pending_quotes(self, start: str, end: str) -> list[PendingQuote]:
        cur = self._conn.execute(
            "SELECT ticker, series, source, open_time, price_target_at FROM market_history "
            "WHERE quote_fetched_at IS NULL AND event_date BETWEEN ? AND ? "
            "ORDER BY event_date, ticker",
            (start, end),
        )
        return [PendingQuote(*row) for row in cur.fetchall()]

    def set_quote(
        self, ticker: str, quote: dict | None, observed_at: str | None, fetched_at: str
    ) -> None:
        """Record the pre-settlement quote; a None quote marks it fetched-but-absent."""
        q = quote or {}
        self._conn.execute(
            "UPDATE market_history SET price_observed_at = ?, yes_bid = ?, yes_ask = ?, "
            "last_price = ?, volume_to_target = ?, quote_fetched_at = ? WHERE ticker = ?",
            (observed_at, q.get("yes_bid"), q.get("yes_ask"), q.get("last_price"),
             q.get("volume"), fetched_at, ticker),
        )
        self._conn.commit()
