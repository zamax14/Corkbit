# Arquitectura

```text
Navegador / teléfono        Agente de IA
       │ /api (REST)             │ /api/mcp (MCP)
       ▼                         ▼
Vite en desarrollo / Nginx en Docker
       │
       ▼
FastAPI → servicios → repositorios / SQLAlchemy
       │                       │
       └────────── SQLite / PostgreSQL
                               ▲
                        cola persistente
                               │ HTTPS + token
                               ▼
                     Agente local Python
                               │
                       ESC/POS USB / LAN
```

## Monorepo

- `apps/web`: React, TypeScript, Vite, Tailwind CSS; componentes de tablero, formularios y detalles. El estado viene de la API; no se guardan tareas ficticias en localStorage. El estilo de corcho se genera en CSS con textura SVG local. La paleta carbón/salvia/corcho/papel/cielo y la fuente Inter local toman como referencia `guia_visual.png`; se usa la marca Crokbit.
- `apps/api`: FastAPI / Pydantic; `api` expone rutas, `mcp` deriva el servidor MCP del propio OpenAPI de la app (sin lógica paralela), `services` aplica transacciones y reglas, `repositories` encapsula consultas compartidas, `models` define persistencia, `schemas` valida entradas y salidas, `db` administra sesiones.
- `apps/print-agent`: configuración, cliente HTTP, renderizador, conexión ESC/POS y bucle con recuperación persistente.
- `infra/compose.yaml`: PostgreSQL, API, web y agente opcional. Nginx preserva las rutas `/t/{id}` al recargar.

## Decisiones

1. Tres estados y cuatro prioridades cerradas mediante enums Pydantic. Fechas de plazo sin zona horaria; timestamps de eventos en UTC. `completed_at` se conserva al editar una tarea terminada y se limpia al reabrirla.
2. WIP es un aviso visual. Se configura con `WIP_LIMIT`, nunca impide una transición.
3. Crear + imprimir es una transacción. Si la impresora o el responsable no son válidos, no queda una tarea huérfana de su operación solicitada.
4. Cada ticket captura una instantánea de la tarea y de su URL al encolarse. La reimpresión genera un trabajo nuevo con datos actuales. Eliminar una tarea conserva los trabajos (`task_id` pasa a null); su QR mostrará «no existe». Los IDs de tareas no se reutilizan en SQLite.
5. La web refresca el estado cada 10 segundos cuando está visible. Las respuestas de refrescos anteriores a una mutación no sobrescriben el cambio. Los errores son visibles y conservan el borrador del formulario.
6. El arrastre tiene sensores de puntero y teclado con anuncios en español. Los botones de estado ofrecen una alternativa móvil. Los diálogos nativos mantienen foco y permiten Escape.
7. La cola usa compare-and-set en SQL para reservas exclusivas, sin Redis ni intermediario adicional. Las llamadas del agente requieren `X-Agent-Token` y una identidad asociada a la impresora.
8. El servidor MCP se genera desde el OpenAPI con `FastMCP.from_fastapi` y se monta en la misma app: las herramientas llaman a las rutas por ASGI, sin red ni reglas duplicadas. Se excluyen `/health`, `/settings` y las rutas del agente de impresión. `MCP_TOKEN`, si está definido, exige un bearer compartido; vacío deja el endpoint como el resto de la API.
9. Imprimir es una acción de la interfaz. «Imprimir aquí» usa el diálogo del navegador y la impresora del equipo que mira el tablero: el ticket se maqueta con CSS `@page` a 80 mm y sale fuera del árbol de la app (portal a `body`), sin tocar el servidor. La cola ESC/POS sigue disponible para el caso compartido. Ambas rutas sellan `tasks.printed_at`; el sello es informativo y no bloquea reimpresiones, porque ninguna de las dos confirma la salida física.
10. La navegación entre tableros son pestañas de navegador (`aria-current="page"`), y «Todos los tableros» es una galería de miniaturas del propio corcho, con las notas reales de cada uno. Eliminar un tablero vive solo en esa vista, tras una confirmación que nombra el tablero y sus tareas; la API además exige `confirm: true`.
11. El color de post-it es del miembro, no de la tarea: se guarda en `users.color` y sus notas lo usan en todos los tableros. La prioridad conserva su etiqueta, así que el color nunca la oculta.
12. El modo local usa SQLite; Compose usa PostgreSQL. Alembic es la única vía de creación/actualización del esquema. No se ejecuta `create_all()` en el arranque.

## Operación

El tablero no incluye autenticación de usuarios. Usa red privada o un proxy de acceso autenticado. Los secretos se mantienen en archivos `.env` ignorados por Git. Los datos de Docker y el estado del agente usan volúmenes; no elimines volúmenes si deseas conservarlos.

Para respaldar PostgreSQL:

```bash
docker compose --env-file .env -f infra/compose.yaml exec -T db pg_dump -U crokbit crokbit > crokbit.sql
```

Para SQLite, detén la API antes de copiar `apps/api/crokbit.db`. Respaldar también el directorio persistente del agente conserva los acuses aún no entregados. La prueba de restauración debe hacerse en una instancia separada.

Documentación técnica utilizada: [FastAPI](https://fastapi.tiangolo.com/tutorial/sql-databases/), [dnd-kit](https://dndkit.com/legacy/presets/sortable/overview/) y [python-escpos](https://python-escpos.readthedocs.io/en/latest/api/printer.html).
