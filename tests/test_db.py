import sqlite3

from edgecast import db


def test_connect_defaults_to_local_sqlite(tmp_path, monkeypatch):
    monkeypatch.delenv("TURSO_DATABASE_URL", raising=False)
    conn = db.connect(tmp_path / "nested" / "x.db")
    assert isinstance(conn, sqlite3.Connection)
    assert (tmp_path / "nested").is_dir()


def test_apply_schema_splits_statements(tmp_path, monkeypatch):
    monkeypatch.delenv("TURSO_DATABASE_URL", raising=False)
    conn = db.connect(tmp_path / "x.db")
    db.apply_schema(
        conn,
        """
        CREATE TABLE a (x INTEGER);
        CREATE INDEX idx_a ON a(x);
        """,
    )
    conn.execute("INSERT INTO a VALUES (1)")
    assert conn.execute("SELECT x FROM a").fetchall() == [(1,)]
