"""Servidor MCP: publica el tablero como herramientas para agentes de IA.

Las herramientas se derivan del propio OpenAPI de la API; no hay lógica de negocio
paralela. `from_fastapi` llama a la app por ASGI, sin salir a la red.
"""

from fastapi import FastAPI
from fastmcp import FastMCP
from fastmcp.server.auth import AuthProvider
from fastmcp.server.auth.providers.keycloak import KeycloakAuthProvider
from fastmcp.server.providers.openapi import MCPType, RouteMap

from app.config import get_settings

NAMES = {
    "tasks_list_tasks_get": "list_tasks",
    "tasks_create_tasks_post": "create_task",
    "tasks_get_tasks__task_id__get": "get_task",
    "tasks_patch_tasks__task_id__patch": "update_task",
    "tasks_status_tasks__task_id__status_patch": "set_task_status",
    "tasks_delete_tasks__task_id__delete": "delete_task",
    "boards_list_boards_get": "list_boards",
    "boards_create_boards_post": "create_board",
    "boards_delete_boards__board_id__delete": "delete_board",
    "boards_overview_boards__board_id__overview_get": "board_overview",
    "users_list_users_get": "list_users",
    "users_color_users__user_id__patch": "set_user_color",
    "tasks_print_tasks__task_id__print_post": "print_task",
    "printers_list_printers_get": "list_printers",
    "jobs_list_print_jobs_get": "list_print_jobs",
    "comments_list_tasks__task_id__comments_get": "list_comments",
    "comments_create_tasks__task_id__comments_post": "add_comment",
    "comments_delete_comments__comment_id__delete": "delete_comment",
}

EXCLUDED = r"^/(health|settings)$"
# Encolar un ticket, ver en que impresora y como quedo. El resto de /print-* es fontaneria
# del agente (claim, ack, pending, heartbeat) y no le sirve de nada a la IA.
PRINTING = r"^/(tasks/\{task_id\}/print|printers|print-jobs)$"


def keycloak_auth() -> AuthProvider | None:
    """Keycloak con registro dinamico de clientes: ChatGPT se registra solo.

    Sin `OIDC_ISSUER` el servidor MCP queda abierto, igual que el resto de la API en desarrollo.
    En el despliegue real ambas cosas van configuradas y `/mcp` es lo unico publico.
    """
    settings = get_settings()
    if not settings.oidc_issuer or not settings.mcp_base_url:
        return None
    return KeycloakAuthProvider(
        realm_url=settings.oidc_issuer,
        base_url=settings.mcp_base_url,
        audience=settings.oidc_audience,
    )


def build_server(app: FastAPI) -> FastMCP:
    return FastMCP.from_fastapi(
        app,
        name="Crokbit",
        mcp_names=NAMES,
        route_maps=[
            # El primer RouteMap que coincide gana: estas tres rutas de impresion se publican
            # y el resto de las etiquetadas "printing" sigue fuera.
            RouteMap(pattern=PRINTING, mcp_type=MCPType.TOOL),
            RouteMap(tags={"printing"}, mcp_type=MCPType.EXCLUDE),
            RouteMap(tags={"agent"}, mcp_type=MCPType.EXCLUDE),
            RouteMap(pattern=EXCLUDED, mcp_type=MCPType.EXCLUDE),
        ],
        auth=keycloak_auth(),
    )
