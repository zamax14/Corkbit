import asyncio

import pytest
from fastapi.testclient import TestClient
from fastmcp import Client
from fastmcp.server.auth.providers.keycloak import KeycloakAuthProvider

from app.config import get_settings
from app.main import app
from app.mcp import build_server


def test_mcp_exposes_the_board_and_hides_the_print_agent(client: TestClient) -> None:
    async def run() -> None:
        async with Client(build_server(app)) as mcp:
            names = {tool.name for tool in await mcp.list_tools()}
            assert {"list_tasks", "create_task", "update_task", "board_overview"} <= names
            assert {"print_task", "list_printers", "list_print_jobs"} <= names
            # La fontaneria del agente sigue fuera: reclamar, confirmar, pendientes, heartbeat.
            plumbing = ("claim", "ack", "pending", "heartbeat")
            assert not [n for n in names if any(word in n for word in plumbing)]

            task = (await mcp.call_tool("create_task", {"title": "Desde el agente"})).data
            assert task.status == "BACKLOG" and task.url.endswith(f"/t/{task.id}")
            assert task.printed_at is None
            await mcp.call_tool("set_task_status", {"task_id": task.id, "status": "WIP"})

            assert {"add_comment", "list_comments", "delete_comment"} <= names
            await mcp.call_tool("add_comment", {"task_id": task.id, "body": "Avancé la intro"})
            timeline = (await mcp.call_tool("list_comments", {"task_id": task.id})).data
            assert [c.body for c in timeline] == ["Avancé la intro"]

            job = (await mcp.call_tool("print_task", {"task_id": task.id})).data
            assert job.task_id == task.id and job.status == "PENDING"

            overview = (await mcp.call_tool("board_overview", {"board_id": 1})).data
            assert overview.wip_limit == 5
            assert dict(overview.counts) == {"BACKLOG": 0, "WIP": 1, "DONE": 0}
            assert [item.title for item in overview.tasks] == ["Desde el agente"]

    asyncio.run(run())


def test_keycloak_guards_the_mcp_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    # Sin realm configurado no hay auth: es el modo de desarrollo, igual que el resto de la API.
    monkeypatch.setenv("OIDC_ISSUER", "")
    monkeypatch.setenv("MCP_BASE_URL", "")
    get_settings.cache_clear()
    assert build_server(app).auth is None

    # Con realm y URL publica, el servidor MCP queda detras de Keycloak.
    monkeypatch.setenv("OIDC_ISSUER", "https://keycloak.example.test/realms/corkbit")
    monkeypatch.setenv("MCP_BASE_URL", "https://corkbit.example.test")
    get_settings.cache_clear()
    auth = build_server(app).auth
    assert isinstance(auth, KeycloakAuthProvider)
    get_settings.cache_clear()
