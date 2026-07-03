"""ACIS client: official NWS/NOAA station daily maxima (settlement truth)."""

import httpx

BASE_URL = "https://data.rcc-acis.org/StnData"
TIMEOUT = 10.0


class AcisUnavailable(Exception):
    """ACIS could not provide observations."""


def parse_stndata(payload: dict) -> dict[str, float]:
    if "error" in payload:
        raise AcisUnavailable(str(payload["error"]))
    highs: dict[str, float] = {}
    for entry in payload.get("data", []):
        date_str, value = entry[0], entry[1]
        try:
            highs[date_str] = float(value)
        except (TypeError, ValueError):
            continue  # "M" (missing) and other non-numeric markers are skipped
    return highs


def fetch_observed_highs(
    acis_sid: str, start_date: str, end_date: str, client: httpx.Client
) -> dict[str, float]:
    try:
        resp = client.post(
            BASE_URL,
            json={
                "sid": acis_sid,
                "sdate": start_date,
                "edate": end_date,
                "elems": [{"name": "maxt"}],
            },
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        return parse_stndata(resp.json())
    except httpx.HTTPError as e:
        raise AcisUnavailable(f"{type(e).__name__}: {e}") from e
