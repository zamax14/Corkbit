from functools import lru_cache

from pydantic import Field, HttpUrl
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "sqlite:///./corkbit.db"
    root_path: str = ""
    public_base_url: HttpUrl = HttpUrl("http://localhost:5173")
    cors_origins: list[str] = ["http://localhost:5173"]
    wip_limit: int = Field(default=5, ge=1)
    agent_token: str = ""
    # Emisor del realm de Keycloak, p. ej. http://localhost:8081/realms/corkbit
    oidc_issuer: str = ""
    oidc_audience: str = "corkbit-api"
    oidc_client_id: str = "corkbit-web"
    # URL publica del servidor MCP (el Funnel). Keycloak la necesita para el registro dinamico.
    mcp_base_url: str = ""
    print_max_attempts: int = Field(default=3, ge=1)
    print_lease_seconds: int = Field(default=120, ge=30)


@lru_cache
def get_settings() -> Settings:
    return Settings()
