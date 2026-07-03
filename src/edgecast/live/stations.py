"""Registry of Kalshi daily-high-temperature series and their stations."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Station:
    series: str
    city: str      # short code shown on cards ("NYC")
    name: str      # display name ("New York")
    station: str   # observing station ("Central Park")
    lat: float
    lon: float
    tz: str        # IANA timezone
    acis_sid: str


_ALL = [
    Station("KXHIGHNY", "NYC", "New York", "Central Park", 40.783, -73.967, "America/New_York", "KNYC"),
    Station("KXHIGHCHI", "CHI", "Chicago", "Midway", 41.786, -87.752, "America/Chicago", "KMDW"),
    Station("KXHIGHMIA", "MIA", "Miami", "Miami Intl", 25.788, -80.317, "America/New_York", "KMIA"),
    # Kalshi settles Austin on Bergstrom, not Camp Mabry: 2026-06-29..07-02
    # settlements all match KAUS observations; KATT disagrees on 07-01/07-02.
    Station("KXHIGHAUS", "AUS", "Austin", "Bergstrom Intl", 30.195, -97.670, "America/Chicago", "KAUS"),
    Station("KXHIGHDEN", "DEN", "Denver", "Denver Intl", 39.847, -104.656, "America/Denver", "KDEN"),
    Station("KXHIGHPHIL", "PHL", "Philadelphia", "Philadelphia Intl", 39.868, -75.231, "America/New_York", "KPHL"),
    Station("KXHIGHLAX", "LAX", "Los Angeles", "LAX", 33.938, -118.389, "America/Los_Angeles", "KLAX"),
]

STATIONS: dict[str, Station] = {s.series: s for s in _ALL}
