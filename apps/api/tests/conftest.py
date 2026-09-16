from collections.abc import Generator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from app.api.auth import current_user
from app.config import get_settings
from app.db.session import get_db
from app.main import app
from app.models.entities import Printer, User


@pytest.fixture()
def database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Generator[sessionmaker[Session]]:
    url = f"sqlite:///{tmp_path / 'test.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("AGENT_TOKEN", "test-agent-secret")
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://board.example.test")
    monkeypatch.setenv("OIDC_ISSUER", "https://keycloak.example.test/realms/corkbit")
    get_settings.cache_clear()
    command.upgrade(Config("alembic.ini"), "head")
    engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(engine, "connect")
    def foreign_keys(connection: object, _: object) -> None:
        connection.execute("PRAGMA foreign_keys=ON")  # type: ignore[attr-defined]

    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        db.add(Printer(name="Test printer", agent_id="office-agent", location="Test"))
        # Identidad de las pruebas: equivale a alguien que ya inició sesión en Keycloak.
        db.add(User(subject="test-subject", name="Persona de prueba", email="test@example.test"))
        db.commit()
    yield factory
    engine.dispose()
    get_settings.cache_clear()


@pytest.fixture()
def client(database: sessionmaker[Session]) -> Generator[TestClient]:
    def dependency() -> Generator[Session]:
        with database() as db:
            yield db

    def signed_in() -> User:
        with database() as db:
            user = db.scalar(select(User).where(User.subject == "test-subject"))
            assert user is not None
            return user

    app.dependency_overrides[get_db] = dependency
    app.dependency_overrides[current_user] = signed_in
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def member(database: sessionmaker[Session]) -> User:
    """Segundo miembro, como si hubiera iniciado sesión: ya no se crean tecleando un nombre."""
    with database() as db:
        user = User(subject="kc-mariana", name="Mariana", email="mariana@oficina.test")
        db.add(user)
        db.commit()
        return user


@pytest.fixture()
def anonymous(database: sessionmaker[Session]) -> Generator[TestClient]:
    """Cliente sin sesión: solo se sustituye la base de datos, no la identidad."""

    def dependency() -> Generator[Session]:
        with database() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
