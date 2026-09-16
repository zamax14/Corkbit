"""Member post-it colors and non-reusable board links."""

import sqlalchemy as sa
from alembic import op

revision = "94a38c16b20e"
down_revision = "7f9b6d2c410a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("color", sa.String(16), nullable=True))
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table(
            "boards", recreate="always", table_kwargs={"sqlite_autoincrement": True}
        ):
            pass


def downgrade() -> None:
    op.drop_column("users", "color")
