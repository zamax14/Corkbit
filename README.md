# Corkbit

Un Kanban físico-digital: notas en un tablero de corcho que se convierten en tickets térmicos
de 80 mm, y un servidor MCP para que un agente de IA gestione el tablero con las mismas reglas
que la web. Software libre bajo [AGPL-3.0](LICENSE).

- Tableros independientes: se cambia de proyecto con pestañas, como en un navegador.
- «Todos los tableros» muestra cada uno como miniatura de su corcho; desde ahí se eliminan,
  con una confirmación que dice cuántas tareas se van.
- Miembros compartidos del espacio: quien tiene cuenta en Keycloak aparece en «Miembros»; se les
  asignan tareas y un color de post-it que sus notas usan en todos los tableros.
- Tareas con responsable, descripción, prioridad, fecha y estados Backlog / WIP / Done.
- Historial de comentarios por tarea: registra lo que avanza aunque la tarea no cambie de columna.
- Arrastre con ratón, touch y teclado; controles de estado en la vista individual.
- Guardar, editar, eliminar, imprimir y reimprimir; persistencia real en SQLite o PostgreSQL.
- Dos formas de imprimir: el diálogo del navegador con tu propia impresora, o la cola ESC/POS.
- Cada tarea muestra si ya tiene ticket en papel; el sello nunca impide reimprimir.
- Cola transaccional, agente local ESC/POS para LAN/USB, heartbeat y reintentos limitados.
- QR con ruta `/t/{id}`, vista móvil, usuarios y límite WIP informativo.
- Interfaz en español, sin servicios externos ni fuentes remotas.
- Autenticación con Keycloak: sesión obligatoria, sin autorregistro y sin modo «sin auth».

## Agentes de IA (MCP)

La API publica un servidor [MCP](https://modelcontextprotocol.io) en `/mcp`, con transporte HTTP.
Las herramientas se derivan del propio OpenAPI, así que un agente aplica las mismas validaciones y
transacciones que la web: `list_tasks`, `get_task`, `create_task`, `update_task`, `set_task_status`,
`delete_task`, `list_boards`, `create_board`, `delete_board`, `board_overview`, `list_users`,
`set_user_color`, `print_task`, `list_printers`, `list_print_jobs`,
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
registra solo, sin que le configures Auth URL ni Token URL a mano. El *path* de `MCP_BASE_URL`
determina dónde se sirven los metadatos RFC 9728 que el agente lee del 401, así que esa variable y
la URL pública tienen que coincidir.

```bash
# El cliente negocia OAuth solo; no hay token que pegar.
claude mcp add --transport http corkbit https://tu-host.ts.net/mcp/
# En local, contra el stack de `just up`
claude mcp add --transport http corkbit http://localhost:8080/api/mcp/
```

## Inicio rápido con Docker

Requiere Docker Engine, Compose v2 y [`just`](https://github.com/casey/just).

```bash
cp .env.example .env
# Genera un secreto para AGENT_TOKEN y otro para KEYCLOAK_ADMIN_PASSWORD:
#   openssl rand -hex 32
just up
```

`just` sin argumentos lista todas las recetas disponibles.

Abre **http://localhost:8080**. La API está en `/api`, y OpenAPI en **http://localhost:8080/api/docs**. PostgreSQL usa un volumen persistente; los reinicios aplican las migraciones pendientes. La primera ejecución configura una impresora, pero no inserta tareas ni usuarios de ejemplo.

Keycloak tarda alrededor de un minuto la primera vez. El realm `corkbit` se importa vacío: crea
la primera cuenta en `http://localhost:8081/admin`, cambiando del realm `master` al realm
`corkbit`. No hay autorregistro.

Para incluir el agente de prueba que genera archivos ESC/POS:

```bash
just up-printer
```

Los tickets `.bin` y `.txt` quedan en `/data/tickets` del contenedor `print-agent`, dentro del volumen `agent_data`. En modo `file`, «Impreso» significa **archivo generado**, no impresión en papel. Usa `docker compose --env-file .env -f infra/compose.yaml cp print-agent:/data/tickets ./tickets` para copiarlos.

Para cargar seis notas de ejemplo de forma explícita en una base sin usuarios:

```bash
docker compose --env-file .env -f infra/compose.yaml exec api python -m app.cli demo
```

Son personas ficticias, con un `subject` sintético; no corresponden a cuentas de Keycloak.

`just down` detiene los servicios y conserva los datos.

## Desarrollo local

Requiere Node.js 22.12+ (recomendado 24), Python 3.12+, `uv` y `just`.

La API valida cada petición contra Keycloak y **no tiene modo «sin autenticación»**: sin
`OIDC_ISSUER` toda ruta responde 401. Así que el desarrollo local necesita el Keycloak del stack
de Docker, aunque la API y la web corran fuera de él.

```bash
just install
cp apps/api/.env.example apps/api/.env
cp apps/print-agent/.env.example apps/print-agent/.env
# Configura el mismo secreto en AGENT_TOKEN y PRINT_AGENT_TOKEN.
just up            # deja corriendo Keycloak en el 8081; los .env.example ya le apuntan
just migrate
just demo          # opcional; requiere base sin usuarios
```

En terminales separadas:

```bash
just api    # http://localhost:8000/docs
just web    # http://localhost:5173
just agent  # modo file por defecto
```

La API local usa `apps/api/corkbit.db` (SQLite), independiente del PostgreSQL de Docker. Vite redirige `/api` a la API; no hace falta configurar CORS para el uso habitual. Las variables de los ejemplos se leen desde el directorio de cada aplicación. `PUBLIC_BASE_URL` es la URL del **frontend**, no la API.

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

## Desplegar

Dos caminos, con sus pasos detallados:

- **[Tailscale](docs/deploy-tailscale.md)** — para una Raspberry Pi, un NAS o un equipo de casa.
  Sin abrir puertos del router y sin dominio propio. El tablero se queda dentro de la tailnet y
  solo sale a internet lo que un agente de IA externo necesita alcanzar.
- **[VPS con dominio propio](docs/deploy-vps.md)** — servidor público con HTTPS. Caddy emite y
  renueva los certificados de Let's Encrypt solo, en el perfil `public` de Compose.

En ambos casos `OIDC_ISSUER` debe ser la URL **pública** del realm: el emisor de un token es el que
ven los clientes, no el nombre interno del contenedor.

## Actualizar una instalación existente

La migración de tableros conserva las tareas actuales en «Mi tablero», sus responsables y sus QR.
La de `printed_at` deja las tareas existentes como «sin imprimir», y la de comentarios crea la tabla
vacía: las tareas actuales arrancan sin historial.
En desarrollo, detén la API y ejecuta `just migrate` antes de reiniciarla. Con Docker, `just up`
reconstruye los servicios y la API aplica las migraciones al arrancar.

## Impresora y QR

En `apps/print-agent/.env` configura:

```dotenv
PRINT_TRANSPORT=network
PRINT_HOST=192.168.1.80
PRINT_PORT=9100
PRINT_PROFILE=TM-T88III
PRINT_COLUMNS=48
```

Para USB hay dos transportes. `PRINT_TRANSPORT=device` es el camino corto: el kernel ya expone la
impresora como un archivo (`ls /dev/usb/lp*`), y el agente escribe los bytes ESC/POS ahí, sin
libusb ni CUPS. Indícale la ruta en `PRINT_DEVICE`; con Docker, esa misma ruta del anfitrión se
mapea al contenedor. Si `usblp` no toma el dispositivo, usa `PRINT_TRANSPORT=usb` con los IDs
reales en `PRINT_USB_VENDOR` y `PRINT_USB_PRODUCT` (decimal); entonces sí hace falta `libusb` y dar
acceso al dispositivo al usuario del agente. Ejecutar el agente nativamente en el PC/Raspberry Pi evita exponer USB al servidor remoto. El perfil de ejemplo es Epson TM-T88III; ajústalo al modelo real antes de imprimir.

Para escanear desde un teléfono, configura `PUBLIC_BASE_URL` con una dirección accesible desde su red, por ejemplo `http://192.168.1.20:8080`. `localhost` en un teléfono apunta al propio teléfono. Después de cambiar esta URL, reinicia la API y **genera nuevos tickets**: los trabajos existentes conservan su instantánea original.

El agente remoto puede usar `PRINT_API_URL=https://tu-host/api`. Su `PRINT_AGENT_ID` debe corresponder a la impresora registrada. Registra otras impresoras con:

```bash
cd apps/api
uv run python -m app.cli printer --agent-id recepcion-agent --name 'Recepción 80 mm' --location 'Recepción'
```

El comando muestra el ID que debes colocar en `PRINT_PRINTER_ID`. La interfaz permite seleccionar impresora en la creación y vista individual. Ejecuta **un proceso por agente**, con su propio directorio de estado persistente.

## Pruebas

```bash
cd apps/web && npx playwright install chromium   # solo la primera vez
just test     # API, agente y navegador
just build    # lint, tipos y bundle
```

Qué cubre cada suite y qué queda fuera: [docs/testing.md](docs/testing.md).

## Alcance operativo

Diseñado para un equipo pequeño. El tablero y la API exigen sesión de Keycloak: toda ruta responde
401 sin token, salvo `/health`, `/auth-config` y las del agente de impresión, que usan
`AGENT_TOKEN`. Las cuentas las crea el administrador desde la consola de Keycloak; no hay
autorregistro. Los permisos son planos: quien inicia sesión puede todo. Ver
[el diseño de autenticación](docs/diseno-autenticacion.md).

ESC/POS normalmente confirma el envío de bytes, no la salida física del papel. Un fallo parcial puede producir un ticket duplicado en un reintento; revisa el papel ante errores. Las reservas cuyo resultado se desconoce no se reimprimen automáticamente. La impresión física depende del modelo, papel, driver, perfil y conectividad; requiere una prueba con el equipo real.

No se implementan búsqueda, filtros ni notificaciones de fases posteriores. La integración con IA se limita al servidor MCP descrito arriba.

Más detalles: [arquitectura](docs/architecture.md), [protocolo de impresión](docs/printer-protocol.md),
[cobertura de requisitos](docs/requirements.md) y [pruebas](docs/testing.md).

## Licencia

[GNU AGPL-3.0](LICENSE). Puedes usarlo, modificarlo y distribuirlo; si ofreces una versión
modificada como servicio en red, tienes que publicar su código fuente.
