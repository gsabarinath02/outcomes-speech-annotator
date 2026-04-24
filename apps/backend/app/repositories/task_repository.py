from datetime import UTC, date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models.enums import TaskStatusEnum
from app.models.task import AnnotationTask, TaskAuditLog, TaskStatusHistory, TaskTranscriptVariant
from app.models.user import User


def _json_safe(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


class TaskRepository:
    def __init__(self, db: Session):
        self.db = db

    def create_task(
        self,
        *,
        upload_job_id: str,
        external_id: str,
        file_location: str,
        final_transcript: str | None,
        notes: str | None,
        status: TaskStatusEnum,
        speaker_gender: str | None,
        speaker_role: str | None,
        language: str | None,
        channel: str | None,
        duration_seconds: Any,
        custom_metadata: dict[str, Any],
        original_row: dict[str, Any],
    ) -> AnnotationTask:
        task = AnnotationTask(
            upload_job_id=upload_job_id,
            external_id=external_id,
            file_location=file_location,
            final_transcript=final_transcript,
            notes=notes,
            status=status,
            speaker_gender=speaker_gender,
            speaker_role=speaker_role,
            language=language,
            channel=channel,
            duration_seconds=duration_seconds,
            custom_metadata=custom_metadata,
            original_row=original_row,
            pii_annotations=[],
            last_saved_at=datetime.now(UTC),
        )
        self.db.add(task)
        self.db.flush()
        return task

    def add_transcript_variants(
        self,
        *,
        task_id: str,
        variants: list[dict[str, str]],
    ) -> None:
        for variant in variants:
            self.db.add(
                TaskTranscriptVariant(
                    task_id=task_id,
                    source_key=variant["source_key"],
                    source_label=variant["source_label"],
                    transcript_text=variant["transcript_text"],
                )
            )
        self.db.flush()

    def list_tasks(
        self,
        *,
        status: TaskStatusEnum | None,
        search: str | None,
        assignee_id: str | None,
        upload_job_id: str | None = None,
        language: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        page: int,
        page_size: int,
    ) -> tuple[list[AnnotationTask], int]:
        stmt = select(AnnotationTask).options(
            joinedload(AnnotationTask.assignee),
            joinedload(AnnotationTask.last_tagger),
        )
        count_stmt = select(func.count(AnnotationTask.id))

        filters = []
        if status:
            filters.append(AnnotationTask.status == status)
        if search:
            like_term = f"%{search}%"
            filters.append(
                or_(
                    AnnotationTask.external_id.ilike(like_term),
                    AnnotationTask.file_location.ilike(like_term),
                )
            )
        if assignee_id:
            if assignee_id == "unassigned":
                filters.append(AnnotationTask.assignee_id.is_(None))
            else:
                filters.append(AnnotationTask.assignee_id == assignee_id)
        if upload_job_id:
            filters.append(AnnotationTask.upload_job_id == upload_job_id)
        if language:
            filters.append(AnnotationTask.language == language)
        if date_from:
            filters.append(AnnotationTask.updated_at >= datetime.combine(date_from, datetime.min.time(), tzinfo=UTC))
        if date_to:
            filters.append(AnnotationTask.updated_at <= datetime.combine(date_to, datetime.max.time(), tzinfo=UTC))

        if filters:
            stmt = stmt.where(and_(*filters))
            count_stmt = count_stmt.where(and_(*filters))

        stmt = stmt.order_by(AnnotationTask.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)

        items = list(self.db.execute(stmt).scalars().all())
        total = self.db.execute(count_stmt).scalar_one()
        return items, int(total)

    def get_status_counts(self) -> dict[str, int]:
        stmt = select(AnnotationTask.status, func.count(AnnotationTask.id)).group_by(AnnotationTask.status)
        rows = self.db.execute(stmt).all()
        return {status.value: count for status, count in rows}

    def get_task(self, task_id: str) -> AnnotationTask | None:
        stmt = (
            select(AnnotationTask)
            .options(
                joinedload(AnnotationTask.transcript_variants),
                joinedload(AnnotationTask.assignee),
                joinedload(AnnotationTask.last_tagger),
            )
            .where(AnnotationTask.id == task_id)
        )
        return self.db.execute(stmt).unique().scalar_one_or_none()

    def get_prev_next_task_ids(self, task: AnnotationTask) -> tuple[str | None, str | None]:
        prev_stmt = (
            select(AnnotationTask.id)
            .where(AnnotationTask.created_at < task.created_at)
            .order_by(AnnotationTask.created_at.desc())
            .limit(1)
        )
        next_stmt = (
            select(AnnotationTask.id)
            .where(AnnotationTask.created_at > task.created_at)
            .order_by(AnnotationTask.created_at.asc())
            .limit(1)
        )
        prev_id = self.db.execute(prev_stmt).scalar_one_or_none()
        next_id = self.db.execute(next_stmt).scalar_one_or_none()
        return prev_id, next_id

    def get_next_unfinished_task(self) -> str | None:
        stmt = (
            select(AnnotationTask.id)
            .where(AnnotationTask.status != TaskStatusEnum.APPROVED)
            .order_by(AnnotationTask.updated_at.asc())
            .limit(1)
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def get_next_unassigned_task(self) -> AnnotationTask | None:
        stmt = (
            select(AnnotationTask)
            .options(
                joinedload(AnnotationTask.transcript_variants),
                joinedload(AnnotationTask.assignee),
                joinedload(AnnotationTask.last_tagger),
            )
            .where(AnnotationTask.status != TaskStatusEnum.APPROVED)
            .where(AnnotationTask.assignee_id.is_(None))
            .order_by(AnnotationTask.updated_at.asc())
            .limit(1)
        )
        return self.db.execute(stmt).unique().scalar_one_or_none()

    def list_activity(self, task_id: str) -> list[dict[str, Any]]:
        audit_stmt = (
            select(TaskAuditLog)
            .where(TaskAuditLog.task_id == task_id)
            .order_by(TaskAuditLog.created_at.asc())
        )
        status_stmt = (
            select(TaskStatusHistory)
            .where(TaskStatusHistory.task_id == task_id)
            .order_by(TaskStatusHistory.changed_at.asc())
        )
        audits = list(self.db.execute(audit_stmt).scalars().all())
        statuses = list(self.db.execute(status_stmt).scalars().all())
        actor_ids = {audit.actor_user_id for audit in audits}
        actor_ids.update(status.changed_by_id for status in statuses)
        users_by_id = {
            user.id: user
            for user in self.db.execute(select(User).where(User.id.in_(actor_ids))).scalars().all()
        } if actor_ids else {}
        items: list[dict[str, Any]] = []
        for audit in audits:
            actor = users_by_id.get(audit.actor_user_id)
            items.append(
                {
                    "id": audit.id,
                    "type": "audit",
                    "action": audit.action,
                    "actor_user_id": audit.actor_user_id,
                    "actor_email": actor.email if actor else None,
                    "actor_name": actor.full_name if actor else None,
                    "changed_at": audit.created_at,
                    "changed_fields": audit.changed_fields or {},
                    "previous_values": audit.previous_values or {},
                    "new_values": audit.new_values or {},
                }
            )
        for status in statuses:
            actor = users_by_id.get(status.changed_by_id)
            items.append(
                {
                    "id": status.id,
                    "type": "status",
                    "action": "STATUS_HISTORY",
                    "actor_user_id": status.changed_by_id,
                    "actor_email": actor.email if actor else None,
                    "actor_name": actor.full_name if actor else None,
                    "changed_at": status.changed_at,
                    "old_status": status.old_status,
                    "new_status": status.new_status,
                    "comment": status.comment,
                }
            )
        return sorted(items, key=lambda item: item["changed_at"])

    def save_task(self, task: AnnotationTask) -> AnnotationTask:
        task.version += 1
        task.last_saved_at = datetime.now(UTC)
        self.db.flush()
        return task

    def add_status_history(
        self,
        *,
        task_id: str,
        old_status: TaskStatusEnum | None,
        new_status: TaskStatusEnum,
        changed_by_id: str,
        comment: str | None,
    ) -> None:
        self.db.add(
            TaskStatusHistory(
                task_id=task_id,
                old_status=old_status,
                new_status=new_status,
                changed_by_id=changed_by_id,
                comment=comment,
            )
        )
        self.db.flush()

    def add_audit_log(
        self,
        *,
        task_id: str,
        actor_user_id: str,
        action: str,
        changed_fields: dict[str, Any],
        previous_values: dict[str, Any],
        new_values: dict[str, Any],
    ) -> None:
        self.db.add(
            TaskAuditLog(
                task_id=task_id,
                actor_user_id=actor_user_id,
                action=action,
                changed_fields=_json_safe(changed_fields),
                previous_values=_json_safe(previous_values),
                new_values=_json_safe(new_values),
            )
        )
        self.db.flush()
