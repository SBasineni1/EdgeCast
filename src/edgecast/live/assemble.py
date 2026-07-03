"""Assemble live Kalshi markets + Open-Meteo ensembles into pipeline scenarios."""

from dataclasses import dataclass, field

import httpx

from edgecast.live.cache import TTLCache
from edgecast.live.kalshi import fetch_markets, to_quote
from edgecast.live.openmeteo import fetch_ensemble_high
from edgecast.live.stations import STATIONS
from edgecast.types import Scenario

QUOTES_TTL = 30.0
ENSEMBLES_TTL = 1800.0
QUOTES_CACHE = TTLCache()
ENSEMBLES_CACHE = TTLCache()


@dataclass
class LiveResult:
    scenarios: list[Scenario]
    cities_ok: list[str] = field(default_factory=list)
    cities_failed: list[dict] = field(default_factory=list)
    quotes_age_seconds: int = 0
    ensembles_age_seconds: int = 0


def _cached(cache: TTLCache, key: str, ttl: float, fetch):
    """Fresh value if cached, else fetch (caching it); on fetch failure fall back to stale."""
    value = cache.get(key, ttl)
    if value is not None:
        _, age = cache.get_stale(key)  # type: ignore[misc]
        return value, age, None
    try:
        value = fetch()
    except Exception as e:  # noqa: BLE001 - any upstream failure degrades to stale
        stale = cache.get_stale(key)
        if stale is not None:
            return stale[0], stale[1], None
        return None, 0, f"{type(e).__name__}: {e}"
    cache.put(key, value)
    return value, 0, None


def build_live_scenarios(
    kalshi_client: httpx.Client, meteo_client: httpx.Client
) -> LiveResult:
    result = LiveResult(scenarios=[])
    max_q_age = 0
    max_e_age = 0
    for series, st in STATIONS.items():
        markets, q_age, q_err = _cached(
            QUOTES_CACHE, series, QUOTES_TTL,
            lambda s=series: fetch_markets(s, kalshi_client),
        )
        if q_err is not None:
            result.cities_failed.append({"city": st.city, "reason": f"kalshi: {q_err}"})
            continue
        quotes = [q for m in markets if (q := to_quote(m, st.city)) is not None]
        if not quotes:
            result.cities_failed.append({"city": st.city, "reason": "kalshi: no usable open markets"})
            continue
        event_date = quotes[0].event_date
        forecast, e_age, e_err = _cached(
            ENSEMBLES_CACHE, f"{series}:{event_date}", ENSEMBLES_TTL,
            lambda st=st, d=event_date: fetch_ensemble_high(
                st.lat, st.lon, d, st.tz, meteo_client
            ),
        )
        if e_err is not None:
            result.cities_failed.append({"city": st.city, "reason": f"open-meteo: {e_err}"})
            continue
        for q in quotes:
            if q.event_date != event_date:
                continue  # one event date per refresh keeps one ensemble per city
            result.scenarios.append(
                Scenario(scenario_id=q.market_id, market=q, forecast=forecast, observation=None)
            )
        result.cities_ok.append(st.city)
        max_q_age = max(max_q_age, q_age)
        max_e_age = max(max_e_age, e_age)
    result.quotes_age_seconds = max_q_age
    result.ensembles_age_seconds = max_e_age
    return result
