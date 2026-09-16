# Autenticación con Keycloak

Diseño aprobado el 2026-09-15. Sustituye al MVP sin login descrito en el README.

## Problema

Corkbit no tiene autenticación: quien alcanza la web o la API puede crear, mover, borrar e
imprimir. Eso bastaba en una red privada de una persona. No basta para el despliegue previsto:
una Raspberry Pi 4 (8 GB) en la oficina del jefe, con la impresora térmica conectada, usada por
un equipo real y con ChatGPT hablando por MCP desde internet.

## Decisiones

| Decisión | Elección |
|---|---|
| Proveedor de identidad | Keycloak (Apache 2.0, proveedor dedicado en FastMCP 4.0.3, DCR desde 26.6.0) |
| Origen de las cuentas | Locales en Keycloak, creadas solo por el administrador |
| Autorregistro | Desactivado |
| Permisos | Planos: autenticado puede todo; no hay roles |
| Exposición | Tailnet, salvo `/mcp` y el realm de Keycloak |
| Datos existentes | Se parte de cero; no hay migración de identidades |

### Por qué Keycloak y no las alternativas

FastMCP 4.0.3 incluye `KeycloakAuthProvider`, el **único proveedor autohospedable** entre los que
trae de serie (los demás son servicios de pago en la nube). Usa Dynamic Client Registration, que
es lo que permite que ChatGPT se registre solo en vez de exigir Auth URL y Token URL a mano — el
punto exacto donde se atascó el intento anterior.

Zitadel se consideró por su consumo (~512 MB frente a ~1250 MB de Keycloak) y tiene DCR desde
julio de 2026, pero en una Pi 4 de 8 GB el margen sobra y exigiría cablear `JWTVerifier` a mano.
Authentik se descartó: no hay documentación de que soporte RFC 7591, y sin DCR se vuelve al
registro manual.

### Por qué casi nada es público

El control lo da la tailnet antes que la contraseña: un equipo que no está en ella no llega al
tablero ni a la consola de administración. Lo público se reduce a lo que ChatGPT necesita
alcanzar desde fuera.

| Superficie | Exposición | Mecanismo |
|---|---|---|
| Tablero web | Tailnet | `tailscale serve` |
| Consola de administración | Tailnet, host aparte | `--hostname-admin` |
| Endpoint `/mcp` | Pública | `tailscale funnel` |
| Realm de Keycloak (`/realms/`) | Pública | `tailscale funnel` |

**Corrección sobre la primera versión de este diseño.** El realm se planteó como tailnet y no
puede serlo: el servidor de ChatGPT necesita alcanzar el descubrimiento, el registro dinámico y
el endpoint de token desde internet, no basta con que los alcance el navegador de quien usa el
tablero. Separar por sub-rutas qué parte del realm es pública sería frágil, así que el realm
entero es público y lo que lo protege es el endurecimiento de arriba, no la oscuridad. Un
proveedor de identidad está diseñado para estar expuesto.

Lo que sí queda fuera de internet es la consola de administración, que es la superficie que de
verdad se ataca.

## Modelo de identidad

`users` pasa a ser el espejo local de las identidades de Keycloak, con una columna nueva
`subject` que guarda el claim `sub` — el identificador estable que no cambia aunque la persona
cambie de correo.

En el primer login, la API recibe un token válido con un `sub` desconocido y crea la fila
copiando nombre y correo de los claims. **Dar de alta en Keycloak es dar de alta en el tablero**;
no hay alta manual en Corkbit.

Las tareas siguen apuntando a `users.id`, no a Keycloak. Si se borra una persona del IdP, sus
tareas no quedan huérfanas: la fila local permanece, marcada como inactiva, y el histórico se
conserva.

## Los tres flujos

**Persona en el navegador.** `keycloak-js` redirige a Keycloak, la persona se autentica con
contraseña y TOTP, y vuelve con un código que se canjea por token mediante PKCE. El cliente
`corkbit-web` es público (sin secreto, que es lo correcto para un SPA) con redirect URIs exactas.
La cabecera `Authorization: Bearer` se añade en la función `request()` de
`apps/web/src/api/client.ts`, único punto por el que pasan todas las llamadas.

**ChatGPT por MCP.** `KeycloakAuthProvider` publica los metadatos de recurso protegido. ChatGPT
los descubre, se registra en `/realms/corkbit/clients-registrations/openid-connect`, manda al
usuario al login y recibe un token acotado al servidor MCP.

**Agente de impresión.** Sin cambios: sigue con `AGENT_TOKEN`. Es máquina contra máquina, sin
humano, en la misma Pi. Añadirle OIDC no compra nada y suma una pieza que puede fallar.

## Puntos de aplicación

La dependencia que valida el JWT se aplica **a nivel de router**, no ruta por ruta: así una ruta
añadida en el futuro queda protegida por omisión y hay que salirse activamente para abrirla.

Excepciones explícitas: `/health` (lo consulta el healthcheck de Docker) y las rutas etiquetadas
`agent` (tienen su propio token).

La validación comprueba firma contra el JWKS del realm, emisor, audiencia y expiración.

## Endurecimiento

Todo declarado en un fichero de importación de realm, no clicado en la consola, para que sea
reproducible y revisable:

- Autorregistro desactivado
- Recuperación de contraseña desactivada (sin correo saliente no hay flujo que abusar; el
  administrador resetea)
- TOTP obligatorio como *required action*
- Bloqueo por fuerza bruta activado
- Política de contraseñas: mínimo 12 caracteres, distinta del nombre de usuario
- Vidas de token cortas
- Políticas de registro de clientes para acotar el DCR

## Fuera de alcance

Sin roles ni permisos por usuario (`require_roles` está disponible en FastMCP si se necesitan más
adelante). Sin tablero público. Sin federación a proveedores externos. Sin autorregistro por
invitación.

## Verificación

- Pruebas de API: ruta sin token devuelve 401; token válido crea la fila de `users` en el primer
  login y la reutiliza en el segundo; `/health` y las rutas del agente siguen accesibles.
- Prueba de MCP: el servidor exige token y lo valida contra el JWKS.
- Prueba de navegador: sin sesión redirige al login; con sesión el tablero funciona igual que hoy.
- Comprobación manual: la consola de administración no responde desde fuera de la tailnet.
