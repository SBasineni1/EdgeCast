"""Open-Meteo deterministic clients: previous-runs archive + live multi-model highs."""

from dataclasses import dataclass

import httpx

PREVIOUS_RUNS_URL = "https://previous-runs-api.open-meteo.com/v1/forecast"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
TIMEOUT = 10.0

SOURCE_MODELS: tuple[str, ...] = ("ncep_nbm_conus", "gfs_hrrr", "gfs_global")
# Multi-year history adds the global models; the live consensus is unchanged.
HISTORY_MODELS: tuple[str, ...] = (*SOURCE_MODELS, "ecmwf_ifs025", "icon_global", "gem_global")
HISTORY_LEADS: tuple[int, ...] = (1, 2)


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


@dataclass(frozen=True)
class LeadHigh:
    high: float
    n_hours: int      # non-null hourly values behind the max
    last_valid: str   # latest non-null local hour that day, "YYYY-MM-DDTHH:MM"


def fetch_previous_highs(
    lat: float, lon: float, start_date: str, end_date: str, tz: str,
    client: httpx.Client, models: tuple[str, ...] = HISTORY_MODELS,
    leads: tuple[int, ...] = HISTORY_LEADS,
) -> dict[tuple[str, int], dict[str, LeadHigh]]:
    """Daily highs per (model, lead_days) from the previous-runs archive.

    `temperature_2m_previous_dayN` is each hour's value as predicted N*24 hours
    before that hour, so every contributing run was initialised no later than
    last_valid - N*24h.
    """
    variables = [f"temperature_2m_previous_day{n}" for n in leads]
    resp = client.get(
        PREVIOUS_RUNS_URL,
        params={
            "latitude": lat, "longitude": lon,
            "hourly": ",".join(variables),
            "models": ",".join(models),
            "temperature_unit": "fahrenheit", "timezone": tz,
            "start_date": start_date, "end_date": end_date,
        },
        timeout=60.0,
    )
    resp.raise_for_status()
    hourly = resp.json()["hourly"]
    times = hourly["time"]
    out: dict[tuple[str, int], dict[str, LeadHigh]] = {}
    for n, var in zip(leads, variables):
        for m in models:
            key = f"{var}_{m}"
            if key not in hourly and len(models) == 1:
                key = var
            by_date: dict[str, LeadHigh] = {}
            for t, v in zip(times, hourly.get(key, [])):
                if v is None:
                    continue
                d = t[:10]
                prev = by_date.get(d)
                by_date[d] = LeadHigh(
                    high=max(float(v), prev.high) if prev else float(v),
                    n_hours=(prev.n_hours if prev else 0) + 1,
                    last_valid=t,  # times ascend, so the latest seen wins
                )
            out[(m, n)] = by_date
    return out
