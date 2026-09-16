"""Enlace con la identidad de Keycloak (claim `sub`)."""

import sqlalchemy as sa
from alembic import op

revision = "b8e24f1c7a63"
down_revision = "a3d71c95e402"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable: los miembros creados antes del login no tienen identidad todavia. Se enlazan
    # solos la primera vez que esa persona entra, o quedan como etiquetas sin cuenta.
    op.add_column("users", sa.Column("subject", sa.String(length=255), nullable=True))
    op.create_index("ix_users_subject", "users", ["subject"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_subject", table_name="users")
    op.drop_column("users", "subject")
