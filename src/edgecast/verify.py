"""Verifier: settle and score past Kalshi markets against official observations."""

from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from edgecast.live.acis import AcisUnavailable, fetch_observed_highs
from edgecast.live.kalshi import (
    event_ticker_for,
    fetch_event_markets,
    to_quote,
    to_result,
)
from edgecast.live.openmeteo import fetch_ensemble_past_highs
from edgecast.live.stations import STATIONS
from edgecast.pipeline import analyze
from edgecast.store import Store, VerificationRow
from edgecast.types import EnsembleForecast, Observation, Scenario


@dataclass
class VerifyReport:
    dates_attempted: list[str]
    n_markets_verified: int = 0
    failures: list[dict] = field(default_factory=list)
    mismatches: list[dict] = field(default_factory=list)


def verify_days(
    dates: list[str],
    store: Store,
    kalshi_client,
    meteo_client,
    model: str = "gfs_seamless",
) -> VerifyReport:
    report = VerifyReport(dates_attempted=list(dates))
    covered = store.covered(model, list(dates))
    now = datetime.now(timezone.utc).isoformat()

    for series, st in STATIONS.items():
        todo = [d for d in dates if (st.city, d) not in covered]
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
            hindcasts = fetch_ensemble_past_highs(
                st.lat, st.lon, todo, st.tz, meteo_client, model=model
            )
        except Exception as e:  # noqa: BLE001 - upstream failure isolates this city
            report.failures.extend(
                {"city": st.city, "date": d, "stage": "open-meteo",
                 "reason": f"{type(e).__name__}: {e}"}
                for d in todo
            )
            continue

        for d in todo:
            if d not in observed:
                report.failures.append(
                    {"city": st.city, "date": d, "stage": "acis",
                     "reason": f"no observation for {d}"}
                )
                continue
            if d not in hindcasts:
                report.failures.append(
                    {"city": st.city, "date": d, "stage": "open-meteo",
                     "reason": f"no ensemble data for {d}"}
                )
                continue
            try:
                markets = fetch_event_markets(event_ticker_for(series, date.fromisoformat(d)), kalshi_client)
            except Exception as e:  # noqa: BLE001
                report.failures.append(
                    {"city": st.city, "date": d, "stage": "kalshi",
                     "reason": f"{type(e).__name__}: {e}"}
                )
                continue
            pairs = [
                (q, to_result(m))
                for m in markets
                if (q := to_quote(m, st.city)) is not None
            ]
            if not pairs:
                report.failures.append(
                    {"city": st.city, "date": d, "stage": "kalshi",
                     "reason": "no priced markets"}
                )
                continue
            forecast = EnsembleForecast(
                source=f"open-meteo {model} (short-lead)",
                issued_at=now,
                members=hindcasts[d],
            )
            scenarios = [
                Scenario(
                    scenario_id=q.market_id,
                    market=q,
                    forecast=forecast,
                    observation=Observation(observed[d]),
                )
                for q, _ in pairs
            ]
            results, _ = analyze(scenarios)
            kalshi_results = {q.market_id: r for q, r in pairs}
            rows = []
            for res in results:
                kr = kalshi_results.get(res.scenario_id)
                if kr is not None and (kr == "yes") != (res.settlement.outcome == 1):
                    report.mismatches.append(
                        {
                            "market_id": res.scenario_id,
                            "kalshi_result": kr,
                            "edgecast_outcome": res.settlement.outcome,
                        }
                    )
                rows.append(
                    VerificationRow(
                        market_id=res.scenario_id,
                        model=model,
                        series=series,
                        city=st.city,
                        event_date=d,
                        comparator=res.market.comparator,
                        threshold=res.market.threshold,
                        threshold_low=res.market.threshold_low,
                        threshold_high=res.market.threshold_high,
                        question=res.market.question,
                        market_prob=res.market_prob,
                        model_prob=res.model_prob,
                        model_prob_raw=res.model_prob_raw,
                        n_members=res.n_members,
                        observed_high=observed[d],
                        outcome=res.settlement.outcome,
                        kalshi_result=kr,
                        brier_market=res.settlement.brier_market,
                        brier_model=res.settlement.brier_model,
                        observed_source=f"ACIS {st.acis_sid}",
                        model_source=f"open-meteo {model} (short-lead)",
                        verified_at=now,
                    )
                )
            store.upsert(rows)
            report.n_markets_verified += len(rows)
    return report
