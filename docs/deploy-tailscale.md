# Desplegar en una tailnet con Tailscale

Para tener el tablero en casa o en la oficina —una Raspberry Pi, un NAS, un portátil viejo— sin
abrir un solo puerto del router y sin dominio propio.

El reparto es: **el tablero se queda dentro de la tailnet** y solo sale a internet lo que un agente
de IA externo necesita alcanzar. Si prefieres un servidor público con dominio propio, usa
[la guía del VPS](deploy-vps.md).

## 1. Instalar Tailscale en el servidor

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

**Comprobación:** `tailscale status` lista la máquina, y `tailscale status --json | grep DNSName`
te da su nombre `.ts.net`. Ese nombre es el que usarás en todo lo que viene.

## 2. Habilitar HTTPS y Funnel

En la [consola de administración de Tailscale](https://login.tailscale.com/admin/dns), activa
**MagicDNS** y **HTTPS Certificates**. En **Access controls**, el nodo necesita el atributo
`funnel` en la sección `nodeAttrs`.

```bash
sudo tailscale cert tu-host.ts.net
```

**Comprobación:** el comando emite el certificado sin error. Si se queja de permisos, falta el
atributo `funnel`.

## 3. Rellenar `.env`

```bash
cp .env.example .env
openssl rand -hex 32    # AGENT_TOKEN
openssl rand -hex 32    # KEYCLOAK_ADMIN_PASSWORD
```

Sustituye `tu-host.ts.net` por tu nombre real:

```dotenv
AGENT_TOKEN=<el primero que generaste>
KEYCLOAK_ADMIN_PASSWORD=<el segundo>

PUBLIC_BASE_URL=https://tu-host.ts.net
KEYCLOAK_URL=https://tu-host.ts.net
OIDC_ISSUER=https://tu-host.ts.net/realms/corkbit
OIDC_AUDIENCE=corkbit-api
MCP_BASE_URL=https://tu-host.ts.net/mcp/

# La consola de administracion se queda dentro de la tailnet, nunca en el Funnel.
KEYCLOAK_ADMIN_URL=http://tu-host:8081
```

`OIDC_ISSUER` tiene que ser la URL pública: el emisor de un token es el que ven los clientes, no
el nombre interno del contenedor.

## 4. Levantar el stack

```bash
just up
```

Keycloak tarda alrededor de un minuto la primera vez.

**Comprobación:** `curl -sI http://localhost:8080 | head -1` devuelve `HTTP/1.1 200 OK`.

## 5. Servir el tablero dentro de la tailnet

```bash
sudo tailscale serve --bg --set-path / http://localhost:8080
```

**Comprobación:** desde otro equipo de la tailnet, `https://tu-host.ts.net` carga el corcho.

## 6. Publicar solo lo que el agente de IA necesita

Son cuatro rutas, no una, y cada una cumple un papel en el flujo OAuth. Si falta cualquiera, el
agente no llega a autenticarse:

```bash
sudo tailscale funnel --bg --yes --set-path /mcp         http://localhost:8080/api/mcp/
sudo tailscale funnel --bg --yes --set-path /.well-known http://localhost:8080/.well-known
sudo tailscale funnel --bg --yes --set-path /realms      http://localhost:8081/realms
sudo tailscale funnel --bg --yes --set-path /resources   http://localhost:8081/resources
```

| Ruta | Para qué |
|---|---|
| `/mcp` | El servidor MCP: las herramientas del tablero. |
| `/.well-known` | Metadatos de recurso protegido (RFC 9728). El agente los lee del 401 para saber a qué Keycloak ir. |
| `/realms` | Descubrimiento OIDC, registro dinámico de clientes y canje de tokens. |
| `/resources` | Los estilos de la página de login; sin ellos sale rota. |

El tablero (`/`) sigue en `serve`, no en `funnel`: desde internet no se llega a él.

**Comprobación:**

```bash
tailscale funnel status
curl -s https://tu-host.ts.net/realms/corkbit | head -c 80    # JSON con "realm":"corkbit"
curl -sI https://tu-host.ts.net/ | head -1                    # no debe servir el tablero
```

## 7. Crear la primera cuenta

El realm `corkbit` se importa solo en el primer arranque, vacío. No hay autorregistro.

1. Desde la tailnet, abre `http://tu-host:8081/admin` e inicia sesión con `KEYCLOAK_ADMIN`.
2. Cambia del realm `master` al realm **corkbit**.
3. **Users → Add user**, guarda, y en **Credentials → Set password** deja *Temporary* en `Off`.

**Comprobación:** abre `https://tu-host.ts.net`, inicia sesión y comprueba que la persona aparece
en **Miembros**.

## 8. Conectar un agente de IA

```bash
claude mcp add --transport http corkbit https://tu-host.ts.net/mcp/
```

No hay token que pegar: el cliente se registra solo contra Keycloak y negocia OAuth.

**Comprobación:** pídele `board_overview`. Debe devolver el tablero con su conteo por estado.

## 9. La impresora

El agente ESC/POS corre en la máquina que tiene la impresora. Si es el mismo servidor, `just agent`
con `PRINT_API_URL=http://localhost:8080/api`. Si es otro equipo de la tailnet, usa el nombre
`.ts.net` del servidor. En ambos casos, el mismo `AGENT_TOKEN`.

**Comprobación:** «Reimprimir» una tarea; el trabajo pasa a `PRINTED` en **Impresoras**.
