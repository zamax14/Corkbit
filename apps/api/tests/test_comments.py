from fastapi.testclient import TestClient


def test_comments_build_a_timeline_without_touching_the_task(client: TestClient) -> None:
    task = client.post("/tasks", json={"title": "Entregar capítulo"}).json()
    assert task["comment_count"] == 0
    assert task["last_comment"] is None and task["last_comment_at"] is None

    first = client.post(f"/tasks/{task['id']}/comments", json={"body": " Hablé con el asesor "})
    assert first.status_code == 201
    assert first.json()["body"] == "Hablé con el asesor"
    second = client.post(
        f"/tasks/{task['id']}/comments", json={"body": "Falta corregir el template"}
    ).json()

    # El timeline va de lo más reciente a lo más antiguo: lo último que pasó se lee primero.
    listed = client.get(f"/tasks/{task['id']}/comments").json()
    assert [comment["body"] for comment in listed] == [
        "Falta corregir el template",
        "Hablé con el asesor",
    ]

    stamped = client.get(f"/tasks/{task['id']}").json()
    assert stamped["comment_count"] == 2
    assert stamped["last_comment"] == "Falta corregir el template"
    assert stamped["last_comment_at"] == second["created_at"]
    # Comentar no mueve la tarea: 'se agregan comentarios aunque la tarea no avance'.
    assert stamped["updated_at"] == task["updated_at"]
    assert stamped["status"] == task["status"]

    assert client.delete(f"/comments/{second['id']}").status_code == 204
    remaining = client.get(f"/tasks/{task['id']}").json()
    assert remaining["comment_count"] == 1
    assert remaining["last_comment"] == "Hablé con el asesor"


def test_comments_validate_input_and_die_with_their_task(client: TestClient) -> None:
    task = client.post("/tasks", json={"title": "Reservar escenario"}).json()
    for body in ("", "   ", "x" * 2001):
        assert client.post(f"/tasks/{task['id']}/comments", json={"body": body}).status_code == 422
    assert client.post("/tasks/999/comments", json={"body": "Huérfano"}).status_code == 404
    assert client.get("/tasks/999/comments").status_code == 404
    assert client.delete("/comments/999").status_code == 404

    client.post(f"/tasks/{task['id']}/comments", json={"body": "Se va con la tarea"})
    assert client.delete(f"/tasks/{task['id']}").status_code == 204
    assert client.get(f"/tasks/{task['id']}/comments").status_code == 404
