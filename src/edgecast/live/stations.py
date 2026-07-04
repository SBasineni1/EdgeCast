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
    # Expansion cities (2026-07-04): settlement stations verified empirically —
    # each sid matches 6/6 settled buckets 2026-06-28..07-03; alternates fail
    # (DC: KIAD/KBWI 3/6; Dallas: KDAL 5/6; Houston: KIAH 1/6 — Hobby, not Intercontinental).
    Station("KXHIGHTSEA", "SEA", "Seattle", "Sea-Tac Intl", 47.444, -122.314, "America/Los_Angeles", "KSEA"),
    Station("KXHIGHTDC", "DC", "Washington DC", "Reagan National", 38.848, -77.034, "America/New_York", "KDCA"),
    Station("KXHIGHTMIN", "MIN", "Minneapolis", "MSP Intl", 44.883, -93.229, "America/Chicago", "KMSP"),
    Station("KXHIGHTOKC", "OKC", "Oklahoma City", "Will Rogers", 35.389, -97.600, "America/Chicago", "KOKC"),
    Station("KXHIGHTSFO", "SFO", "San Francisco", "SFO Intl", 37.620, -122.365, "America/Los_Angeles", "KSFO"),
    Station("KXHIGHTATL", "ATL", "Atlanta", "Hartsfield-Jackson", 33.630, -84.442, "America/New_York", "KATL"),
    Station("KXHIGHTDAL", "DAL", "Dallas", "DFW Intl", 32.898, -97.019, "America/Chicago", "KDFW"),
    Station("KXHIGHTNOLA", "NOLA", "New Orleans", "Armstrong Intl", 29.993, -90.251, "America/Chicago", "KMSY"),
    Station("KXHIGHTLV", "LV", "Las Vegas", "Harry Reid Intl", 36.072, -115.163, "America/Los_Angeles", "KLAS"),
    Station("KXHIGHTPHX", "PHX", "Phoenix", "Sky Harbor", 33.428, -112.004, "America/Phoenix", "KPHX"),
    Station("KXHIGHTBOS", "BOS", "Boston", "Logan Intl", 42.361, -71.010, "America/New_York", "KBOS"),
    Station("KXHIGHTSATX", "SAT", "San Antonio", "San Antonio Intl", 29.533, -98.470, "America/Chicago", "KSAT"),
    Station("KXHIGHTHOU", "HOU", "Houston", "Hobby", 29.646, -95.279, "America/Chicago", "KHOU"),
]

STATIONS: dict[str, Station] = {s.series: s for s in _ALL}
