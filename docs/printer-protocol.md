# Protocolo del agente

## Registro y autenticación

La CLI configura una impresora inicial con ID `1` e identidad `office-agent`. Otras impresoras se registran con `python -m app.cli printer`. Todas las operaciones de escritura del agente requieren `X-Agent-Token`, igual a `AGENT_TOKEN` del servidor. Si este valor está vacío, la API rechaza al agente. No coloques este secreto en el frontend.

## Secuencia

1. `POST /printers/{id}/heartbeat` con `{"agent_id":"office-agent"}` actualiza `last_seen`. La UI la considera conectada durante 60 segundos.
2. `POST /printers/{id}/claim` con el mismo cuerpo devuelve un trabajo y su `claim_token`, o `null`. La reserva se toma atómicamente en SQL. `GET /print-jobs/pending` es únicamente informativo y **no reserva** trabajos.
3. El agente guarda en disco el ID y token antes de enviar bytes. Renderiza la instantánea `ticket`, QR y corte para papel de 80 mm.
4. Guarda el resultado en `inflight.json` antes de enviar el acuse.
5. `PATCH /print-jobs/{id}`:

```json
{
  "agent_id": "office-agent",
  "claim_token": "token devuelto por claim",
  "status": "PRINTED",
  "error": null
}
```

6. Elimina el acuse local solo después de recibir confirmación. Los acuses son idempotentes para la misma reserva y estado.

## Estados y recuperación

```text
PENDING → PRINTING → PRINTED
                  ↘ FAILED → PRINTING (reintento programado)
```

Un error explícito de impresión produce `FAILED`. Si quedan intentos, la API agenda un reintento con espera exponencial (5 s, 10 s); `PRINT_MAX_ATTEMPTS=3` por defecto. El agente recupera tanto pendientes como fallidos cuyo reintento ya vence. Los fallidos terminales se ven en la cola; desde la tarea se solicita una nueva reimpresión.

Una reserva sin resultado durante `PRINT_LEASE_SECONDS=120` se marca fallida cuando el agente vuelve a consultar. **No** se programa reintento automático porque el papel pudo haberse impreso. No existe un recolector externo mientras ningún agente consulta; hasta la próxima consulta puede seguir figurando como `PRINTING`.

Si el proceso muere con `inflight.json` en `PRINTING`, se archiva como `uncertain-{id}.json`, sin reenviar el ticket. Si muere después de guardar `PRINTED`/`FAILED`, al reiniciar reenvía solo el acuse. Si el servidor responde 409 porque la reserva venció, el resultado se archiva como `unacknowledged-{id}.json` para revisión manual.

El envío ESC/POS no ofrece una transacción junto con la base de datos. Un fallo durante la escritura puede imprimir parcialmente; un reintento explícito de error podría duplicar papel. `PRINTED` significa que el driver aceptó el envío (o que se generó el archivo en modo `file`), no confirmación del sensor de salida.

## Configuración

Consulta `apps/print-agent/.env.example`. El transporte `file` escribe comandos `.bin` y texto `.txt`. El QR se renderiza como imagen usando `python-escpos`, para no depender del soporte QR nativo de la impresora. El texto de tareas se limpia de caracteres de control antes de pasarlo a ESC/POS.

El agente usa timeout HTTP de 15 segundos, reconexión con espera creciente hasta 30 segundos, heartbeat por ciclo y salida limpia con SIGINT/SIGTERM. Usa un único proceso por directorio de estado; no compartas el mismo directorio entre agentes.
