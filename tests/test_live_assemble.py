import pytest

from edgecast.live.cache import TTLCache


def test_ttl_cache_hit_expiry_and_stale():
    t = {"now": 1000.0}
    c = TTLCache(clock=lambda: t["now"])
    assert c.get("k", 30) is None
    c.put("k", "v")
    assert c.get("k", 30) == "v"
    t["now"] += 31
    assert c.get("k", 30) is None          # expired for fresh reads
    assert c.get_stale("k") == ("v", 31)   # still available as stale
    assert c.get_stale("missing") is None
