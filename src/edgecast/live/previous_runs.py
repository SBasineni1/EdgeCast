"""Open-Meteo deterministic clients: previous-runs archive + live multi-model highs."""

import httpx

PREVIOUS_RUNS_URL = "https://previous-runs-api.open-meteo.com/v1/forecast"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
TIMEOUT = 10.0

SOURCE_MODELS: tuple[str, ...] = ("ncep_nbm_conus", "gfs_hrrr", "gfs_global")


def _daily_highs_by_model(
    payload: dict, models: tuple[str, ...], variable: str
) -> dict[str, dict[str, float]]:
    """Per model, reduce hourly values to the max per local date.

    Multi-model responses key series as f"{variable}_{model}"; single-model
    responses use the bare variable name. All-null hours are skipped, so a
    model outside its archive window reduces to {}.
    """
    hourly = payload["hourly"]
    times = hourly["time"]
    out: dict[str, dict[str, float]] = {}
    for m in models:
        key = f"{variable}_{m}"
        if key not in hourly and len(models) == 1 and variable in hourly:
            key = variable
        by_date: dict[str, float] = {}
        for t, v in zip(times, hourly.get(key, [])):
            if v is not None:
                d = t[:10]
                by_date[d] = max(float(v), by_date.get(d, float(v)))
        out[m] = by_date
    return out


def fetch_previous_day1_highs(
    lat: float, lon: float, start_date: str, end_date: str, tz: str,
    client: httpx.Client, models: tuple[str, ...] = SOURCE_MODELS,
) -> dict[str, dict[str, float]]:
    resp = client.get(
        PREVIOUS_RUNS_URL,
        params={
            "latitude": lat, "longitude": lon,
            "hourly": "temperature_2m_previous_day1",
            "models": ",".join(models),
            "temperature_unit": "fahrenheit", "timezone": tz,
            "start_date": start_date, "end_date": end_date,
        },
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return _daily_highs_by_model(resp.json(), models, "temperature_2m_previous_day1")


def fetch_live_model_highs(
    lat: float, lon: float, event_date: str, tz: str,
    client: httpx.Client, models: tuple[str, ...] = SOURCE_MODELS,
) -> dict[str, float | None]:
    resp = client.get(
        FORECAST_URL,
        params={
            "latitude": lat, "longitude": lon,
            "hourly": "temperature_2m", "models": ",".join(models),
            "temperature_unit": "fahrenheit", "timezone": tz,
            "forecast_days": 2,
        },
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    highs = _daily_highs_by_model(resp.json(), models, "temperature_2m")
    return {m: highs[m].get(event_date) for m in models}
