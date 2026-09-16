from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.models.entities import PrintJob, User, utcnow

HEADERS = {"X-Agent-Token": "test-agent-secret"}
AGENT = {"agent_id": "office-agent"}


def claim(client: TestClient) -> dict:
    response = client.post("/printers/1/claim", json=AGENT, headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


def ack(client: TestClient, job: dict, status: str = "PRINTED", **extra: object):
    return client.patch(
        f"/print-jobs/{job['id']}",
        headers=HEADERS,
        json={
            **AGENT,
            "claim_token": job["claim_token"],
            "status": status,
            **extra,
        },
    )


def test_task_lifecycle_and_dates(client: TestClient, member: User):
    user = {"id": member.id, "name": member.name}
    response = client.post(
        "/tasks",
        json={
            "title": " Primera tarea ",
            "assignee_id": user["id"],
            "deadline": "2026-09-11",
            "priority": "HIGH",
        },
    )
    assert response.status_code == 201
    task = response.json()
    assert task["title"] == "Primera tarea"
    assert task["assignee"]["name"] == member.name
    assert task["url"] == f"https://board.example.test/t/{task['id']}"
    assert task["completed_at"] is None
    endpoint = f"/tasks/{task['id']}"
    finished = client.patch(endpoint + "/status", json={"status": "DONE"}).json()
    assert finished["completed_at"]
    same = client.patch(endpoint, json={"title": "Final", "status": "DONE"}).json()
    assert same["completed_at"] == finished["completed_at"]
    reopened = client.patch(endpoint + "/status", json={"status": "WIP"}).json()
    assert reopened["completed_at"] is None
    assert reopened["updated_at"] >= task["updated_at"]
    cleared = client.patch(endpoint, json={"deadline": None, "assignee_id": None}).json()
    assert cleared["deadline"] is None and cleared["assignee"] is None
    assert client.get(endpoint).json()["title"] == "Final"
    assert client.delete(endpoint).status_code == 204
    assert client.get(endpoint).status_code == 404


@pytest.mark.parametrize(
    "payload",
    [
        {"title": " "},
        {"title": "x", "priority": "INVALID"},
        {"title": "x", "status": "REVIEW"},
        {"title": "x", "deadline": "2026-02-31"},
        {"title": "x", "unexpected": True},
    ],
)
def test_invalid_create(client: TestClient, payload: dict):
    assert client.post("/tasks", json=payload).status_code == 422
    assert client.get("/tasks").json() == []


@pytest.mark.parametrize("field", ["title", "description", "status", "priority"])
def test_required_fields_cannot_be_null(client: TestClient, field: str):
    task = client.post("/tasks", json={"title": "Keep me"}).json()
    assert client.patch(f"/tasks/{task['id']}", json={field: None}).status_code == 422
    assert client.get(f"/tasks/{task['id']}").json()["title"] == "Keep me"


def test_atomic_save_print_and_snapshot(client: TestClient):
    response = client.post(
        "/tasks", json={"title": "Atomic", "print_after_save": True, "printer_id": 999}
    )
    assert response.status_code == 404
    assert client.get("/tasks").json() == []
    task = client.post("/tasks", json={"title": "Ticket original", "print_after_save": True}).json()
    assert len(client.get("/print-jobs").json()) == 1
    client.patch(f"/tasks/{task['id']}", json={"title": "Ticket nuevo"})
    new_job = client.post(f"/tasks/{task['id']}/print").json()
    jobs = client.get("/print-jobs").json()
    assert len(jobs) == 2
    assert jobs[1]["ticket"]["title"] == "Ticket original"
    assert new_job["ticket"]["title"] == "Ticket nuevo"
    client.delete(f"/tasks/{task['id']}")
    assert client.get("/print-jobs").json()[0]["task_id"] is None
    # A physical QR must never resolve to a different task after deletion.
    replacement = client.post("/tasks", json={"title": "Unrelated"}).json()
    assert replacement["id"] != task["id"]


def test_printed_stamp_never_blocks_a_reprint(client: TestClient):
    task = client.post("/tasks", json={"title": "Sello"}).json()
    assert task["printed_at"] is None
    # Impresión desde el navegador: la web sella la tarea sin pasar por la cola.
    local = client.post(f"/tasks/{task['id']}/printed").json()
    assert local["printed_at"] and client.get("/print-jobs").json() == []
    # Reimprimir sigue disponible; el acuse del agente vuelve a sellar con la fecha nueva.
    client.post(f"/tasks/{task['id']}/print")
    assert ack(client, claim(client)).status_code == 200
    queued = client.get(f"/tasks/{task['id']}").json()
    assert queued["printed_at"] > local["printed_at"]
    assert client.post(f"/tasks/{task['id']}/printed").status_code == 200
    assert client.post("/tasks/999/printed").status_code == 404


def test_claim_auth_ownership_idempotence(client: TestClient):
    task = client.post("/tasks", json={"title": "Print", "print_after_save": True}).json()
    assert client.post("/printers/1/claim", json=AGENT).status_code == 401
    assert (
        client.post("/printers/1/claim", json={"agent_id": "intruder"}, headers=HEADERS).status_code
        == 403
    )
    job = claim(client)
    assert job["status"] == "PRINTING" and job["attempts"] == 1
    assert job["ticket"]["id"] == task["id"]
    assert claim(client) is None
    assert ack(client, {**job, "claim_token": "invalid"}).status_code == 409
    first = ack(client, job)
    assert first.status_code == 200 and first.json()["printed_at"]
    second = ack(client, job)
    assert second.status_code == 200
    assert second.json()["printed_at"] == first.json()["printed_at"]
    assert ack(client, job, "FAILED").status_code == 409
    assert "claim_token" not in client.get("/print-jobs").json()[0]
    assert client.get("/printers").json()[0]["last_seen"]


def test_retry_is_bounded(client: TestClient, database: sessionmaker[Session]):
    client.post("/tasks", json={"title": "Retry", "print_after_save": True})
    for attempt in range(1, 4):
        job = claim(client)
        assert job["attempts"] == attempt
        failed = ack(client, job, "FAILED", error="Printer unplugged").json()
        assert failed["error"] == "Printer unplugged"
        assert claim(client) is None
        if attempt < 3:
            assert failed["next_attempt_at"]
            with database() as db:
                db.get(PrintJob, job["id"]).next_attempt_at = utcnow() - timedelta(seconds=1)
                db.commit()
        else:
            assert failed["next_attempt_at"] is None
    assert claim(client) is None


def test_unknown_outcome_not_automatically_reprinted(
    client: TestClient, database: sessionmaker[Session]
):
    client.post("/tasks", json={"title": "Lease", "print_after_save": True})
    job = claim(client)
    with database() as db:
        db.get(PrintJob, job["id"]).started_at = utcnow() - timedelta(minutes=10)
        db.commit()
    assert claim(client) is None
    failed = client.get("/print-jobs").json()[0]
    assert failed["status"] == "FAILED" and failed["next_attempt_at"] is None
    assert ack(client, job).status_code == 409


def test_concurrent_claims_only_one_owner(client: TestClient, database: sessionmaker[Session]):
    client.post("/tasks", json={"title": "Single ticket", "print_after_save": True})
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: claim(client), range(4)))
    assert sum(job is not None for job in results) == 1
    with database() as db:
        assert db.scalar(select(PrintJob)).attempts == 1


def test_wip_limit_is_advisory_and_done_on_create(client: TestClient):
    limit = client.get("/settings").json()["wip_limit"]
    for number in range(limit + 1):
        assert (
            client.post("/tasks", json={"title": f"Task {number}", "status": "WIP"}).status_code
            == 201
        )
    assert len(client.get("/tasks").json()) == limit + 1
    task = client.post("/tasks", json={"title": "Already done", "status": "DONE"}).json()
    assert task["completed_at"]


def test_invalid_assignee_does_not_create(client: TestClient):
    assert client.post("/tasks", json={"title": "Oops", "assignee_id": 999}).status_code == 404
    assert client.get("/tasks").json() == []
