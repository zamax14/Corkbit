# Desplegar en un VPS con dominio propio

De un servidor vacío a un tablero en HTTPS con agentes de IA conectados. Cada paso trae su
comando y cómo saber que salió bien.

El agente de impresión **no** va aquí: corre en la red donde está la impresora. Ver el paso 11.

## 1. Requisitos

- Un VPS con Docker Engine y Compose v2, y los puertos 80 y 443 abiertos.
- Un dominio propio y acceso a su panel de DNS.

```bash
docker compose version    # debe decir v2.x
```

## 2. DNS: dos subdominios

Crea dos registros `A` apuntando a la IP del VPS:

| Nombre | Tipo | Valor |
|---|---|---|
| `corkbit` | A | la IP del VPS |
| `auth` | A | la IP del VPS |

```bash
dig +short corkbit.midominio.com auth.midominio.com
```

**Comprobación:** las dos líneas devuelven la IP del VPS. Si no, espera a que propague; sin esto
Caddy no puede emitir los certificados.

## 3. Clonar el repositorio

```bash
git clone https://github.com/zamax14/Corkbit.git
cd Corkbit
cp .env.example .env
```

## 4. Generar los secretos

```bash
openssl rand -hex 32    # AGENT_TOKEN
openssl rand -hex 32    # POSTGRES_PASSWORD
openssl rand -hex 32    # KEYCLOAK_ADMIN_PASSWORD
```

Uno distinto para cada variable. La contraseña del administrador de Keycloak protege la consola
que da de alta a todas las personas del tablero: no la reutilices.

## 5. Rellenar `.env`

Sustituye `midominio.com` por el tuyo. El resto de variables se quedan como vienen.

```dotenv
AGENT_TOKEN=<el primero que generaste>
POSTGRES_PASSWORD=<el segundo>
KEYCLOAK_ADMIN_PASSWORD=<el tercero>
KEYCLOAK_ADMIN=admin

CORKBIT_DOMAIN=corkbit.midominio.com
KEYCLOAK_DOMAIN=auth.midominio.com
ACME_EMAIL=tu@correo.com

PUBLIC_BASE_URL=https://corkbit.midominio.com
KEYCLOAK_URL=https://auth.midominio.com
KEYCLOAK_ADMIN_URL=https://auth.midominio.com
OIDC_ISSUER=https://auth.midominio.com/realms/corkbit
OIDC_AUDIENCE=corkbit-api
MCP_BASE_URL=https://corkbit.midominio.com/mcp/

# Caddy pasa a ser la única puerta: 8080 y 8081 dejan de publicarse en la red.
WEB_BIND=127.0.0.1
KEYCLOAK_BIND=127.0.0.1
```

`OIDC_ISSUER` debe ser la URL **pública**: el emisor de un token es el que ven los clientes, no el
nombre interno del contenedor.

## 6. Levantar el stack

```bash
just up-public
```

Caddy pide los certificados a Let's Encrypt en el primer arranque. Keycloak tarda alrededor de un
minuto en estar listo la primera vez.

```bash
just logs    # Ctrl-C para salir
```

**Comprobación:** en los logs de `caddy` aparece `certificate obtained successfully`, y:

```bash
curl -sI https://corkbit.midominio.com | head -1      # HTTP/2 200
curl -s https://auth.midominio.com/realms/corkbit | head -c 80
```

La segunda devuelve JSON con `"realm":"corkbit"`. Si devuelve 404, el realm no se importó: mira
el paso 7.

## 7. Crear la primera cuenta

El realm `corkbit` se importa solo en el primer arranque, sin ninguna persona dentro. No hay
autorregistro: las cuentas las crea el administrador.

1. Entra en `https://auth.midominio.com/admin` con `KEYCLOAK_ADMIN` y su contraseña.
2. Arriba a la izquierda, cambia del realm `master` al realm **corkbit**.
3. **Users → Add user**: nombre de usuario y correo, y guarda.
4. Pestaña **Credentials → Set password**, con *Temporary* en `Off`.

**Comprobación:** la persona aparece en **Users** dentro del realm `corkbit`, no en `master`.

## 8. Entrar al tablero

Abre `https://corkbit.midominio.com`. Te redirige a Keycloak, inicias sesión y vuelves al corcho.

**Comprobación:** el nombre de la cuenta sale en la cabecera, y en **Miembros** aparece esa
persona. Dar de alta en Keycloak es dar de alta en el tablero: la API crea el espejo local la
primera vez que el token llega.

## 9. Conectar un agente de IA

Este es el motivo de publicar el servidor: el agente gestiona el tablero con las mismas reglas y
las mismas transacciones que la web.

```bash
claude mcp add --transport http corkbit https://corkbit.midominio.com/mcp/
```

No hay token que pegar: el cliente se registra solo contra Keycloak (registro dinámico) y negocia
OAuth en el navegador.

**Comprobación**, si algo falla, recorre el flujo a mano. Son los tres saltos que da el agente:

```bash
# 1. El endpoint responde 401 y dice donde estan sus metadatos.
curl -si -X POST https://corkbit.midominio.com/mcp/ \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  | grep -i www-authenticate

# 2. Esos metadatos se sirven y apuntan a tu Keycloak.
curl -s https://corkbit.midominio.com/.well-known/oauth-protected-resource/mcp/

# 3. El realm publica su descubrimiento y admite registro dinamico.
curl -s https://auth.midominio.com/realms/corkbit/.well-known/openid-configuration \
  | grep -o '"registration_endpoint":"[^"]*"'
```

La ruta de los metadatos sale del *path* de `MCP_BASE_URL`: si cambias uno sin el otro, el paso 2
devuelve 404 y el agente se queda sin saber a qué Keycloak ir.

Por último, pídele al agente `board_overview`. Debe devolver el tablero con su conteo por estado y
su límite WIP.

## 10. Operación

**Copia de seguridad** (la base contiene tareas, comentarios y trabajos de impresión):

```bash
docker compose --env-file .env -f infra/compose.yaml exec -T db \
  pg_dump -U corkbit corkbit > corkbit-$(date +%F).sql
```

Guarda también la base `keycloak` del mismo Postgres si no quieres volver a crear las cuentas.

**Actualizar:**

```bash
git pull && just up-public
```

La API aplica las migraciones pendientes al arrancar. Los volúmenes conservan los datos.

**Logs de un servicio:**

```bash
docker compose --env-file .env -f infra/compose.yaml logs -f api
```

## 11. Endurecer

**Cortafuegos.** Solo 22, 80 y 443 hacia fuera. Con `WEB_BIND` y `KEYCLOAK_BIND` en `127.0.0.1`,
8080 y 8081 ya no salen del servidor, pero el cortafuegos es la segunda línea:

```bash
sudo ufw allow 22,80,443/tcp && sudo ufw enable
sudo ss -tlnp | grep -E '8080|8081'    # debe decir 127.0.0.1, nunca 0.0.0.0
```

**Consola de administración.** Queda accesible en `https://auth.midominio.com/admin`, protegida por
la contraseña del administrador y por la protección contra fuerza bruta que trae el realm. Para
sacarla de internet, añade esto al bloque de `{$KEYCLOAK_DOMAIN}` en `infra/caddy/Caddyfile`:

```caddy
	@admin path /admin*
	respond @admin 403
```

y llega a la consola por un túnel SSH, con `KEYCLOAK_BIND=127.0.0.1` ya puesto:

```bash
ssh -L 8081:127.0.0.1:8081 usuario@tu-vps    # luego abre http://localhost:8081/admin
```

**Impresora.** El agente ESC/POS corre en la máquina que tiene la impresora, no en el VPS. Allí,
en `apps/print-agent/.env`:

```dotenv
PRINT_API_URL=https://corkbit.midominio.com/api
PRINT_AGENT_TOKEN=<el mismo AGENT_TOKEN del VPS>
PRINT_AGENT_ID=office-agent
PRINT_TRANSPORT=network
PRINT_HOST=192.168.1.80
```

**Comprobación:** `just agent` y, en el tablero, «Reimprimir» una tarea. El trabajo pasa a
`PRINTED` en **Impresoras**.
