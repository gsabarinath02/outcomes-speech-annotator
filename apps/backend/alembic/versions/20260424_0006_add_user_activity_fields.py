"""add user activity fields

Revision ID: 20260424_0006
Revises: 20260424_0005
Create Date: 2026-04-24
"""

from alembic import op
import sqlalchemy as sa


revision = "20260424_0006"
down_revision = "20260424_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_users_last_login_at", "users", ["last_login_at"])
    op.create_index("ix_users_last_activity_at", "users", ["last_activity_at"])


def downgrade() -> None:
    op.drop_index("ix_users_last_activity_at", table_name="users")
    op.drop_index("ix_users_last_login_at", table_name="users")
    op.drop_column("users", "last_activity_at")
    op.drop_column("users", "last_login_at")
