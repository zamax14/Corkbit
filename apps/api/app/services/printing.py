from datetime import timedelta
from secrets import token_hex

from fastapi import HTTPException
from sqlalchemy import and_, or_, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.entities import JobStatus, Printer, PrintJob, Task, utcnow
from app.repositories.store import require
from app.schemas.dto import JobPatch
from app.services.tasks import present_task


def enqueue(db: Session, task: Task, printer_id: int) -> PrintJob:
    printer = require(db, Printer, printer_id)
    if not printer.active:
        raise HTTPException(409, "La impresora está desactivada")
    job = PrintJob(
        task_id=task.id,
        printer_id=printer_id,
        ticket=present_task(db, task).model_dump(mode="json"),
    )
    db.add(job)
    db.flush()
    return job


def identify(db: Session, printer_id: int, agent_id: str) -> Printer:
    printer = require(db, Printer, printer_id)
    if not printer.active or printer.agent_id != agent_id:
        raise HTTPException(403, "El agente no corresponde a esta impresora activa")
    return printer


def eligible() -> object:
    return or_(
        PrintJob.status == JobStatus.PENDING,
        and_(
            PrintJob.status == JobStatus.FAILED,
            PrintJob.next_attempt_at.is_not(None),
            PrintJob.next_attempt_at <= utcnow(),
        ),
    )


def claim(db: Session, printer_id: int, agent_id: str) -> PrintJob | None:
    settings = get_settings()
    printer = identify(db, printer_id, agent_id)
    printer.last_seen = utcnow()
    # Unknown physical outcome: do not automatically print expired leases again.
    db.execute(
        update(PrintJob)
        .where(
            PrintJob.printer_id == printer_id,
            PrintJob.status == JobStatus.PRINTING,
            PrintJob.started_at < utcnow() - timedelta(seconds=settings.print_lease_seconds),
        )
        .values(
            status=JobStatus.FAILED,
            next_attempt_at=None,
            error="Agente desconectado: comprueba el ticket antes de reimprimir.",
        )
    )
    candidate = db.scalar(
        select(PrintJob.id)
        .where(
            PrintJob.printer_id == printer_id,
            eligible(),  # type: ignore[arg-type]
        )
        .order_by(PrintJob.id)
        .limit(1)
    )
    if candidate is None:
        db.commit()
        return None
    token = token_hex(24)
    # Compare-and-set prevents two concurrent agents claiming the same job.
    claimed_id = db.scalar(
        update(PrintJob)
        .where(
            PrintJob.id == candidate,
            eligible(),  # type: ignore[arg-type]
        )
        .values(
            status=JobStatus.PRINTING,
            claim_token=token,
            started_at=utcnow(),
            attempts=PrintJob.attempts + 1,
            next_attempt_at=None,
            error=None,
        )
        .returning(PrintJob.id)
    )
    db.commit()
    return db.get(PrintJob, claimed_id) if claimed_id else None


def acknowledge(db: Session, identifier: int, data: JobPatch) -> PrintJob:
    job = require(db, PrintJob, identifier)
    identify(db, job.printer_id, data.agent_id)
    if data.claim_token != job.claim_token:
        raise HTTPException(409, "Reserva de impresión inválida")
    if job.status == data.status:
        return job  # Idempotent delivery of a persisted agent acknowledgement.
    if job.status != JobStatus.PRINTING:
        raise HTTPException(409, "El trabajo ya no está en impresión")
    now = utcnow()
    retry_at = None
    if data.status == JobStatus.FAILED and job.attempts < get_settings().print_max_attempts:
        retry_at = now + timedelta(seconds=5 * 2 ** (job.attempts - 1))
    changed = db.scalar(
        update(PrintJob)
        .where(
            PrintJob.id == identifier,
            PrintJob.status == JobStatus.PRINTING,
            PrintJob.claim_token == data.claim_token,
        )
        .values(
            status=data.status,
            printed_at=now if data.status == JobStatus.PRINTED else None,
            error=(data.error or "Error de impresión") if data.status == JobStatus.FAILED else None,
            next_attempt_at=retry_at,
        )
        .returning(PrintJob.id)
    )
    if changed is None:
        raise HTTPException(409, "El trabajo cambió de estado")
    if data.status == JobStatus.PRINTED and job.task_id:
        db.execute(update(Task).where(Task.id == job.task_id).values(printed_at=now))
    db.commit()
    db.refresh(job)
    return job
