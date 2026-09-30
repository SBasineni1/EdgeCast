"""Kalshi public market-data client (no auth): markets -> MarketQuote."""

import re
from datetime import date

import httpx

from edgecast.types import MarketQuote

BASE_URL = "https://api.elections.kalshi.com/trade-api/v2"
TIMEOUT = 5.0

_MONTHS = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}
_MONTH_ABBR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
               "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
_DATE_RE = re.compile(r"-(\d{2})([A-Z]{3})(\d{2})$")

# Kalshi strikes are strict: greater 100 settles yes only above 100
# ("101° or above"); less 93 only below 93 ("92° or below").
_STRIKE_COMPARATORS = {
    "greater": ">",
    "greater_or_equal": ">=",
    "less": "<",
    "less_or_equal": "<=",
}


def event_ticker_for(series: str, d: date) -> str:
    return f"{series}-{d.year % 100:02d}{_MONTH_ABBR[d.month - 1]}{d.day:02d}"


def event_date_from_ticker(event_ticker: str) -> str:
    m = _DATE_RE.search(event_ticker)
    if m is None:
        raise ValueError(f"cannot parse event date from ticker: {event_ticker!r}")
    yy, mon, dd = m.groups()
    try:
        month = _MONTHS[mon]
    except KeyError as exc:
        raise ValueError(f"cannot parse event date from ticker: {event_ticker!r}") from exc
    return date(2000 + int(yy), month, int(dd)).isoformat()


def fetch_markets(series_ticker: str, client: httpx.Client) -> list[dict]:
    markets: list[dict] = []
    cursor: str | None = None
    while True:
        params: dict = {"series_ticker": series_ticker, "status": "open", "limit": 100}
        if cursor:
            params["cursor"] = cursor
        resp = client.get(f"{BASE_URL}/markets", params=params, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        markets.extend(data.get("markets", []))
        cursor = data.get("cursor")
        if not cursor:
            return markets


def fetch_event_markets(event_ticker: str, client: httpx.Client) -> list[dict]:
    markets: list[dict] = []
    cursor: str | None = None
    while True:
        params: dict = {"event_ticker": event_ticker, "limit": 100}
        if cursor:
            params["cursor"] = cursor
        resp = client.get(f"{BASE_URL}/markets", params=params, timeout=TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        markets.extend(data.get("markets", []))
        cursor = data.get("cursor")
        if not cursor:
            return markets


def _float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _cent_price(market: dict) -> float | None:
    last = _float(market.get("last_price")) or 0
    if 0 < last < 100:
        return last / 100
    bid, ask = _float(market.get("yes_bid")) or 0, _float(market.get("yes_ask")) or 0
    if 0 < bid < 100 and 0 < ask < 100:
        return (bid + ask) / 200
    return None


def _dollar_price(market: dict) -> float | None:
    last = _float(market.get("last_price_dollars")) or 0
    if 0.0 < last < 1.0:
        return last
    bid = _float(market.get("yes_bid_dollars")) or 0
    ask = _float(market.get("yes_ask_dollars")) or 0
    if 0.0 < bid < 1.0 and 0.0 < ask < 1.0:
        return (bid + ask) / 2
    return None


def _price(market: dict) -> float | None:
    if any(key in market for key in ("last_price", "yes_bid", "yes_ask")):
        return _cent_price(market)
    return _dollar_price(market)


def to_result(market: dict) -> str | None:
    result = market.get("result")
    return result if result in ("yes", "no") else None


def to_quote(market: dict, city: str) -> MarketQuote | None:
    strike_type = market.get("strike_type")
    price = _price(market)
    if price is None or not 0.0 < price < 1.0:
        return None
    try:
        event_date = event_date_from_ticker(market["event_ticker"])
    except (KeyError, ValueError):
        return None
    common = dict(
        market_id=market.get("ticker", ""),
        question=market.get("title") or market.get("ticker", ""),
        location=city,
        variable="high_temp_f",
        event_date=event_date,
        yes_price=price,
    )
    if strike_type == "between":
        lo, hi = market.get("floor_strike"), market.get("cap_strike")
        if lo is None or hi is None or lo > hi:
            return None
        return MarketQuote(comparator="between", threshold_low=float(lo), threshold_high=float(hi), **common)
    comparator = _STRIKE_COMPARATORS.get(strike_type or "")
    if comparator is None:
        return None
    strike = market.get("floor_strike") if comparator in (">", ">=") else market.get("cap_strike")
    if strike is None:
        return None
    return MarketQuote(comparator=comparator, threshold=float(strike), **common)


def fetch_series_markets(
    series_ticker: str, client: httpx.Client, historical: bool = False,
    status: str | None = None,
) -> list[dict]:
    """Every market in a series, paged. The series listing also returns markets
    from before the KX rename (e.g. HIGHNY-24FEB01 under KXHIGHNY).

    historical=True reads markets Kalshi archived (settled before its cutoff).
    """
    path = "/historical/markets" if historical else "/markets"
    markets: list[dict] = []
    cursor: str | None = None
    while True:
        params: dict = {"series_ticker": series_ticker, "limit": 1000}
        if status:
            params["status"] = status
        if cursor:
            params["cursor"] = cursor
        resp = client.get(f"{BASE_URL}{path}", params=params, timeout=30.0)
        resp.raise_for_status()
        data = resp.json()
        page = data.get("markets", [])
        markets.extend(page)
        cursor = data.get("cursor")
        if not cursor or not page:
            return markets


def fetch_hourly_candles(
    series_ticker: str, ticker: str, start_ts: int, end_ts: int,
    client: httpx.Client, historical: bool = False,
) -> list[dict]:
    """Hourly candlesticks ending in [start_ts, end_ts] (Unix seconds)."""
    if historical:
        url = f"{BASE_URL}/historical/markets/{ticker}/candlesticks"
    else:
        url = f"{BASE_URL}/series/{series_ticker}/markets/{ticker}/candlesticks"
    resp = client.get(
        url,
        params={"start_ts": start_ts, "end_ts": end_ts, "period_interval": 60},
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json().get("candlesticks", [])


def _candle_dollars(side: dict | None, name: str) -> float | None:
    # Historical candles use "close"; live candles use "close_dollars".
    if not side:
        return None
    return _float(side.get(name, side.get(f"{name}_dollars")))


def quote_at(candles: list[dict], at_ts: int) -> dict | None:
    """The standing quote at `at_ts`: close of the last candle ending at or before it.

    Kalshi omits hours in which nothing changed (each returned candle opens at
    the previous one's close), so the last earlier close is still the quote.
    None when no candle ends by `at_ts`.
    """
    prior = [c for c in candles if c.get("end_period_ts", at_ts + 1) <= at_ts]
    if not prior:
        return None
    last = max(prior, key=lambda c: c["end_period_ts"])
    volume = sum(_float(c.get("volume", c.get("volume_fp"))) or 0.0 for c in prior)
    return {
        "as_of_ts": last["end_period_ts"],
        "yes_bid": _candle_dollars(last.get("yes_bid"), "close"),
        "yes_ask": _candle_dollars(last.get("yes_ask"), "close"),
        "last_price": _candle_dollars(last.get("price"), "close"),
        "volume": volume,
    }


def fetch_historical_cutoff(client: httpx.Client) -> str:
    """ISO time before which settled markets live only under /historical."""
    resp = client.get(f"{BASE_URL}/historical/cutoff", timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.json()["market_settled_ts"]
