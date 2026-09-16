"""Autenticación OIDC contra Keycloak.

No hay interruptor para apagarla: una API sin `OIDC_ISSUER` configurado no arranca. Un modo
"auth desactivada" es justo la clase de ajuste que alguien deja puesto por error en producción.
Las pruebas sustituyen `current_user` con `dependency_overrides`, como ya hacen con `get_db`.
"""

from functools import lru_cache
from typing import Annotated, Any

import jwt
from fastapi import Depends, Header, HTTPException
from fastmcp.server.dependencies import get_access_token
from jwt import PyJWKClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.session import get_db
from app.models.entities import User


@lru_cache
def signing_keys() -> PyJWKClient:
    """Cliente JWKS del realm. Cachea las claves públicas y las recarga si el realm las rota."""
    issuer = get_settings().oidc_issuer
    if not issuer:
        raise RuntimeError("OIDC_ISSUER no está configurado: la API no puede validar tokens")
    return PyJWKClient(f"{issuer.rstrip('/')}/protocol/openid-connect/certs")


def verify(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        key = signing_keys().get_signing_key_from_jwt(token).key
        return jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=settings.oidc_audience,
            issuer=settings.oidc_issuer.rstrip("/"),
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except jwt.PyJWTError as error:
        raise HTTPException(401, "Sesión no válida o expirada") from error


def provision(db: Session, claims: dict[str, Any]) -> User:
    """Espejo local de la identidad. Dar de alta en Keycloak es dar de alta en el tablero."""
    subject = claims["sub"]
    user = db.scalar(select(User).where(User.subject == subject))
    name = claims.get("name") or claims.get("preferred_username") or "Sin nombre"
    if user is None:
        user = User(subject=subject, name=name, email=claims.get("email"))
        db.add(user)
        db.commit()
        return user
    # El nombre y el correo viven en Keycloak; aquí solo se refleja lo que diga el token.
    if (user.name, user.email) != (name, claims.get("email")):
        user.name, user.email = name, claims.get("email")
        db.commit()
    return user


def mcp_claims() -> dict[str, Any] | None:
    """Identidad de una llamada que entra por el servidor MCP.

    FastMCP monta la API por ASGI en este mismo proceso, y `get_http_headers()` borra
    `authorization` a proposito para no filtrar credenciales a servicios downstream. Aqui el
    downstream es esta misma app, asi que la ruta se quedaba sin saber quien llama.

    No se revalida el token: el proveedor de Keycloak ya comprobo firma, emisor, audiencia y
    expiracion antes de invocar la herramienta. Fuera de una peticion MCP autenticada esto
    devuelve None y se exige la cabecera como siempre.
    """
    token = get_access_token()
    return dict(token.claims) if token and token.claims else None


def current_user(
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[str, Header()] = "",
) -> User:
    scheme, _, token = authorization.partition(" ")
    claims: dict[str, Any] | None = (
        verify(token) if scheme.lower() == "bearer" and token else mcp_claims()
    )
    if not claims:
        raise HTTPException(401, "Inicia sesión para usar el tablero")
    user = provision(db, claims)
    if not user.active:
        raise HTTPException(403, "Esta cuenta está desactivada")
    return user


CurrentUser = Annotated[User, Depends(current_user)]
