"""Database connections: local SQLite by default, Turso (libsql) when configured.

Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN) to point every store at a hosted
Turso database — used in serverless deployments where the local filesystem is
ephemeral. Without them, behavior is unchanged: a SQLite file at the given path.
"""

import os
import sqlite3
from pathlib import Path


def connect(path: str | Path):
    url = os.environ.get("TURSO_DATABASE_URL")
    if url:
        import libsql  # lazy: only needed when Turso is configured

        return libsql.connect(url, auth_token=os.environ.get("TURSO_AUTH_TOKEN", ""))
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(p, check_same_thread=False)


def apply_schema(conn, schema: str) -> None:
    """Run simple `;`-separated DDL (libsql has no executescript)."""
    for stmt in schema.split(";"):
        if stmt.strip():
            conn.execute(stmt)
    conn.commit()
