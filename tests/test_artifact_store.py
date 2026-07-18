from edgecast.blend.artifact import Artifact, ArtifactStore


def artifact(created_at="2026-07-18T00:00:00Z", promoted=1):
    return Artifact(
        kind="lightgbm_residual",
        lead="day_ahead",
        created_at=created_at,
        train_end_date="2026-07-17",
        n_rows=321,
        feature_names=("one", "two"),
        city_order=("AUS", "NYC"),
        params={"num_leaves": 7, "nested": {"enabled": True}},
        model_json={"tree_info": [{"tree_structure": {"leaf_value": 1.25}}]},
        metrics={"mae": 1.2, "folds": [1.1, 1.3]},
        promoted=promoted,
    )


def test_insert_and_latest_promoted_round_trip(tmp_path):
    store = ArtifactStore(tmp_path / "artifacts.db")
    original = artifact()
    artifact_id = store.insert(original)
    assert store.latest_promoted(original.kind, original.lead) == Artifact(
        **{**original.__dict__, "id": artifact_id}
    )


def test_unpromoted_rows_are_not_returned(tmp_path):
    store = ArtifactStore(tmp_path / "artifacts.db")
    store.insert(artifact(promoted=0))
    assert store.latest_promoted("lightgbm_residual", "day_ahead") is None


def test_latest_promoted_wins(tmp_path):
    store = ArtifactStore(tmp_path / "artifacts.db")
    store.insert(artifact(created_at="2026-07-17T00:00:00Z"))
    latest_id = store.insert(artifact(created_at="2026-07-18T00:00:00Z"))
    latest = store.latest_promoted("lightgbm_residual", "day_ahead")
    assert latest is not None
    assert latest.id == latest_id
    assert latest.created_at == "2026-07-18T00:00:00Z"


def test_empty_table_returns_none(tmp_path):
    store = ArtifactStore(tmp_path / "artifacts.db")
    assert store.latest_promoted("lightgbm_residual", "day_ahead") is None
