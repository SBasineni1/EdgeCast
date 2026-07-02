"""Market stage: quote -> market-implied probability."""

from edgecast.types import MarketQuote


def market_implied_probability(quote: MarketQuote) -> float:
    """Read the YES price directly as a probability.

    De-vigging (bid/ask, fees) is deliberately deferred; when real market
    data arrives, that adjustment lands here.
    """
    return quote.yes_price
