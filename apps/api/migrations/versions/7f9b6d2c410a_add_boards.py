"""Add boards and keep existing tasks on the original board."""

import sqlalchemy as sa
from alembic import op

revision = "7f9b6d2c410a"
down_revision = "fb80f0df22fc"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    # Rebuilding SQLite's table must not reuse IDs of deleted, printed tasks.
    task_sequence = (
        connection.scalar(sa.text("SELECT seq FROM sqlite_sequence WHERE name = 'tasks'"))
        if connection.dialect.name == "sqlite"
        else None
    )
    boards = op.create_table(
        "boards",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
    )
    # Let PostgreSQL advance its sequence when creating the original board.
    op.execute(boards.insert().values(name="Mi tablero"))
    with op.batch_alter_table("tasks", table_kwargs={"sqlite_autoincrement": True}) as batch:
        batch.add_column(sa.Column("board_id", sa.Integer(), nullable=False, server_default="1"))
        batch.create_foreign_key(
            "fk_tasks_board_id", "boards", ["board_id"], ["id"], ondelete="RESTRICT"
        )
        batch.create_index("ix_tasks_board_id", ["board_id"])
    if task_sequence is not None:
        connection.execute(
            sa.text("UPDATE sqlite_sequence SET seq = :seq WHERE name = 'tasks'"),
            {"seq": task_sequence},
        )


def downgrade() -> None:
    with op.batch_alter_table("tasks", table_kwargs={"sqlite_autoincrement": True}) as batch:
        batch.drop_index("ix_tasks_board_id")
        batch.drop_constraint("fk_tasks_board_id", type_="foreignkey")
        batch.drop_column("board_id")
    op.drop_table("boards")
