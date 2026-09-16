import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from app.api.routes import agent_router, public_router, router
from app.config import get_settings
from app.mcp import build_server

app = FastAPI(
    title="Corkbit API",
    version="0.1.0",
    description="Kanban físico-digital",
    root_path=get_settings().root_path,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=[
        "Content-Type",
        "X-Agent-Token",
        "Authorization",
        "Mcp-Session-Id",
        "Mcp-Protocol-Version",
    ],
    expose_headers=["Mcp-Session-Id"],
)
app.include_router(public_router)
app.include_router(agent_router)
app.include_router(router)

mcp_app = build_server(app).http_app(path="/")
# ponytail: el lifespan del gestor de sesiones MCP se asigna después de construir la app porque
# el servidor MCP se deriva de esta misma app (from_fastapi lee su OpenAPI ya completo).
app.router.lifespan_context = mcp_app.lifespan
app.mount("/mcp", mcp_app)


@app.exception_handler(SQLAlchemyError)
async def database_error(request: Request, error: SQLAlchemyError) -> JSONResponse:
    logging.getLogger(__name__).exception("Database failure on %s", request.url.path)
    return JSONResponse(
        status_code=503, content={"detail": "Base de datos no disponible. Reintenta."}
    )
