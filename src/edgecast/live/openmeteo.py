"""Open-Meteo ensemble client: GEFS members -> per-member daily highs."""

from datetime import date, datetime, timezone

import httpx

from edgecast.types import EnsembleForecast

BASE_URL = "https://ensemble-api.open-meteo.com/v1/ensemble"
TIMEOUT = 10.0


def daily_highs(payload: dict, event_date: str) -> tuple[float, ...]:
    """Reduce each ensemble member's hourly series to its max on the local date."""
    hourly = payload["hourly"]
    idx = [i for i, t in enumerate(hourly["time"]) if t.startswith(event_date)]
    if not idx:
        raise ValueError(f"no hourly data for {event_date}")
    highs: list[float] = []
    for key, series in hourly.items():
        if not key.startswith("temperature_2m"):
            continue
        values = [series[i] for i in idx if series[i] is not None]
        if values:
            highs.append(float(max(values)))
    return tuple(highs)


def past_days_for(dates: list[str], today: date | None = None) -> int:
    today = today or date.today()
    earliest = min(date.fromisoformat(d) for d in dates)
    return max(1, min(92, (today - earliest).days + 1))


def reduce_past_highs(payload: dict, dates: list[str]) -> dict[str, tuple[float, ...]]:
    out: dict[str, tuple[float, ...]] = {}
    for d in dates:
        try:
            highs = daily_highs(payload, d)
        except ValueError:
            continue
        if highs:  # all-null member values reduce to (), which is no data
            out[d] = highs
    return out


def fetch_ensemble_high(
    lat: float, lon: float, event_date: str, tz: str, client: httpx.Client,
    model: str = "gfs_seamless", forecast_days: int = 3
) -> EnsembleForecast:
    resp = client.get(
        BASE_URL,
        params={
            "latitude": lat,
            "longitude": lon,
            "hourly": "temperature_2m",
            "models": model,
            "temperature_unit": "fahrenheit",
            "timezone": tz,
            "forecast_days": forecast_days,
        },
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    members = daily_highs(resp.json(), event_date)
    return EnsembleForecast(
        source=f"open-meteo {model}",
        issued_at=datetime.now(timezone.utc).isoformat(),
        members=members,
    )


def fetch_ensemble_past_highs(
    lat: float, lon: float, dates: list[str], tz: str,
    client: httpx.Client, model: str = "gfs_seamless",
) -> dict[str, tuple[float, ...]]:
    resp = client.get(
        BASE_URL,
        params={
            "latitude": lat, "longitude": lon,
            "hourly": "temperature_2m", "models": model,
            "temperature_unit": "fahrenheit", "timezone": tz,
            "past_days": past_days_for(dates), "forecast_days": 1,
        },
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return reduce_past_highs(resp.json(), dates)
