"""Assemble live Kalshi markets + Open-Meteo ensembles into pipeline scenarios."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

from edgecast.consensus import consensus_point, consensus_sigma, trailing_bias
from edgecast.live.cache import TTLCache
from edgecast.live.kalshi import fetch_markets, to_quote
from edgecast.live.previous_runs import SOURCE_MODELS, fetch_live_model_highs
from edgecast.live.stations import STATIONS
from edgecast.model_store import ModelStore
from edgecast.types import NormalForecast, Scenario

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
    model_highs: dict[str, dict[str, float | None]] = field(default_factory=dict)
    consensus_sigma: dict[str, float] = field(default_factory=dict)


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


def _calibration(
    model_store: ModelStore | None, city: str, models: list[str]
) -> tuple[dict[str, float], float]:
    """Trailing biases per model and consensus sigma; safe defaults without a store."""
    if model_store is None:
        return {m: 0.0 for m in models}, consensus_sigma([])
    try:
        biases = {
            m: trailing_bias(model_store.trailing_errors(m, "day_ahead", city, "9999-12-31"))
            for m in models
        }
        sigma = consensus_sigma(
            model_store.trailing_errors("consensus", "day_ahead", city, "9999-12-31")
        )
        return biases, sigma
    except Exception:  # noqa: BLE001 - calibration must never break the ladder
        return {m: 0.0 for m in models}, consensus_sigma([])


FETCH_WORKERS = 8  # cold caches mean up to 2 HTTP calls per city; fetch cities concurrently


def _fetch_city(series: str, st, kalshi_client: httpx.Client, meteo_client: httpx.Client) -> dict:
    """Network-only phase for one city; safe to run in a worker thread."""
    markets, q_age, q_err = _cached(
        QUOTES_CACHE, series, QUOTES_TTL,
        lambda: fetch_markets(series, kalshi_client),
    )
    if q_err is not None:
        return {"fail": f"kalshi: {q_err}"}
    quotes = [q for m in markets if (q := to_quote(m, st.city)) is not None]
    if not quotes:
        return {"fail": "kalshi: no usable open markets"}
    event_date = quotes[0].event_date
    highs, e_age, e_err = _cached(
        ENSEMBLES_CACHE, f"{series}:{event_date}", ENSEMBLES_TTL,
        lambda: fetch_live_model_highs(st.lat, st.lon, event_date, st.tz, meteo_client),
    )
    if e_err is not None:
        return {"fail": f"open-meteo: {e_err}"}
    return {
        "quotes": quotes, "event_date": event_date, "highs": highs,
        "q_age": q_age, "e_age": e_age,
    }


def build_live_scenarios(
    kalshi_client: httpx.Client, meteo_client: httpx.Client,
    model_store: ModelStore | None = None,
) -> LiveResult:
    result = LiveResult(scenarios=[])
    max_q_age = 0
    max_e_age = 0
    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
        fetched = {
            series: pool.submit(_fetch_city, series, st, kalshi_client, meteo_client)
            for series, st in STATIONS.items()
        }
    # Calibration and scenario assembly stay on this thread (single DB connection).
    for series, st in STATIONS.items():
        city = fetched[series].result()
        if "fail" in city:
            result.cities_failed.append({"city": st.city, "reason": city["fail"]})
            continue
        quotes = city["quotes"]
        event_date = city["event_date"]
        highs = city["highs"]
        q_age = city["q_age"]
        e_age = city["e_age"]
        available = {m: h for m, h in highs.items() if h is not None}
        if not available:
            result.cities_failed.append(
                {"city": st.city, "reason": f"open-meteo: no model forecasts for {event_date}"}
            )
            continue
        biases, sigma = _calibration(model_store, st.city, list(available))
        mu = consensus_point(available, biases)
        forecast = NormalForecast(
            source=f"consensus({','.join(sorted(available))})",
            issued_at=datetime.now(timezone.utc).isoformat(),
            mu=mu, sigma=sigma, n_models=len(available),
        )
        result.model_highs[st.city] = {
            **{m: highs.get(m) for m in SOURCE_MODELS},
            "consensus": round(mu, 1),
        }
        result.consensus_sigma[st.city] = round(sigma, 2)
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
