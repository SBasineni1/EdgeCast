"""Threshold comparison shared by the forecast and settlement stages."""

COMPARATORS: tuple[str, ...] = (">=", ">", "<=", "<")


def satisfies(value: float, comparator: str, threshold: float) -> bool:
    """Return True when `value <comparator> threshold` holds."""
    if comparator == ">=":
        return value >= threshold
    if comparator == ">":
        return value > threshold
    if comparator == "<=":
        return value <= threshold
    if comparator == "<":
        return value < threshold
    raise ValueError(f"unknown comparator: {comparator!r}")
