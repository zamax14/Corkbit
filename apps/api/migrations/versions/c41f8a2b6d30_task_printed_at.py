"""Sello de ticket impreso en la tarea."""

import sqlalchemy as sa
from alembic import op

revision = "c41f8a2b6d30"
down_revision = "94a38c16b20e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("printed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "printed_at")
