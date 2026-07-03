"""Market-condition evaluation shared by the forecast and settlement stages."""

from edgecast.types import MarketQuote

COMPARATORS: tuple[str, ...] = (">=", ">", "<=", "<", "between")


def satisfies(value: float, comparator: str, threshold: float) -> bool:
    """Return True when `value <comparator> threshold` holds (binary only)."""
    if comparator == ">=":
        return value >= threshold
    if comparator == ">":
        return value > threshold
    if comparator == "<=":
        return value <= threshold
    if comparator == "<":
        return value < threshold
    if comparator == "between":
        raise ValueError("between requires bounds; use satisfies_market")
    raise ValueError(f"unknown comparator: {comparator!r}")


def satisfies_market(value: float, market: MarketQuote) -> bool:
    """Evaluate a market's condition against a value.

    Validation guarantees the threshold shape matches the comparator, so the
    assertions here guard programming errors, not user input.
    """
    if market.comparator == "between":
        assert market.threshold_low is not None and market.threshold_high is not None
        return market.threshold_low <= value <= market.threshold_high
    assert market.threshold is not None
    return satisfies(value, market.comparator, market.threshold)
