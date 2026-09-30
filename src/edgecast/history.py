"""Multi-year backfill: archived forecasts, settled Kalshi markets, model grading.

Three steps over an event-date range, each resumable (reruns skip finished work):

1. Forecasts: day-1 and day-2 lead daily highs for NBM, HRRR, GFS, ECMWF, ICON
   and GEM from Open-Meteo's previous-runs archive (most models from 2024-02).
2. Markets: every settled market in each city's series (live + historical
   endpoints, including pre-KX tickers), with the standing bid/ask at the fixed
   pre-settlement time: 11 AM ET the day before, the live snapshot's rule.
3. Grading: day-ahead model_days rows (the ML training table) for the range,
   graded against the bucket that settled YES.
"""

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx

from edgecast.grade import grade_days
from edgecast.history_store import ForecastHistoryRow, HistoryStore, MarketHistoryRow
from edgecast.live.kalshi import (
    event_date_from_ticker,
    fetch_historical_cutoff,
    fetch_hourly_candles,
    fetch_series_markets,
    quote_at,
    to_result,
)
from edgecast.live.previous_runs import HISTORY_LEADS, fetch_previous_highs
from edgecast.live.stations import STATIONS
from edgecast.model_store import ModelStore
from edgecast.snapshot import ET, SNAPSHOT_HOUR_ET

FORECAST_CHUNK_DAYS = 31
GRADE_CHUNK_DAYS = 31
METEO_PAUSE = 1.0     # Open-Meteo free tier: 600 weighted calls/min
KALSHI_PAUSE = 0.06   # Kalshi basic tier: 20 reads/s
RETRY_DELAYS = (2.0, 8.0, 30.0)
COMPLETENESS_MODEL = "gfs_global"  # archived since 2021; marks a chunk as fetched


@dataclass
class HistoryReport:
    forecast_rows: int = 0
    markets: int = 0
    quotes: int = 0
    quotes_missing: int = 0
    graded_rows: int = 0
    failures: list[dict] = field(default_factory=list)


def price_target(event_date: str, hour_et: int = SNAPSHOT_HOUR_ET) -> datetime:
    """The fixed pre-settlement decision time for an event date, in UTC."""
    d = date.fromisoformat(event_date) - timedelta(days=1)
    return datetime(d.year, d.month, d.day, hour_et, tzinfo=ET).astimezone(timezone.utc)


def issued_by(last_valid_local: str, tz: str, lead_days: int) -> str:
    """Latest possible init time (UTC) of any run behind a lead-N daily high."""
    local = datetime.fromisoformat(last_valid_local).replace(tzinfo=ZoneInfo(tz))
    return (local.astimezone(timezone.utc) - timedelta(hours=24 * lead_days)).isoformat()


def date_chunks(start: str, end: str, days: int) -> list[tuple[str, str]]:
    out = []
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    while s <= e:
        c_end = min(s + timedelta(days=days - 1), e)
        out.append((s.isoformat(), c_end.isoformat()))
        s = c_end + timedelta(days=1)
    return out


def _retrying(fn: Callable, *args, sleep: Callable[[float], None] = time.sleep, **kwargs):
    """Call fn, backing off on 429s, 5xxs and transport errors."""
    for delay in (*RETRY_DELAYS, None):
        try:
            return fn(*args, **kwargs)
        except httpx.HTTPStatusError as e:
            code = e.response.status_code
            if delay is None or (code != 429 and code < 500):
                raise
        except httpx.TransportError:
            if delay is None:
                raise
        sleep(delay)
    raise AssertionError("unreachable")


def _iso(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def backfill_forecasts(
    store: HistoryStore, start: str, end: str, client, report: HistoryReport,
    sleep: Callable[[float], None] = time.sleep,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    for series, st in STATIONS.items():
        for c_start, c_end in date_chunks(start, end, FORECAST_CHUNK_DAYS):
            want = {d for d, _ in date_chunks(c_start, c_end, 1)}
            if want <= store.forecast_dates(COMPLETENESS_MODEL, 1, st.city, c_start, c_end):
                continue
            try:
                highs = _retrying(
                    fetch_previous_highs, st.lat, st.lon, c_start, c_end, st.tz, client,
                    sleep=sleep,
                )
            except Exception as e:  # noqa: BLE001 - one failed chunk must not stop the run
                report.failures.append(
                    {"step": "forecasts", "city": st.city, "dates": f"{c_start}..{c_end}",
                     "reason": f"{type(e).__name__}: {e}"}
                )
                continue
            rows = [
                ForecastHistoryRow(
                    model=model, lead_days=lead, city=st.city, series=series,
                    event_date=d, predicted_high=h.high, n_hours=h.n_hours,
                    issued_by=issued_by(h.last_valid, st.tz, lead),
                    source=f"open-meteo previous-runs temperature_2m_previous_day{lead}",
                    fetched_at=now,
                )
                for (model, lead), by_date in highs.items()
                if lead in HISTORY_LEADS
                for d, h in by_date.items()
                if c_start <= d <= c_end
            ]
            store.upsert_forecasts(rows)
            report.forecast_rows += len(rows)
            sleep(METEO_PAUSE)


def list_settled_markets(
    start: str, end: str, client, report: HistoryReport,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, list[tuple[dict, str]]]:
    """Per series, the settled markets with event dates in [start, end].

    Each entry is (raw market, source) where source is "historical" or "live".
    The archive is only read when the range reaches back past Kalshi's cutoff.
    """
    cutoff = _iso(_retrying(fetch_historical_cutoff, client, sleep=sleep))
    need_archive = cutoff is None or date.fromisoformat(start) <= cutoff.date()
    out: dict[str, list[tuple[dict, str]]] = {}
    for series in STATIONS:
        sources = [("live", False, "settled")]
        if need_archive:
            sources.insert(0, ("historical", True, None))
        seen: dict[str, tuple[dict, str]] = {}
        for label, historical, status in sources:
            try:
                markets = _retrying(
                    fetch_series_markets, series, client, historical=historical,
                    status=status, sleep=sleep,
                )
            except Exception as e:  # noqa: BLE001
                report.failures.append(
                    {"step": "markets", "city": STATIONS[series].city, "dates": label,
                     "reason": f"{type(e).__name__}: {e}"}
                )
                continue
            for m in markets:
                try:
                    d = event_date_from_ticker(m.get("event_ticker", ""))
                except ValueError:
                    continue
                if start <= d <= end and to_result(m) is not None:
                    seen.setdefault(m["ticker"], (m, label))
            sleep(KALSHI_PAUSE)
        out[series] = list(seen.values())
    return out


def _market_row(series: str, m: dict, source: str, now: str) -> MarketHistoryRow:
    event_date = event_date_from_ticker(m["event_ticker"])
    value = m.get("expiration_value")
    try:
        settled_value = float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        settled_value = None
    return MarketHistoryRow(
        ticker=m["ticker"], event_ticker=m["event_ticker"], series=series,
        city=STATIONS[series].city, event_date=event_date,
        strike_type=m.get("strike_type") or "",
        floor_strike=m.get("floor_strike"), cap_strike=m.get("cap_strike"),
        result=to_result(m), settled_value=settled_value,
        open_time=m.get("open_time"), close_time=m.get("close_time"),
        settlement_ts=m.get("settlement_ts"), source=source,
        price_target_at=price_target(event_date).isoformat(), fetched_at=now,
    )


def backfill_markets(
    store: HistoryStore, start: str, end: str,
    markets: dict[str, list[tuple[dict, str]]], client, report: HistoryReport,
    sleep: Callable[[float], None] = time.sleep,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    rows = [_market_row(s, m, src, now) for s, ms in markets.items() for m, src in ms]
    store.upsert_markets(rows)
    report.markets += len(rows)

    for p in store.pending_quotes(start, end):
        target = _iso(p.price_target_at)
        opened = _iso(p.open_time) or target - timedelta(days=2)
        fetched_at = datetime.now(timezone.utc).isoformat()
        if target < opened:  # market opened after the decision time: no quote exists
            store.set_quote(p.ticker, None, None, fetched_at)
            report.quotes_missing += 1
            continue
        try:
            candles = _retrying(
                fetch_hourly_candles, p.series, p.ticker, int(opened.timestamp()),
                int(target.timestamp()), client, historical=p.source == "historical",
                sleep=sleep,
            )
        except Exception as e:  # noqa: BLE001 - left pending; a rerun retries it
            report.failures.append(
                {"step": "quotes", "city": p.series, "dates": p.ticker,
                 "reason": f"{type(e).__name__}: {e}"}
            )
            continue
        q = quote_at(candles, int(target.timestamp()))
        observed = (
            datetime.fromtimestamp(q["as_of_ts"], timezone.utc).isoformat() if q else None
        )
        store.set_quote(p.ticker, q, observed, fetched_at)
        if q is None:
            report.quotes_missing += 1
        else:
            report.quotes += 1
        sleep(KALSHI_PAUSE)


def grade_history(
    model_store: ModelStore, start: str, end: str,
    markets: dict[str, list[tuple[dict, str]]], kalshi_client, meteo_client,
    report: HistoryReport,
) -> None:
    by_day: dict[tuple[str, str], list[dict]] = {}
    for series, ms in markets.items():
        for m, _ in ms:
            by_day.setdefault(
                (series, event_date_from_ticker(m["event_ticker"])), []
            ).append(m)

    def markets_for(series: str, d: str) -> list[dict]:
        return by_day.get((series, d), [])

    # Oldest first: each date's consensus bias reads only earlier graded rows.
    for c_start, c_end in date_chunks(start, end, GRADE_CHUNK_DAYS):
        dates = [d for d, _ in date_chunks(c_start, c_end, 1)]
        g = grade_days(dates, model_store, kalshi_client, meteo_client,
                       markets_for=markets_for)
        report.graded_rows += g.n_rows
        report.failures.extend({"step": "grading", **f} for f in g.failures)


def run_history_backfill(
    db_path: str, start: str, end: str, steps: set[str],
    kalshi_client, meteo_client, sleep: Callable[[float], None] = time.sleep,
) -> HistoryReport:
    report = HistoryReport()
    store = HistoryStore(db_path)
    if "forecasts" in steps:
        backfill_forecasts(store, start, end, meteo_client, report, sleep=sleep)
    if steps & {"markets", "grades"}:
        markets = list_settled_markets(start, end, kalshi_client, report, sleep=sleep)
        if "markets" in steps:
            backfill_markets(store, start, end, markets, kalshi_client, report, sleep=sleep)
        if "grades" in steps:
            grade_history(ModelStore(db_path), start, end, markets,
                          kalshi_client, meteo_client, report)
    return report
