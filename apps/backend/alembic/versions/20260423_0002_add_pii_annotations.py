"""add pii annotations to annotation tasks

Revision ID: 20260423_0002
Revises: 20260423_0001
Create Date: 2026-04-23
"""

from alembic import op
import sqlalchemy as sa


revision = "20260423_0002"
down_revision = "20260423_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    default = sa.text("'[]'::json") if bind.dialect.name == "postgresql" else sa.text("'[]'")
    op.add_column(
        "annotation_tasks",
        sa.Column("pii_annotations", sa.JSON(), nullable=False, server_default=default),
    )


def downgrade() -> None:
    op.drop_column("annotation_tasks", "pii_annotations")
