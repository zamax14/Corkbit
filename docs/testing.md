# Pruebas

Tres suites, una por capa. `just test` las ejecuta todas.

```bash
cd apps/web && npx playwright install chromium   # solo la primera vez
just test
```

## Qué cubre cada una

| Suite | Comando | Qué verifica |
|---|---|---|
| API | `just test-api` | CRUD, fechas de cierre, nulabilidad, transacciones de guardar+imprimir, reservas concurrentes de la cola, autenticación de personas y de agentes, tableros, comentarios y las herramientas MCP. |
| Agente | `just test-agent` | Renderizado ESC/POS, generación real del archivo con QR, fallos de impresión, recuperación tras caída y acuses con reserva vencida. |
| Navegador | `just test-web` | Arrastre con puntero y teclado, vista móvil, QR de `/t/{id}`, impresión y errores de guardado. |

Las pruebas de API crean bases temporales y las migran con Alembic; nunca tocan
`apps/api/corkbit.db`. Las de navegador levantan su propia API en el puerto `8011` y Vite en el
`5174`, con una base en un directorio temporal.

## Análisis estático

```bash
just lint           # ruff, mypy estricto y prettier en las tres aplicaciones
just build          # lint + compilación de TypeScript y bundle de Vite
just check-schema   # alembic check: los modelos y las migraciones no divergen
```

## Lo que las pruebas no cubren

**Salida física en papel.** El modo `file` del agente verifica el protocolo y el renderizado
—genera un `.bin` ESC/POS real con su QR— pero no confirma que salga papel. Queda por probar con
la impresora real: corte, ancho de columna, caracteres acentuados y lectura del QR con el perfil
del modelo concreto. ESC/POS confirma el envío de bytes, no la impresión.

**Despliegue público.** Las guías de [Tailscale](deploy-tailscale.md) y [VPS](deploy-vps.md)
llevan comprobaciones en cada paso, pero no hay pruebas automatizadas de la emisión de
certificados ni del flujo OAuth de punta a punta.
