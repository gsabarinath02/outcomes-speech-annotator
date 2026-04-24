"""add last tagger attribution to annotation tasks

Revision ID: 20260423_0003
Revises: 20260423_0002
Create Date: 2026-04-23
"""

from alembic import op
import sqlalchemy as sa


revision = "20260423_0003"
down_revision = "20260423_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    op.add_column(
        "annotation_tasks",
        sa.Column("last_tagger_id", sa.String(length=36), nullable=True),
    )
    if bind.dialect.name != "sqlite":
        op.create_foreign_key(
            "fk_annotation_tasks_last_tagger_id_users",
            "annotation_tasks",
            "users",
            ["last_tagger_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index(
        "ix_annotation_tasks_last_tagger_id",
        "annotation_tasks",
        ["last_tagger_id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.drop_index("ix_annotation_tasks_last_tagger_id", table_name="annotation_tasks")
    if bind.dialect.name != "sqlite":
        op.drop_constraint("fk_annotation_tasks_last_tagger_id_users", "annotation_tasks", type_="foreignkey")
    op.drop_column("annotation_tasks", "last_tagger_id")
