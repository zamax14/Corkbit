"""App para las pruebas de navegador: identidad fija en lugar de un Keycloak real.

El candado se prueba en `tests/test_auth.py`, que comprueba los 401 contra la app de verdad.
Aquí interesa el tablero, no el login, y levantar un Keycloak por cada prueba de navegador
costaría minutos para verificar algo que ya está cubierto.

No es un interruptor de configuración: hay que importar este módulo a propósito.
"""

from sqlalchemy import select

from app.api.auth import current_user
from app.db.session import SessionLocal
from app.main import app
from app.models.entities import User


def signed_in() -> User:
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.subject == "browser-tests"))
        if user is None:
            user = User(subject="browser-tests", name="Persona de prueba")
            db.add(user)
            db.commit()
        return user


app.dependency_overrides[current_user] = signed_in
