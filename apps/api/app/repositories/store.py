from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import Base
from app.models.entities import Task, User


def require[T: Base](db: Session, model: type[T], identifier: int) -> T:
    entity = db.get(model, identifier)
    if entity is None:
        raise HTTPException(404, "Registro no encontrado")
    return entity


def list_tasks(db: Session, board_id: int | None = None) -> list[Task]:
    query = select(Task).order_by(Task.created_at.desc(), Task.id.desc())
    if board_id is not None:
        query = query.where(Task.board_id == board_id)
    return list(db.scalars(query))


def check_assignee(db: Session, identifier: int | None) -> None:
    if identifier is not None and not require(db, User, identifier).active:
        raise HTTPException(422, "El responsable está inactivo")
