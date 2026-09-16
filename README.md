# Corkbit

Un Kanban físico-digital: notas en un tablero de corcho que se convierten en tickets térmicos de 80 mm. Implementa el MVP y las capacidades de fase 2 de [los requisitos](pinboard_pm_requirements.md).

- Tableros independientes: se cambia de proyecto con pestañas, como en un navegador.
- «Todos los tableros» muestra cada uno como miniatura de su corcho; desde ahí se eliminan,
  con una confirmación que dice cuántas tareas se van.
- Miembros compartidos del espacio: agrégalos desde «Miembros», asígnalos a tareas y dales un
  color de post-it que sus notas usan en todos los tableros.
- Tareas con responsable, descripción, prioridad, fecha y estados Backlog / WIP / Done.
- Historial de comentarios por tarea: registra lo que avanza aunque la tarea no cambie de columna.
- Arrastre con ratón, touch y teclado; controles de estado en la vista individual.
- Guardar, editar, eliminar, imprimir y reimprimir; persistencia real en SQLite o PostgreSQL.
- Dos formas de imprimir: el diálogo del navegador con tu propia impresora, o la cola ESC/POS.
- Cada tarea muestra si ya tiene ticket en papel; el sello nunca impide reimprimir.
- Cola transaccional, agente local ESC/POS para LAN/USB, heartbeat y reintentos limitados.
- QR con ruta `/t/{id}`, vista móvil, usuarios y límite WIP informativo.
- Interfaz en español, sin servicios externos ni fuentes remotas.
- Servidor MCP integrado: un agente de IA gestiona el tablero con las mismas reglas que la web.

## Agentes de IA (MCP)

La API publica un servidor [MCP](https://modelcontextprotocol.io) en `/mcp`, con transporte HTTP.
Las herramientas se derivan del propio OpenAPI, así que un agente aplica las mismas validaciones y
transacciones que la web: `list_tasks`, `get_task`, `create_task`, `update_task`, `set_task_status`,
`delete_task`, `list_boards`, `create_board`, `delete_board`, `board_overview`, `list_users`,
`create_user`, `set_user_color`, `print_task`, `list_printers`, `list_print_jobs`,
`add_comment`, `list_comments` y `delete_comment`.

`board_overview` devuelve el tablero completo en una llamada: conteo por estado, límite WIP y las
tareas con su responsable y su URL de QR.

`add_comment` anota un avance en la tarea sin modificarla: `updated_at` se queda como estaba y el
ticket impreso no cambia. Cada tarea lleva `comment_count`, `last_comment` y `last_comment_at`, así
que un agente ve en `board_overview` qué se movió y qué solo tuvo novedades, en una sola llamada.

`print_task` encola un ticket en la impresora que le indiques, y **gasta papel de verdad**: quien
tenga acceso al endpoint MCP puede hacer que la térmica imprima. `list_printers` y `list_print_jobs`
sirven para elegir impresora y revisar cómo quedó el trabajo. La fontanería del agente (reclamar
trabajos, confirmarlos, pendientes y heartbeat) sigue fuera del MCP: es tráfico máquina a máquina
autenticado con `AGENT_TOKEN`.

El endpoint MCP va detrás de Keycloak con registro dinámico de clientes: un agente como ChatGPT se
registra solo, sin que le configures Auth URL ni Token URL a mano. Se activa con `OIDC_ISSUER` y
`MCP_BASE_URL`; sin ellos queda abierto, como el resto de la API en desarrollo. Registro del
cliente:

```bash
# Con Keycloak activo, el cliente negocia OAuth solo; no hay token que pegar.
claude mcp add --transport http corkbit https://tu-host.ts.net/mcp/
# Desarrollo local, sin OIDC_ISSUER configurado
claude mcp add --transport http corkbit http://localhost:8000/mcp/
```

## Inicio rápido con Docker

Requiere Docker Engine y Compose v2.

```bash
cp .env.example .env
# Edita AGENT_TOKEN; por ejemplo, genera uno con: openssl rand -hex 32
make up
```

Abre **http://localhost:8080**. La API está en `/api`, y OpenAPI en **http://localhost:8080/api/docs**. PostgreSQL usa un volumen persistente; los reinicios aplican las migraciones pendientes. La primera ejecución configura una impresora, pero no inserta tareas ni usuarios de ejemplo.

Para incluir el agente de prueba que genera archivos ESC/POS:

```bash
docker compose --env-file .env -f infra/compose.yaml --profile printer up --build -d
```

Los tickets `.bin` y `.txt` quedan en `/data/tickets` del contenedor `print-agent`, dentro del volumen `agent_data`. En modo `file`, «Impreso» significa **archivo generado**, no impresión en papel. Usa `docker compose --env-file .env -f infra/compose.yaml cp print-agent:/data/tickets ./tickets` para copiarlos.

Para cargar seis notas de ejemplo de forma explícita en una base sin usuarios:

```bash
docker compose --env-file .env -f infra/compose.yaml exec api python -m app.cli demo
```

`make down` detiene los servicios y conserva los datos.

## Desarrollo local

Requiere Node.js 22.12+ (recomendado 24), Python 3.12+ y `uv`.

```bash
make install
cp apps/api/.env.example apps/api/.env
cp apps/print-agent/.env.example apps/print-agent/.env
# Configura el mismo secreto en AGENT_TOKEN y PRINT_AGENT_TOKEN.
make migrate
make demo  # opcional; requiere base sin usuarios
```

En terminales separadas:

```bash
make api    # http://localhost:8000/docs
make web    # http://localhost:5173
make agent  # modo file por defecto
```

La API local usa `apps/api/corkbit.db`. Vite redirige `/api` a la API; no hace falta configurar CORS para el uso habitual. Las variables de los ejemplos se leen desde el directorio de cada aplicación. `PUBLIC_BASE_URL` es la URL del **frontend**, no la API.

## Impresión

Dos caminos, según dónde esté la impresora:

**«Imprimir aquí»** abre el diálogo del navegador y usa la impresora instalada en **el equipo desde
el que miras el tablero**. Funciona aunque Corkbit esté en un servidor remoto: el documento no pasa
por el servidor, va directo al spooler de tu sistema. No necesita agente, ni token, ni puertos
abiertos; sí necesita la impresora instalada en tu SO. El ticket se maqueta a 80 mm con su QR
(`@page { size: 80mm auto }` en `apps/web/src/styles.css`).

**«Reimprimir»** y la casilla «Guardar e imprimir» encolan un trabajo para el agente ESC/POS, que
imprime con comandos nativos (corte automático, QR nativo) en la impresora compartida del equipo.
Es el camino para imprimir desde el móvil tras escanear un QR, o cuando la térmica no está en la
máquina de quien crea la tarea.

Ambos dejan el mismo sello: la tarea guarda `printed_at` y la tarjeta muestra «Impresa». Es
informativo — nunca impide volver a imprimir. Ojo: ni el diálogo del navegador ni ESC/POS confirman
que el papel saliera; el sello dice que se mandó a imprimir.

## Publicar hacia fuera

El tablero y la consola de Keycloak se quedan dentro de la tailnet. Lo único público es lo que un
agente externo necesita alcanzar, y son cuatro rutas, no una:

```bash
sudo tailscale funnel --bg --yes --set-path /mcp          http://localhost:8080/api/mcp/
sudo tailscale funnel --bg --yes --set-path /.well-known  http://localhost:8080/.well-known
sudo tailscale funnel --bg --yes --set-path /realms       http://localhost:8081/realms
sudo tailscale funnel --bg --yes --set-path /resources    http://localhost:8081/resources
```

`/mcp` es el servidor; `/.well-known` son los metadatos de recurso protegido (RFC 9728) que el
agente lee del 401 para saber a qué Keycloak ir; `/realms` es el descubrimiento, el registro
dinámico y el canje de tokens; `/resources` son los estilos del login, sin los cuales la página
sale rota.

`OIDC_ISSUER` y `MCP_BASE_URL` deben ser esas URLs públicas: el emisor de un token es el que ven
los clientes, no el interno. La consola de administración se queda en `KEYCLOAK_ADMIN_URL`,
alcanzable solo por la tailnet.

## Actualizar una instalación existente

La migración de tableros conserva las tareas actuales en «Mi tablero», sus responsables y sus QR.
La de `printed_at` deja las tareas existentes como «sin imprimir», y la de comentarios crea la tabla
vacía: las tareas actuales arrancan sin historial.
En desarrollo, detén la API y ejecuta `uv run alembic upgrade head` desde `apps/api` antes de
reiniciarla. Con Docker, reconstruye los servicios con `docker compose --env-file .env -f
infra/compose.yaml up --build -d`; la API aplica las migraciones al arrancar.

## Impresora y QR

En `apps/print-agent/.env` configura:

```dotenv
PRINT_TRANSPORT=network
PRINT_HOST=192.168.1.80
PRINT_PORT=9100
PRINT_PROFILE=TM-T88III
PRINT_COLUMNS=48
```

Para USB usa `PRINT_TRANSPORT=usb` y los IDs reales en `PRINT_USB_VENDOR` y `PRINT_USB_PRODUCT` (decimal). Instala `libusb` y concede acceso al dispositivo al usuario del agente. Ejecutar el agente nativamente en el PC/Raspberry Pi evita exponer USB al servidor remoto. El perfil de ejemplo es Epson TM-T88III; ajústalo al modelo real antes de imprimir.

Para escanear desde un teléfono, configura `PUBLIC_BASE_URL` con una dirección accesible desde su red, por ejemplo `http://192.168.1.20:8080`. `localhost` en un teléfono apunta al propio teléfono. Después de cambiar esta URL, reinicia la API y **genera nuevos tickets**: los trabajos existentes conservan su instantánea original.

El agente remoto puede usar `PRINT_API_URL=https://tu-host/api`. Su `PRINT_AGENT_ID` debe corresponder a la impresora registrada. Registra otras impresoras con:

```bash
cd apps/api
uv run python -m app.cli printer --agent-id recepcion-agent --name 'Recepción 80 mm' --location 'Recepción'
```

El comando muestra el ID que debes colocar en `PRINT_PRINTER_ID`. La interfaz permite seleccionar impresora en la creación y vista individual. Ejecuta **un proceso por agente**, con su propio directorio de estado persistente.

## Verificación

```bash
cd apps/web && npx playwright install chromium
cd ../..
make test
```

Las pruebas de API crean bases temporales con Alembic. Las de navegador levantan su propia API en `8011` y Vite en `5174`, sin tocar los datos de desarrollo. Se verifican CRUD, fechas de cierre, nulabilidad, transacciones, reservas concurrentes, autenticación de agentes, reintentos, recuperación, renderizado ESC/POS, drag & drop, QR móvil y errores de guardado.

```bash
make build
cd apps/api && uv run alembic check
```

## Alcance operativo

Diseñado para un equipo en una **red privada**. El tablero y la API exigen sesión de Keycloak:
toda ruta responde 401 sin token, salvo `/health` y las del agente de impresión, que usan
`AGENT_TOKEN`. Las cuentas las crea el administrador desde la consola de Keycloak; no hay
autorregistro. Los permisos son planos: quien inicia sesión puede todo. Ver
[el diseño de autenticación](docs/superpowers/specs/2026-09-15-keycloak-auth-design.md).

ESC/POS normalmente confirma el envío de bytes, no la salida física del papel. Un fallo parcial puede producir un ticket duplicado en un reintento; revisa el papel ante errores. Las reservas cuyo resultado se desconoce no se reimprimen automáticamente. La impresión física depende del modelo, papel, driver, perfil y conectividad; requiere una prueba con el equipo real.

No se implementan búsqueda, filtros ni notificaciones de fases posteriores. La integración con IA se limita al servidor MCP descrito arriba.

Más detalles: [arquitectura](docs/architecture.md), [protocolo de impresión](docs/printer-protocol.md) y [cobertura de requisitos](docs/requirements.md).
