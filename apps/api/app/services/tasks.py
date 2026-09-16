from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.entities import Board, Comment, Task, TaskStatus, User, utcnow
from app.repositories.store import check_assignee, require
from app.schemas.dto import TaskCreate, TaskOut, TaskPatch


def present_task(db: Session, task: Task) -> TaskOut:
    # ponytail: una consulta de comentarios por tarea. Un corcho es fisico y el numero de
    # post-its esta acotado; si algun dia pesa, una sola consulta agrupada por task_id lo cubre.
    latest = db.scalars(
        select(Comment).where(Comment.task_id == task.id).order_by(Comment.id.desc()).limit(1)
    ).first()
    total = db.scalar(select(func.count(Comment.id)).where(Comment.task_id == task.id)) or 0
    return TaskOut.model_validate(
        {
            **{column.name: getattr(task, column.name) for column in Task.__table__.columns},
            "assignee": db.get(User, task.assignee_id) if task.assignee_id else None,
            "url": f"{str(get_settings().public_base_url).rstrip('/')}/t/{task.id}",
            "comment_count": total,
            "last_comment": latest.body if latest else None,
            "last_comment_at": latest.created_at if latest else None,
        }
    )


def create_task(db: Session, data: TaskCreate) -> Task:
    require(db, Board, data.board_id)
    check_assignee(db, data.assignee_id)
    task = Task(**data.model_dump(exclude={"print_after_save", "printer_id"}))
    if data.status == TaskStatus.DONE:
        task.completed_at = utcnow()
    db.add(task)
    db.flush()
    return task


def update_task(db: Session, identifier: int, data: TaskPatch) -> Task:
    task = require(db, Task, identifier)
    values = data.model_dump(exclude_unset=True)
    if "assignee_id" in values:
        check_assignee(db, values["assignee_id"])
    if "status" in values and values["status"] != task.status:
        task.completed_at = utcnow() if values["status"] == TaskStatus.DONE else None
    for key, value in values.items():
        setattr(task, key, value)
    if values:
        task.updated_at = utcnow()
    db.flush()
    return task
