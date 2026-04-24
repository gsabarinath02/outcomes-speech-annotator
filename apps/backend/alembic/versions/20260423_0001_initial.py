"""initial schema

Revision ID: 20260423_0001
Revises:
Create Date: 2026-04-23
"""

from alembic import op
import sqlalchemy as sa


revision = "20260423_0001"
down_revision = None
branch_labels = None
depends_on = None


role_enum = sa.Enum("ADMIN", "ANNOTATOR", "REVIEWER", name="role_enum")
upload_job_status_enum = sa.Enum(
    "UPLOADED", "VALIDATED", "VALIDATION_FAILED", "IMPORTED", "IMPORT_FAILED", name="upload_job_status_enum"
)
task_status_enum = sa.Enum(
    "Not Started",
    "In Progress",
    "Completed",
    "Needs Review",
    "Reviewed",
    "Approved",
    name="task_status_enum",
)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", role_enum, nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_email", "users", ["email"])

    op.create_table(
        "upload_files",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("original_filename", sa.String(length=500), nullable=False),
        sa.Column("stored_path", sa.String(length=1000), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=True),
        sa.Column("uploaded_by_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "upload_jobs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("upload_file_id", sa.String(length=36), nullable=False),
        sa.Column("created_by_id", sa.String(length=36), nullable=False),
        sa.Column("status", upload_job_status_enum, nullable=False),
        sa.Column("mapping_json", sa.JSON(), nullable=True),
        sa.Column("preview_row_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["upload_file_id"], ["upload_files.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_upload_jobs_upload_file_id", "upload_jobs", ["upload_file_id"])

    op.create_table(
        "upload_job_errors",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("upload_job_id", sa.String(length=36), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("field_name", sa.String(length=255), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=False),
        sa.Column("raw_value", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["upload_job_id"], ["upload_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_upload_job_errors_upload_job_id", "upload_job_errors", ["upload_job_id"])

    op.create_table(
        "annotation_tasks",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("external_id", sa.String(length=255), nullable=False),
        sa.Column("upload_job_id", sa.String(length=36), nullable=False),
        sa.Column("file_location", sa.Text(), nullable=False),
        sa.Column("final_transcript", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", task_status_enum, nullable=False),
        sa.Column("speaker_gender", sa.String(length=50), nullable=True),
        sa.Column("speaker_role", sa.String(length=100), nullable=True),
        sa.Column("language", sa.String(length=100), nullable=True),
        sa.Column("channel", sa.String(length=100), nullable=True),
        sa.Column("duration_seconds", sa.Numeric(10, 3), nullable=True),
        sa.Column("custom_metadata", sa.JSON(), nullable=False),
        sa.Column("original_row", sa.JSON(), nullable=False),
        sa.Column("assignee_id", sa.String(length=36), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("last_saved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["assignee_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["upload_job_id"], ["upload_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("upload_job_id", "external_id", name="uq_annotation_tasks_upload_external"),
    )
    op.create_index("ix_annotation_tasks_upload_job_id", "annotation_tasks", ["upload_job_id"])
    op.create_index("ix_annotation_tasks_status", "annotation_tasks", ["status"])
    op.create_index("ix_annotation_tasks_assignee_id", "annotation_tasks", ["assignee_id"])
    op.create_index("ix_annotation_tasks_updated_at", "annotation_tasks", ["updated_at"])
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "CREATE INDEX ix_annotation_tasks_custom_metadata_gin ON annotation_tasks USING gin ((custom_metadata::jsonb))"
        )
    else:
        op.create_index("ix_annotation_tasks_custom_metadata_gin", "annotation_tasks", ["custom_metadata"])

    op.create_table(
        "task_transcript_variants",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("task_id", sa.String(length=36), nullable=False),
        sa.Column("source_key", sa.String(length=100), nullable=False),
        sa.Column("source_label", sa.String(length=150), nullable=False),
        sa.Column("transcript_text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["annotation_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("task_id", "source_key", name="uq_task_transcript_variant_task_source"),
    )
    op.create_index("ix_task_transcript_variants_task_id", "task_transcript_variants", ["task_id"])

    op.create_table(
        "task_status_history",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("task_id", sa.String(length=36), nullable=False),
        sa.Column("old_status", task_status_enum, nullable=True),
        sa.Column("new_status", task_status_enum, nullable=False),
        sa.Column("changed_by_id", sa.String(length=36), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["changed_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["task_id"], ["annotation_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_task_status_history_task_id", "task_status_history", ["task_id"])

    op.create_table(
        "task_audit_logs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("task_id", sa.String(length=36), nullable=False),
        sa.Column("actor_user_id", sa.String(length=36), nullable=False),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("changed_fields", sa.JSON(), nullable=False),
        sa.Column("previous_values", sa.JSON(), nullable=False),
        sa.Column("new_values", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["task_id"], ["annotation_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_task_audit_logs_task_id", "task_audit_logs", ["task_id"])


def downgrade() -> None:
    op.drop_index("ix_task_audit_logs_task_id", table_name="task_audit_logs")
    op.drop_table("task_audit_logs")
    op.drop_index("ix_task_status_history_task_id", table_name="task_status_history")
    op.drop_table("task_status_history")
    op.drop_index("ix_task_transcript_variants_task_id", table_name="task_transcript_variants")
    op.drop_table("task_transcript_variants")
    op.drop_index("ix_annotation_tasks_custom_metadata_gin", table_name="annotation_tasks")
    op.drop_index("ix_annotation_tasks_updated_at", table_name="annotation_tasks")
    op.drop_index("ix_annotation_tasks_assignee_id", table_name="annotation_tasks")
    op.drop_index("ix_annotation_tasks_status", table_name="annotation_tasks")
    op.drop_index("ix_annotation_tasks_upload_job_id", table_name="annotation_tasks")
    op.drop_table("annotation_tasks")
    op.drop_index("ix_upload_job_errors_upload_job_id", table_name="upload_job_errors")
    op.drop_table("upload_job_errors")
    op.drop_index("ix_upload_jobs_upload_file_id", table_name="upload_jobs")
    op.drop_table("upload_jobs")
    op.drop_table("upload_files")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")

    bind = op.get_bind()
    task_status_enum.drop(bind, checkfirst=True)
    upload_job_status_enum.drop(bind, checkfirst=True)
    role_enum.drop(bind, checkfirst=True)
