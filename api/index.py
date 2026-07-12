"""Vercel entrypoint: serves the EdgeCast API as a serverless function.

The static frontend is built separately by Vercel from web/; this function
answers everything under /api/*. Storage points at Turso via
TURSO_DATABASE_URL / TURSO_AUTH_TOKEN (falls back to an ephemeral /tmp SQLite
file if they're unset, so a misconfigured deploy still responds).
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from edgecast.server import create_app  # noqa: E402

app = create_app(
    ROOT / "fixtures",
    web_dist=ROOT / "_no_static",  # frontend is served by Vercel, not this function
    db_path=os.environ.get("EDGECAST_DB", "/tmp/edgecast.db"),
)
