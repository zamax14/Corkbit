# Cobertura del MVP

Qué pedía el MVP original y dónde está implementado cada punto.

| Requisito | Implementación |
|---|---|
| Backlog / WIP / Done | API, columnas del tablero y botones de estado |
| Campos de tarea y cuatro prioridades | Schemas Pydantic y modelo SQLAlchemy |
| Crear, editar, eliminar, consultar | API REST, formulario y vista individual |
| Corcho, post-its, sombra, rotación, hover | CSS responsive con textura local |
| Drag & drop accesible | dnd-kit con puntero, teclado y anuncios |
| Guardar + imprimir | Transacción tarea + instantánea de print job |
| Imprimir y reimprimir | Diálogo del navegador con impresora local, cola ESC/POS y API |
| Estado de ticket impreso | `tasks.printed_at`, sello informativo en tarjeta y detalle |
| Ticket 80 mm con QR | Renderizador ESC/POS configurable, archivo/USB/LAN |
| `/t/{id}` móvil | Detalle responsive, QR y acciones grandes |
| Modelos users/printers/print_jobs | Migración inicial y API |
| Usuarios | Listado/creación de responsables en el formulario |
| Tableros por proyecto | Pestañas de navegador, galería de miniaturas y borrado confirmado |
| Color de post-it por miembro | `users.color`, selector en «Miembros» y notas teñidas |
| WIP limit | Conteo configurable con aviso, sin bloqueo |
| Comentarios por tarea | `tasks.comments`, timeline en la vista individual y herramientas MCP |
| Heartbeat/retry/errores | Reserva atómica, acuse persistente y reintentos limitados |
| SQLite/PostgreSQL | Local / Compose, mismo esquema Alembic |
| OpenAPI y errores | `/docs`, validación y respuestas HTTP consistentes |
| Docker Compose | DB, API, Nginx/web y agente opcional |

Los endpoints mínimos están implementados. Se añaden `GET /health`, `GET /auth-config`, `GET /settings`, `GET /users`, `GET /boards/{id}/overview` y `POST /printers/{id}/claim` para la operación real.

De las fases posteriores se implementan los comentarios y el servidor MCP montado en `/mcp`, que reexpone la API existente como herramientas. Filtros, búsqueda y notificaciones siguen sin implementar. La impresión física necesita validar el perfil con el equipo real; las pruebas automatizadas cubren la generación efectiva de ESC/POS y el QR, así como el protocolo de cola.
