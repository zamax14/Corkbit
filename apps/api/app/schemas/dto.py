from datetime import UTC, date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.entities import JobStatus, PostItColor, Priority, TaskStatus


class DTO(BaseModel):
    model_config = ConfigDict(from_attributes=True, str_strip_whitespace=True, extra="forbid")

    @field_validator("*", mode="after")
    @classmethod
    def utc_timestamps(cls, value: Any) -> Any:
        # SQLite drops timezone metadata; all persisted event timestamps are UTC.
        if isinstance(value, datetime) and value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value


class UserCreate(DTO):
    name: str = Field(min_length=1, max_length=100)
    email: str | None = Field(default=None, max_length=254)
    avatar: str | None = Field(default=None, max_length=500)
    color: PostItColor | None = None


class UserColorPatch(DTO):
    color: PostItColor | None


class UserOut(UserCreate):
    id: int
    active: bool


class BoardCreate(DTO):
    name: str = Field(min_length=1, max_length=100)


class BoardOut(BoardCreate):
    id: int


class BoardDelete(DTO):
    confirm: Literal[True]


class TaskCreate(DTO):
    board_id: int = Field(default=1, gt=0)
    title: str = Field(min_length=1, max_length=180)
    description: str = Field(default="", max_length=10000)
    assignee_id: int | None = Field(default=None, gt=0)
    priority: Priority = Priority.MEDIUM
    deadline: date | None = None
    status: TaskStatus = TaskStatus.BACKLOG
    print_after_save: bool = False
    printer_id: int = Field(default=1, gt=0)


class TaskPatch(DTO):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=10000)
    assignee_id: int | None = Field(default=None, gt=0)
    priority: Priority | None = None
    deadline: date | None = None
    status: TaskStatus | None = None

    @model_validator(mode="after")
    def disallow_required_null(self) -> "TaskPatch":
        for field in ("title", "description", "priority", "status"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} no puede ser null")
        return self


class TaskOut(DTO):
    id: int
    board_id: int
    title: str
    description: str
    assignee_id: int | None
    assignee: UserOut | None = None
    priority: Priority
    deadline: date | None
    status: TaskStatus
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None
    printed_at: datetime | None
    url: str
    # Señal separada de updated_at: hay novedades aunque la tarea no cambie de columna.
    comment_count: int = 0
    last_comment: str | None = None
    last_comment_at: datetime | None = None


class CommentCreate(DTO):
    body: str = Field(min_length=1, max_length=2000)


class CommentOut(DTO):
    id: int
    task_id: int
    body: str
    created_at: datetime


class BoardOverview(DTO):
    board: BoardOut
    wip_limit: int
    counts: dict[TaskStatus, int]
    tasks: list[TaskOut]


class StatusPatch(DTO):
    status: TaskStatus


class PrintRequest(DTO):
    printer_id: int = Field(default=1, gt=0)


class PrinterOut(DTO):
    id: int
    name: str
    location: str
    agent_id: str
    active: bool
    last_seen: datetime | None


class AgentIdentity(DTO):
    agent_id: str = Field(min_length=1, max_length=100)


class JobOut(DTO):
    id: int
    task_id: int | None
    printer_id: int
    status: JobStatus
    ticket: dict[str, Any]
    created_at: datetime
    started_at: datetime | None
    printed_at: datetime | None
    error: str | None
    attempts: int
    next_attempt_at: datetime | None


class ClaimOut(JobOut):
    claim_token: str


class JobPatch(AgentIdentity):
    status: Literal["PRINTED", "FAILED"]
    claim_token: str = Field(min_length=1, max_length=64)
    error: str | None = Field(default=None, max_length=2000)
