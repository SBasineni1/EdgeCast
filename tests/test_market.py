from edgecast.market import market_implied_probability
from edgecast.types import MarketQuote


def make_quote(yes_price: float) -> MarketQuote:
    return MarketQuote(
        market_id="MOCK-1",
        question="NYC high temp >= 90F on 2026-07-05?",
        location="NYC",
        variable="high_temp_f",
        comparator=">=",
        threshold=90.0,
        event_date="2026-07-05",
        yes_price=yes_price,
    )


def test_market_probability_is_yes_price():
    assert market_implied_probability(make_quote(0.72)) == 0.72
