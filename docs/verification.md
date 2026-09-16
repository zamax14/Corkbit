# Verificación de la entrega

Ejecutada el 8 de septiembre de 2026.

| Comprobación | Resultado |
|---|---|
| API con SQLite y migraciones reales | 17 pruebas aprobadas |
| Agente: renderizado, fallos, recuperación y acuses | 6 pruebas aprobadas |
| Chromium: CRUD, impresión, teclado, puntero, móvil y errores | 6 pruebas aprobadas |
| TypeScript y build Vite | Aprobados |
| Mypy estricto (API y agente) | Aprobado |
| Ruff y formato Python / Prettier frontend | Aprobados |
| Imágenes Docker API / web / agente | Construidas |
| PostgreSQL + Nginx + API + agente file | Arranque saludable y ticket generado |
| OpenAPI detrás de `/api` y enlace `/t/{id}` | Verificados |
| Reinicio de API | Datos conservados |
| Alembic check contra PostgreSQL | Sin diferencias de esquema |

El ensayo integrado creó una tarea y un trabajo en PostgreSQL, generó un archivo ESC/POS de aproximadamente 3.6 KB con QR y recibió `PRINTED` en el primer intento. Se comprobó la transición a Done y la persistencia tras reiniciar la API. La tarea de ensayo fue eliminada después; su ticket permanece como registro de impresión.

Se revisaron capturas del tablero a 1440 px y de la vista móvil a 390 px, sin desbordamiento horizontal en la vista móvil. Las pruebas guardan capturas en `apps/web/test-results/`.

Las pruebas de API emiten dos avisos de deprecación de dependencias (`Starlette`/`httpx` y `anyio`); no son errores del proyecto.

## Vista local de revisión

La verificación original se ejecutó con una instancia temporal y agente en modo `file`.

Para detenerla conservando sus volúmenes:

```bash
docker compose --env-file .env -f infra/compose.yaml --profile printer down
```

Para una instalación propia, sigue el README y crea tu `.env`; no reutilices las credenciales temporales de verificación.

## Pendiente de hardware

No había una impresora física conectada. Falta probar salida en papel, corte, ancho, caracteres acentuados y lectura del QR con el perfil del modelo real. El modo `file` verifica el renderizado y protocolo, pero no confirma la salida de papel.
