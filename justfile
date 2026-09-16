# Corkbit. Ejecuta `just` para ver las recetas disponibles.

compose := "docker compose --env-file .env -f infra/compose.yaml"

_default:
    @just --list --unsorted

# Levanta el stack completo en Docker: PostgreSQL, Keycloak, API y tablero.
up:
    {{compose}} up --build -d

# Igual que `up`, mas el agente de impresion ESC/POS.
up-printer:
    {{compose}} --profile printer up --build -d

# Despliegue publico: anade Caddy con TLS automatico. Ver docs/deploy-vps.md.
up-public:
    {{compose}} --profile public up --build -d

# Detiene los servicios y conserva los datos.
down:
    {{compose}} down

# Sigue los logs de todos los servicios.
logs:
    {{compose}} logs -f

# Instala las dependencias de las tres aplicaciones.
install:
    cd apps/api && uv sync
    cd apps/print-agent && uv sync
    cd apps/web && npm ci

# Aplica las migraciones pendientes a la base de datos local.
migrate:
    cd apps/api && uv run alembic upgrade head

# Carga seis notas de ejemplo. Requiere una base sin usuarios.
demo:
    cd apps/api && uv run python -m app.cli demo

# API en http://localhost:8000 con recarga automatica.
api:
    cd apps/api && uv run uvicorn app.main:app --reload

# Tablero en http://localhost:5173.
web:
    cd apps/web && npm run dev

# Agente de impresion local; en modo `file` escribe tickets en apps/print-agent/tickets.
agent:
    cd apps/print-agent && uv run corkbit-print-agent

# Todas las pruebas: API, agente y navegador.
test: test-api test-agent test-web

test-api:
    cd apps/api && uv run pytest

test-agent:
    cd apps/print-agent && uv run pytest

# Requiere `cd apps/web && npx playwright install chromium` la primera vez.
test-web:
    cd apps/web && npx playwright test

# Compilacion y analisis estatico de las tres aplicaciones.
build: lint
    cd apps/web && npm run build

# Formato, linter y tipado estricto.
lint:
    cd apps/api && uv run ruff check . && uv run ruff format --check . && uv run mypy app
    cd apps/print-agent && uv run ruff check . && uv run ruff format --check . && uv run mypy corkbit_agent
    cd apps/web && npm run format:check && npx tsc -b

# Comprueba que el esquema de la base coincide con los modelos.
check-schema:
    cd apps/api && uv run alembic check
