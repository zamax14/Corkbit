from secrets import compare_digest
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.auth import current_user
from app.config import get_settings
from app.db.session import get_db
from app.models.entities import (
    Board,
    Comment,
    JobStatus,
    Printer,
    PrintJob,
    Task,
    TaskStatus,
    User,
    utcnow,
)
from app.repositories.store import list_tasks, require
from app.schemas.dto import (
    AgentIdentity,
    BoardCreate,
    BoardDelete,
    BoardOut,
    BoardOverview,
    ClaimOut,
    CommentCreate,
    CommentOut,
    JobOut,
    JobPatch,
    PrinterOut,
    PrintRequest,
    StatusPatch,
    TaskCreate,
    TaskOut,
    TaskPatch,
    UserColorPatch,
    UserOut,
)
from app.services import printing, tasks


def agent_auth(x_agent_token: Annotated[str, Header()] = "") -> None:
    expected = get_settings().agent_token
    if not expected or not compare_digest(x_agent_token.encode(), expected.encode()):
        raise HTTPException(401, "Configura un token válido para el agente")


# Tres routers, por quién llama. La dependencia va en el router y no en cada decorador: así una
# ruta añadida dentro de seis meses nace protegida y hay que salirse a propósito para abrirla.
router = APIRouter(dependencies=[Depends(current_user)])
public_router = APIRouter()
agent_router = APIRouter(dependencies=[Depends(agent_auth)], tags=["agent"])
DB = Annotated[Session, Depends(get_db)]


@public_router.get("/health", tags=["system"])
def health(db: DB) -> dict[str, str]:
    db.execute(select(1))
    return {"status": "ok"}


@public_router.get("/auth-config", tags=["system"])
def auth_config() -> dict[str, str]:
    """Datos que el navegador necesita para iniciar sesión. Son públicos por definición en OIDC:
    el emisor y el id de un cliente público no son secretos, y servirlos aquí evita hornear la
    URL de Keycloak en el bundle y tener que recompilar cada vez que cambie."""
    settings = get_settings()
    return {"issuer": settings.oidc_issuer, "client_id": settings.oidc_client_id}


@router.get("/settings", tags=["system"])
def settings() -> dict[str, int]:
    return {"wip_limit": get_settings().wip_limit}


@router.get("/users", response_model=list[UserOut], tags=["users"])
def users_list(db: DB) -> list[User]:
    """Miembros del espacio: solo quien tiene cuenta en Keycloak.

    Dar de alta en Keycloak es dar de alta en el tablero. Una fila sin `subject` es un resto del
    modelo anterior, cuando los miembros se tecleaban a mano, y no corresponde a nadie real.
    """
    return list(
        db.scalars(
            select(User).where(User.active.is_(True), User.subject.is_not(None)).order_by(User.name)
        )
    )


@router.patch("/users/{user_id}", response_model=UserOut, tags=["users"])
def users_color(user_id: int, data: UserColorPatch, db: DB) -> User:
    """Cambia el color de post-it de un miembro (sky, sage, cork, rose, lilac, butter)."""
    user = require(db, User, user_id)
    user.color = data.color
    db.commit()
    db.refresh(user)
    return user


@router.get("/boards", response_model=list[BoardOut], tags=["boards"])
def boards_list(db: DB) -> list[Board]:
    """Lista los tableros disponibles."""
    return list(db.scalars(select(Board).order_by(Board.id)))


@router.post("/boards", response_model=BoardOut, status_code=201, tags=["boards"])
def boards_create(data: BoardCreate, db: DB) -> Board:
    """Crea un tablero nuevo."""
    board = Board(**data.model_dump())
    db.add(board)
    db.commit()
    db.refresh(board)
    return board


@router.delete("/boards/{board_id}", status_code=204, tags=["boards"])
def boards_delete(board_id: int, confirmation: BoardDelete, db: DB) -> Response:
    """Elimina un tablero y todas sus tareas; requiere confirm=true y es irreversible."""
    board = require(db, Board, board_id)
    # Keep print snapshots; their task foreign keys become NULL, as with single-task deletion.
    db.execute(delete(Task).where(Task.board_id == board_id))
    db.delete(board)
    db.commit()
    return Response(status_code=204)


@router.get("/boards/{board_id}/overview", response_model=BoardOverview, tags=["boards"])
def boards_overview(board_id: int, db: DB) -> BoardOverview:
    """Resumen del tablero: conteo por estado, límite WIP y tareas con responsable."""
    board = require(db, Board, board_id)
    items = [tasks.present_task(db, task) for task in list_tasks(db, board_id)]
    return BoardOverview(
        board=BoardOut.model_validate(board),
        wip_limit=get_settings().wip_limit,
        counts={status: sum(item.status == status for item in items) for status in TaskStatus},
        tasks=items,
    )


@router.get("/tasks", response_model=list[TaskOut], tags=["tasks"])
def tasks_list(db: DB, board_id: Annotated[int | None, Query(gt=0)] = None) -> list[TaskOut]:
    """Lista tareas, opcionalmente de un solo tablero, de la más reciente a la más antigua."""
    if board_id is not None:
        require(db, Board, board_id)
    return [tasks.present_task(db, task) for task in list_tasks(db, board_id)]


@router.post("/tasks", response_model=TaskOut, status_code=201, tags=["tasks"])
def tasks_create(data: TaskCreate, db: DB) -> TaskOut:
    """Crea una tarea; con print_after_save=true imprime su ticket en la misma transacción."""
    task = tasks.create_task(db, data)
    if data.print_after_save:
        printing.enqueue(db, task, data.printer_id)
    db.commit()
    return tasks.present_task(db, task)


@router.get("/tasks/{task_id}", response_model=TaskOut, tags=["tasks"])
def tasks_get(task_id: int, db: DB) -> TaskOut:
    """Devuelve una tarea con su responsable y la URL de su QR."""
    return tasks.present_task(db, require(db, Task, task_id))


@router.patch("/tasks/{task_id}", response_model=TaskOut, tags=["tasks"])
def tasks_patch(task_id: int, data: TaskPatch, db: DB) -> TaskOut:
    """Actualiza los campos enviados de una tarea; los omitidos no cambian."""
    task = tasks.update_task(db, task_id, data)
    db.commit()
    return tasks.present_task(db, task)


@router.patch("/tasks/{task_id}/status", response_model=TaskOut, tags=["tasks"])
def tasks_status(task_id: int, data: StatusPatch, db: DB) -> TaskOut:
    """Mueve una tarea entre BACKLOG, WIP y DONE."""
    return tasks_patch(task_id, TaskPatch(status=data.status), db)


@router.delete("/tasks/{task_id}", status_code=204, tags=["tasks"])
def tasks_delete(task_id: int, db: DB) -> Response:
    """Elimina una tarea; sus tickets ya impresos se conservan sin referencia."""
    db.delete(require(db, Task, task_id))
    db.commit()
    return Response(status_code=204)


@router.get("/tasks/{task_id}/comments", response_model=list[CommentOut], tags=["comments"])
def comments_list(task_id: int, db: DB) -> list[Comment]:
    """Timeline de la tarea, del comentario más reciente al más antiguo."""
    require(db, Task, task_id)
    return list(
        db.scalars(select(Comment).where(Comment.task_id == task_id).order_by(Comment.id.desc()))
    )


@router.post(
    "/tasks/{task_id}/comments", response_model=CommentOut, status_code=201, tags=["comments"]
)
def comments_create(task_id: int, data: CommentCreate, db: DB) -> Comment:
    """Anota un avance en la tarea. No modifica la tarea: updated_at se queda como estaba."""
    require(db, Task, task_id)
    comment = Comment(task_id=task_id, body=data.body)
    db.add(comment)
    db.commit()
    return comment


@router.delete("/comments/{comment_id}", status_code=204, tags=["comments"])
def comments_delete(comment_id: int, db: DB) -> Response:
    """Borra un comentario mal registrado; no toca la tarea."""
    db.delete(require(db, Comment, comment_id))
    db.commit()
    return Response(status_code=204)


@router.post("/tasks/{task_id}/print", response_model=JobOut, status_code=201, tags=["printing"])
def tasks_print(task_id: int, db: DB, data: PrintRequest = PrintRequest()) -> PrintJob:
    """Encola un ticket térmico de 80 mm de la tarea; consume papel real."""
    job = printing.enqueue(db, require(db, Task, task_id), data.printer_id)
    db.commit()
    return job


@router.post("/tasks/{task_id}/printed", response_model=TaskOut, tags=["printing"])
def tasks_printed(task_id: int, db: DB) -> TaskOut:
    """Marca que la tarea ya tiene ticket en papel; sello informativo, no impide reimprimir."""
    task = require(db, Task, task_id)
    task.printed_at = utcnow()
    db.commit()
    return tasks.present_task(db, task)


@router.get("/printers", response_model=list[PrinterOut], tags=["printing"])
def printers_list(db: DB) -> list[Printer]:
    """Lista las impresoras registradas y su último heartbeat."""
    return list(db.scalars(select(Printer).order_by(Printer.id)))


@agent_router.post("/printers/{printer_id}/heartbeat", response_model=PrinterOut)
def heartbeat(printer_id: int, data: AgentIdentity, db: DB) -> Printer:
    printer = printing.identify(db, printer_id, data.agent_id)
    printer.last_seen = utcnow()
    db.commit()
    return printer


@router.get("/print-jobs", response_model=list[JobOut], tags=["printing"])
def jobs_list(
    db: DB, limit: Annotated[int, Query(ge=1, le=200)] = 50, offset: Annotated[int, Query(ge=0)] = 0
) -> list[PrintJob]:
    """Lista los trabajos de impresión recientes con su estado y reintentos."""
    return list(
        db.scalars(select(PrintJob).order_by(PrintJob.id.desc()).offset(offset).limit(limit))
    )


@router.get("/print-jobs/pending", response_model=list[JobOut], tags=["printing"])
def jobs_pending(db: DB, printer_id: int = 1) -> list[PrintJob]:
    return list(
        db.scalars(
            select(PrintJob)
            .where(
                PrintJob.printer_id == printer_id,
                PrintJob.status == JobStatus.PENDING,
            )
            .order_by(PrintJob.id)
            .limit(100)
        )
    )


@agent_router.post(
    "/printers/{printer_id}/claim",
    response_model=ClaimOut | None,
)
def jobs_claim(printer_id: int, data: AgentIdentity, db: DB) -> PrintJob | None:
    return printing.claim(db, printer_id, data.agent_id)


@agent_router.patch(
    "/print-jobs/{job_id}",
    response_model=JobOut,
)
def jobs_ack(job_id: int, data: JobPatch, db: DB) -> PrintJob:
    return printing.acknowledge(db, job_id, data)
