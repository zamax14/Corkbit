from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.config import get_settings
from app.models.entities import User


def test_boards_keep_tasks_separate_and_validate_input(client: TestClient, member: User) -> None:
    assert client.get("/boards").json() == [{"id": 1, "name": "Mi tablero"}]
    original = client.post("/tasks", json={"title": "Original"}).json()
    response = client.post("/boards", json={"name": " Lanzamiento "})
    assert response.status_code == 201
    board = response.json()
    assert board["id"] != 1 and board["name"] == "Lanzamiento"

    task = client.post(
        "/tasks",
        json={
            "title": "Preparar lanzamiento",
            "board_id": board["id"],
            "assignee_id": member.id,
        },
    ).json()
    assert task["assignee"]["name"] == "Mariana"
    assert client.get("/tasks?board_id=1").json() == [original]
    assert client.get(f"/tasks?board_id={board['id']}").json() == [task]
    assert client.get(f"/tasks/{task['id']}").json()["board_id"] == board["id"]
    assert client.patch(f"/tasks/{task['id']}", json={"board_id": 1}).status_code == 422
    assert client.post("/tasks", json={"title": "Invalid", "board_id": 999}).status_code == 404
    assert client.get("/tasks?board_id=999").status_code == 404
    assert client.get("/tasks?board_id=0").status_code == 422
    for name in (" ", "x" * 101):
        assert client.post("/boards", json={"name": name}).status_code == 422
    # Los miembros ya no se crean por la API: solo existen los que tienen cuenta en Keycloak.
    assert client.post("/users", json={"name": "Fantasma"}).status_code == 405
    assert len(client.get("/tasks").json()) == 2


def test_board_migration_preserves_tasks_print_jobs_and_deleted_qr_ids(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    url = f"sqlite:///{tmp_path / 'upgrade.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    config = Config("alembic.ini")
    engine = create_engine(url)
    try:
        command.upgrade(config, "fb80f0df22fc")
        with engine.begin() as db:
            db.execute(text("INSERT INTO users (id, name, active) VALUES (1, 'Alex', 1)"))
            db.execute(
                text(
                    "INSERT INTO printers (id, name, location, agent_id, active) "
                    "VALUES (1, 'Office', 'Office', 'office-agent', 1)"
                )
            )
            for identifier in (1, 42):
                db.execute(
                    text(
                        "INSERT INTO tasks (id, title, description, assignee_id, priority, "
                        "status, created_at, updated_at) VALUES (:id, 'Keep', '', 1, "
                        "'MEDIUM', 'BACKLOG', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                    ),
                    {"id": identifier},
                )
            db.execute(text("DELETE FROM tasks WHERE id = 42"))
            db.execute(
                text(
                    "INSERT INTO print_jobs (id, task_id, printer_id, status, ticket, "
                    "created_at, attempts) VALUES (1, 1, 1, 'PENDING', '{}', "
                    "CURRENT_TIMESTAMP, 0)"
                )
            )
        command.upgrade(config, "head")
        command.check(config)
        with engine.begin() as db:
            assert db.execute(text("SELECT id, board_id, assignee_id FROM tasks")).all() == [
                (1, 1, 1)
            ]
            assert db.scalar(text("SELECT task_id FROM print_jobs")) == 1
            assert db.execute(text("PRAGMA foreign_key_check")).all() == []
            db.execute(
                text(
                    "INSERT INTO tasks (title, description, priority, status, created_at, "
                    "updated_at) VALUES ('Next', '', 'LOW', 'BACKLOG', "
                    "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            assert db.scalar(text("SELECT max(id) FROM tasks")) == 43
    finally:
        engine.dispose()
        get_settings.cache_clear()
