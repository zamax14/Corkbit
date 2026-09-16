import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.api.auth import provision
from app.config import get_settings
from app.main import app
from app.models.entities import User


def test_board_is_closed_without_a_session(anonymous: TestClient) -> None:
    # Toda ruta del tablero exige sesión: la dependencia va en el router, no ruta por ruta.
    for method, path in [
        ("get", "/tasks"),
        ("get", "/boards"),
        ("get", "/users"),
        ("get", "/settings"),
        ("get", "/printers"),
        ("post", "/tasks"),
        ("delete", "/tasks/1"),
        ("post", "/tasks/1/print"),
        ("post", "/tasks/1/comments"),
    ]:
        response = anonymous.request(method.upper(), path, json={})
        assert response.status_code == 401, f"{method.upper()} {path} quedó abierta"

    # Dos excepciones deliberadas: el healthcheck de Docker y el agente con su propio token.
    assert anonymous.get("/health").json() == {"status": "ok"}
    assert (
        anonymous.post(
            "/printers/1/claim",
            json={"agent_id": "office-agent"},
            headers={"X-Agent-Token": "test-agent-secret"},
        ).status_code
        == 200
    )
    # El token del agente no sirve como sesión de persona.
    agent_only = anonymous.get("/tasks", headers={"X-Agent-Token": "test-agent-secret"})
    assert agent_only.status_code == 401


def test_a_bad_bearer_token_is_rejected(anonymous: TestClient) -> None:
    for header in ("", "Bearer", "Basic abc", "Bearer no-es-un-jwt"):
        assert anonymous.get("/tasks", headers={"Authorization": header}).status_code == 401


def test_first_login_creates_the_member_and_later_logins_reuse_it(
    database: sessionmaker[Session],
) -> None:
    claims = {"sub": "kc-abc-123", "name": "Renato", "email": "renato@oficina.test"}
    with database() as db:
        created = provision(db, claims)
        assert created.subject == "kc-abc-123" and created.name == "Renato"

        again = provision(db, claims)
        assert again.id == created.id, "el segundo login duplicó la persona"

        # Nombre y correo viven en Keycloak; aquí solo se refleja lo que diga el token.
        renamed = provision(db, {**claims, "name": "Renato Pérez"})
        assert renamed.id == created.id and renamed.name == "Renato Pérez"

        assert len(list(db.scalars(select(User).where(User.subject == "kc-abc-123")))) == 1


def test_the_api_refuses_to_validate_without_an_issuer(monkeypatch: pytest.MonkeyPatch) -> None:
    # No hay modo "auth desactivada": sin emisor configurado, validar revienta en vez de pasar.
    from app.api import auth

    monkeypatch.setenv("OIDC_ISSUER", "")
    get_settings.cache_clear()
    auth.signing_keys.cache_clear()
    with pytest.raises(RuntimeError, match="OIDC_ISSUER"):
        auth.signing_keys()
    get_settings.cache_clear()
    auth.signing_keys.cache_clear()


def test_mcp_identity_reaches_the_routes(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """FastMCP llama a la API por ASGI y borra `authorization` al hacerlo.

    Sin resolver la identidad desde el token que el propio MCP ya validó, toda herramienta
    respondía 401 aunque ChatGPT se hubiera autenticado bien contra Keycloak.
    """
    from fastmcp.server.auth import AccessToken

    from app.api import auth

    app.dependency_overrides.pop(auth.current_user, None)
    claims = {"sub": "kc-desde-mcp", "name": "Agente", "email": "agente@oficina.test"}

    # Sin contexto MCP y sin cabecera: cerrado.
    assert client.get("/tasks").status_code == 401

    token = AccessToken(token="t", client_id="chatgpt", scopes=["openid"], claims=claims)
    monkeypatch.setattr(auth, "get_access_token", lambda: token)
    assert client.get("/tasks").status_code == 200

    # La identidad del token se materializa como miembro, igual que en un login por navegador.
    members = client.get("/users").json()
    assert [m["name"] for m in members if m["email"] == "agente@oficina.test"] == ["Agente"]
