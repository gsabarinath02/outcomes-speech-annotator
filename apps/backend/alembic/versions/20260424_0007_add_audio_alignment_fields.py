"""add audio alignment fields

Revision ID: 20260424_0007
Revises: 20260424_0006
Create Date: 2026-04-24
"""

from alembic import op
import sqlalchemy as sa


revision = "20260424_0007"
down_revision = "20260424_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("annotation_tasks", sa.Column("alignment_words", sa.JSON(), nullable=True))
    op.execute("UPDATE annotation_tasks SET alignment_words = '[]' WHERE alignment_words IS NULL")
    op.alter_column("annotation_tasks", "alignment_words", nullable=False)
    op.add_column("annotation_tasks", sa.Column("alignment_transcript_hash", sa.String(length=64), nullable=True))
    op.add_column("annotation_tasks", sa.Column("alignment_model", sa.String(length=120), nullable=True))
    op.add_column("annotation_tasks", sa.Column("alignment_updated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("annotation_tasks", sa.Column("masked_audio_location", sa.Text(), nullable=True))
    op.add_column("annotation_tasks", sa.Column("masked_audio_pii_hash", sa.String(length=64), nullable=True))
    op.add_column("annotation_tasks", sa.Column("masked_audio_updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("annotation_tasks", "masked_audio_updated_at")
    op.drop_column("annotation_tasks", "masked_audio_pii_hash")
    op.drop_column("annotation_tasks", "masked_audio_location")
    op.drop_column("annotation_tasks", "alignment_updated_at")
    op.drop_column("annotation_tasks", "alignment_model")
    op.drop_column("annotation_tasks", "alignment_transcript_hash")
    op.drop_column("annotation_tasks", "alignment_words")
