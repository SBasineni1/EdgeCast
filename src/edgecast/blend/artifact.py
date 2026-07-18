"""Persistent storage for trained blend-model artifacts."""

import json
from dataclasses import dataclass
from pathlib import Path

from edgecast import db

GBM_KIND = "gbm_high_temp"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS model_artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  lead TEXT NOT NULL,
  created_at TEXT NOT NULL,
  train_end_date TEXT NOT NULL,
  n_rows INTEGER NOT NULL,
  feature_names TEXT NOT NULL,
  city_order TEXT NOT NULL,
  params TEXT NOT NULL,
  model_json TEXT NOT NULL,
  metrics TEXT NOT NULL,
  promoted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_model_artifacts_promoted
  ON model_artifacts(kind, lead, promoted, id);
"""


@dataclass(frozen=True)
class Artifact:
    kind: str
    lead: str
    created_at: str
    train_end_date: str
    n_rows: int
    feature_names: tuple[str, ...]
    city_order: tuple[str, ...]
    params: dict
    model_json: dict
    metrics: dict
    promoted: int = 0
    id: int | None = None


_COLS = (
    "id",
    "kind",
    "lead",
    "created_at",
    "train_end_date",
    "n_rows",
    "feature_names",
    "city_order",
    "params",
    "model_json",
    "metrics",
    "promoted",
)


def _decode(row: tuple) -> Artifact:
    values = dict(zip(_COLS, row))
    values["feature_names"] = tuple(json.loads(values["feature_names"]))
    values["city_order"] = tuple(json.loads(values["city_order"]))
    for name in ("params", "model_json", "metrics"):
        values[name] = json.loads(values[name])
    return Artifact(**values)


class ArtifactStore:
    def __init__(self, path: str | Path) -> None:
        self._conn = db.connect(path)
        db.apply_schema(self._conn, _SCHEMA)

    def insert(self, artifact: Artifact) -> int:
        cur = self._conn.execute(
            "INSERT INTO model_artifacts "
            "(kind, lead, created_at, train_end_date, n_rows, feature_names, "
            "city_order, params, model_json, metrics, promoted) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                artifact.kind,
                artifact.lead,
                artifact.created_at,
                artifact.train_end_date,
                artifact.n_rows,
                json.dumps(artifact.feature_names),
                json.dumps(artifact.city_order),
                json.dumps(artifact.params),
                json.dumps(artifact.model_json),
                json.dumps(artifact.metrics),
                artifact.promoted,
            ),
        )
        self._conn.commit()
        return int(cur.lastrowid)

    def latest_promoted(self, kind: str, lead: str) -> Artifact | None:
        cur = self._conn.execute(
            f"SELECT {', '.join(_COLS)} FROM model_artifacts "
            "WHERE kind = ? AND lead = ? AND promoted = 1 "
            "ORDER BY id DESC LIMIT 1",
            (kind, lead),
        )
        row = cur.fetchone()
        return _decode(row) if row is not None else None
