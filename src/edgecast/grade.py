"""Day-ahead model grading: archived forecasts vs official observed highs."""

import math
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

import httpx

from edgecast.conditions import satisfies_market
from edgecast.consensus import consensus_point, trailing_bias
from edgecast.live.acis import AcisUnavailable, fetch_observed_highs
from edgecast.live.kalshi import (
    event_ticker_for,
    fetch_event_markets,
    to_quote,
    to_result,
)
from edgecast.live.previous_runs import SOURCE_MODELS, fetch_previous_day1_highs
from edgecast.live.stations import STATIONS
from edgecast.model_store import ModelDayRow, ModelStore
from edgecast.types import MarketQuote

LEAD = "day_ahead"


@dataclass
class GradeReport:
    dates_attempted: list[str]
    n_rows: int = 0
    failures: list[dict] = field(default_factory=list)


def bucket_hit(predicted_high: float, yes_quote: MarketQuote | None) -> int | None:
    """1/0 if the rounded prediction lands in the yes-settled bucket; None if unknown.

    Kalshi bins cover integer reported temps, so round half-up first: a raw
    96.4 would otherwise fall between the [95,96] and [97,98] bins.
    """
    if yes_quote is None:
        return None
    return int(satisfies_market(float(math.floor(predicted_high + 0.5)), yes_quote))


RETRY_DELAYS = (2.0, 8.0)  # Kalshi rate-limits bulk backfills; back off on 429


def _fetch_markets_retrying(event_ticker: str, client) -> list[dict]:
    for delay in (*RETRY_DELAYS, None):
        try:
            return fetch_event_markets(event_ticker, client)
        except httpx.HTTPStatusError as e:
            if delay is None or e.response.status_code != 429:
                raise
            time.sleep(delay)
    raise AssertionError("unreachable")


def _yes_quote(markets: list[dict], city: str) -> MarketQuote | None:
    for m in markets:
        if to_result(m) == "yes":
            q = to_quote(m, city)
            if q is not None:
                return q
    return None


def grade_days(
    dates: list[str], model_store: ModelStore, kalshi_client, meteo_client
) -> GradeReport:
    report = GradeReport(dates_attempted=sorted(dates))
    now = datetime.now(timezone.utc).isoformat()

    for series, st in STATIONS.items():
        covered = model_store.covered("consensus", LEAD, list(dates))
        todo = sorted(d for d in dates if (st.city, d) not in covered)
        if not todo:
            continue

        try:
            observed = fetch_observed_highs(st.acis_sid, min(todo), max(todo), meteo_client)
        except AcisUnavailable as e:
            report.failures.extend(
                {"city": st.city, "date": d, "stage": "acis", "reason": str(e)}
                for d in todo
            )
            continue

        try:
            preds = fetch_previous_day1_highs(
                st.lat, st.lon, min(todo), max(todo), st.tz, meteo_client
            )
        except Exception as e:  # noqa: BLE001 - upstream failure isolates this city
            report.failures.extend(
                {"city": st.city, "date": d, "stage": "open-meteo",
                 "reason": f"{type(e).__name__}: {e}"}
                for d in todo
            )
            continue

        # Ascending: consensus bias for date D reads rows strictly before D.
        for d in todo:
            if d not in observed:
                report.failures.append(
                    {"city": st.city, "date": d, "stage": "acis",
                     "reason": f"no observation for {d}"}
                )
                continue
            model_preds = {m: preds[m][d] for m in SOURCE_MODELS if d in preds.get(m, {})}
            if not model_preds:
                report.failures.append(
                    {"city": st.city, "date": d, "stage": "open-meteo",
                     "reason": f"no model forecasts for {d}"}
                )
                continue
            yes_q: MarketQuote | None = None
            try:
                markets = _fetch_markets_retrying(
                    event_ticker_for(series, date.fromisoformat(d)), kalshi_client
                )
                yes_q = _yes_quote(markets, st.city)
            except Exception as e:  # noqa: BLE001 - bucket grading degrades to NULL
                report.failures.append(
                    {"city": st.city, "date": d, "stage": "kalshi",
                     "reason": f"{type(e).__name__}: {e}"}
                )

            def _row(model: str, predicted: float, source: str) -> ModelDayRow:
                err = predicted - observed[d]
                return ModelDayRow(
                    model=model, lead=LEAD, city=st.city, series=series,
                    event_date=d, predicted_high=predicted,
                    observed_high=observed[d], error=err, abs_error=abs(err),
                    bucket_hit=bucket_hit(predicted, yes_q),
                    observed_source=f"ACIS {st.acis_sid}", model_source=source,
                    verified_at=now,
                )

            rows = [
                _row(m, p, f"open-meteo {m} previous_day1")
                for m, p in model_preds.items()
            ]
            biases = {
                m: trailing_bias(model_store.trailing_errors(m, LEAD, st.city, d))
                for m in model_preds
            }
            mu = consensus_point(model_preds, biases)
            rows.append(_row("consensus", mu, f"consensus({','.join(sorted(model_preds))})"))
            model_store.upsert(rows)
            report.n_rows += len(rows)
    return report
