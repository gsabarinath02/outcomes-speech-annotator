from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models.enums import RoleEnum, TaskStatusEnum
from app.models.task import AnnotationTask
from app.models.user import User
from app.repositories.task_repository import TaskRepository
from app.repositories.user_repository import UserRepository
from app.schemas.task import (
    BulkAssigneeError,
    BulkAssigneeItem,
    BulkAssigneeResponse,
    BulkAssigneeUpdated,
    CombinedTaskUpdateRequest,
    PIIAnnotation,
    TaskActivityItem,
    TaskActivityResponse,
    TaskDetailResponse,
    TaskListItemResponse,
    TaskListResponse,
    TaskPatchResponse,
)
from app.services.errors import ServiceError

ALLOWED_STATUS_TRANSITIONS: dict[TaskStatusEnum, set[TaskStatusEnum]] = {
    TaskStatusEnum.NOT_STARTED: {TaskStatusEnum.IN_PROGRESS},
    TaskStatusEnum.IN_PROGRESS: {TaskStatusEnum.NOT_STARTED, TaskStatusEnum.COMPLETED},
    TaskStatusEnum.COMPLETED: {TaskStatusEnum.IN_PROGRESS, TaskStatusEnum.NEEDS_REVIEW},
    TaskStatusEnum.NEEDS_REVIEW: {TaskStatusEnum.IN_PROGRESS, TaskStatusEnum.REVIEWED},
    TaskStatusEnum.REVIEWED: {TaskStatusEnum.IN_PROGRESS, TaskStatusEnum.APPROVED},
    TaskStatusEnum.APPROVED: {TaskStatusEnum.IN_PROGRESS},
}

AUTO_START_COMMENT = "Automatically moved to In Progress when work started"


class TaskService:
    def __init__(self, db: Session):
        self.db = db
        self.task_repo = TaskRepository(db)
        self.user_repo = UserRepository(db)

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
    ) -> TaskListResponse:
        items, total = self.task_repo.list_tasks(
            status=status,
            search=search,
            assignee_id=assignee_id,
            upload_job_id=upload_job_id,
            language=language,
            date_from=date_from,
            date_to=date_to,
            page=page,
            page_size=page_size,
        )
        counts = self.task_repo.get_status_counts()
        return TaskListResponse(
            items=[self._to_task_list_item(task) for task in items],
            page=page,
            page_size=page_size,
            total=total,
            status_counts=counts,
        )

    def get_task_detail(self, task_id: str) -> TaskDetailResponse:
        task = self._get_task_or_404(task_id)
        return self._to_task_detail(task)

    def get_next_task(self) -> str | None:
        return self.task_repo.get_next_unfinished_task()

    def save_combined_task(
        self,
        *,
        task_id: str,
        payload: CombinedTaskUpdateRequest,
        provided_fields: set[str],
        actor: User,
    ) -> TaskPatchResponse:
        task = self._get_task_or_404(task_id)
        update_fields = provided_fields - {"version", "comment"}
        if not update_fields:
            raise ServiceError("No task fields provided for update", status_code=422)
        self._ensure_version(task, payload.version, sorted(update_fields))

        previous_values: dict[str, Any] = {}
        new_values: dict[str, Any] = {}
        changed_fields: list[str] = []
        old_status = task.status
        status_changed = False

        simple_fields = {
            "final_transcript": payload.final_transcript,
            "notes": payload.notes,
            "speaker_gender": payload.speaker_gender,
            "speaker_role": payload.speaker_role,
            "language": payload.language,
            "channel": payload.channel,
            "duration_seconds": payload.duration_seconds,
            "custom_metadata": payload.custom_metadata,
        }

        for field_name, new_value in simple_fields.items():
            if field_name not in update_fields:
                continue
            old_value = getattr(task, field_name)
            if old_value != new_value:
                previous_values[field_name] = old_value
                new_values[field_name] = new_value
                setattr(task, field_name, new_value)
                changed_fields.append(field_name)

        if "status" in update_fields:
            if payload.status is None:
                raise ServiceError("Status cannot be null", status_code=422)
            self._validate_status_transition(task.status, payload.status, actor)
            if task.status != payload.status:
                previous_values["status"] = task.status.value
                new_values["status"] = payload.status.value
                task.status = payload.status
                changed_fields.append("status")
                status_changed = True

        if "pii_annotations" in update_fields:
            normalized_annotations = self._normalize_pii_annotations(
                pii_annotations=payload.pii_annotations or [],
                transcript=task.final_transcript or "",
            )
            if (task.pii_annotations or []) != normalized_annotations:
                previous_values["pii_annotations"] = task.pii_annotations or []
                new_values["pii_annotations"] = normalized_annotations
                task.pii_annotations = normalized_annotations
                changed_fields.append("pii_annotations")

        if not changed_fields:
            return TaskPatchResponse(task=self._to_task_detail(task))

        self._mark_tagger(task, actor)
        if "status" not in update_fields:
            auto_started_from = self._auto_start_task_if_needed(task, actor)
            if auto_started_from:
                previous_values["status"] = auto_started_from.value
                new_values["status"] = task.status.value
                changed_fields.append("status")
                old_status = auto_started_from
                status_changed = True
        task = self.task_repo.save_task(task)
        if status_changed:
            self.task_repo.add_status_history(
                task_id=task.id,
                old_status=old_status,
                new_status=task.status,
                changed_by_id=actor.id,
                comment=payload.comment if "status" in update_fields else AUTO_START_COMMENT,
            )
        self.task_repo.add_audit_log(
            task_id=task.id,
            actor_user_id=actor.id,
            action="UPDATE_TASK",
            changed_fields={field: True for field in changed_fields},
            previous_values=previous_values,
            new_values={**new_values, **({"comment": payload.comment} if payload.comment else {})},
        )
        self.db.commit()
        return TaskPatchResponse(task=self._to_task_detail(task))

    def update_transcript(
        self,
        *,
        task_id: str,
        version: int,
        final_transcript: str,
        actor: User,
    ) -> TaskPatchResponse:
        task = self._get_task_or_404(task_id)
        self._ensure_version(task, version, ["final_transcript"])
        previous = {"final_transcript": task.final_transcript}
        new_values = {"final_transcript": final_transcript}
        changed_fields = {"final_transcript": True}
        task.final_transcript = final_transcript
        self._mark_tagger(task, actor)
        auto_started_from = self._auto_start_task_if_needed(task, actor)
        if auto_started_from:
            previous["status"] = auto_started_from.value
            new_values["status"] = task.status.value
            changed_fields["status"] = True
        task = self.task_repo.save_task(task)
        self._add_auto_start_history_if_needed(task, actor, auto_started_from)
        self.task_repo.add_audit_log(
            task_id=task.id,
            actor_user_id=actor.id,
            action="UPDATE_TRANSCRIPT",
            changed_fields=changed_fields,
            previous_values=previous,
            new_values=new_values,
        )
        self.db.commit()
        return TaskPatchResponse(task=self._to_task_detail(task))

    def update_metadata(
        self,
        *,
        task_id: str,
        version: int,
        speaker_gender: str | None,
        speaker_role: str | None,
        language: str | None,
        channel: str | None,
        duration_seconds: Decimal | None,
        custom_metadata: dict[str, Any] | None,
        provided_fields: set[str] | None,
        actor: User,
    ) -> TaskPatchResponse:
        task = self._get_task_or_404(task_id)
        changed_fields = []
        previous_values: dict[str, Any] = {}
        new_values: dict[str, Any] = {}

        payload_fields = {
            "speaker_gender": speaker_gender,
            "speaker_role": speaker_role,
            "language": language,
            "channel": channel,
            "duration_seconds": duration_seconds,
            "custom_metadata": custom_metadata,
        }

        provided = set(payload_fields.keys()) if provided_fields is None else provided_fields
        included_fields = [key for key in payload_fields if key in provided]
        if not included_fields:
            raise ServiceError("No metadata fields provided for update", status_code=422)
        self._ensure_version(task, version, included_fields)

        for field_name, new_value in payload_fields.items():
            if field_name not in provided:
                continue
            old_value = getattr(task, field_name)
            if old_value != new_value:
                previous_values[field_name] = old_value
                new_values[field_name] = new_value
                setattr(task, field_name, new_value)
                changed_fields.append(field_name)

        if not changed_fields:
            return TaskPatchResponse(task=self._to_task_detail(task))

        self._mark_tagger(task, actor)
        auto_started_from = self._auto_start_task_if_needed(task, actor)
        if auto_started_from:
            previous_values["status"] = auto_started_from.value
            new_values["status"] = task.status.value
            changed_fields.append("status")
        task = self.task_repo.save_task(task)
        self._add_auto_start_history_if_needed(task, actor, auto_started_from)
        self.task_repo.add_audit_log(
            task_id=task.id,
            actor_user_id=actor.id,
            action="UPDATE_METADATA",
            changed_fields={field: True for field in changed_fields},
            previous_values=previous_values,
            new_values=new_values,
        )
        self.db.commit()
        return TaskPatchResponse(task=self._to_task_detail(task))

    def update_notes(
        self,
        *,
        task_id: str,
        version: int,
        notes: str | None,
        actor: User,
    ) -> TaskPatchResponse:
        task = self._get_task_or_404(task_id)
        self._ensure_version(task, version, ["notes"])
        previous = {"notes": task.notes}
        new_values = {"notes": notes}
        changed_fields = {"notes": True}
        task.notes = notes
        self._mark_tagger(task, actor)
        auto_started_from = self._auto_start_task_if_needed(task, actor)
        if auto_started_from:
            previous["status"] = auto_started_from.value
            new_values["status"] = task.status.value
            changed_fields["status"] = True
        task = self.task_repo.save_task(task)
        self._add_auto_start_history_if_needed(task, actor, auto_started_from)
        self.task_repo.add_audit_log(
            task_id=task.id,
            actor_user_id=actor.id,
            action="UPDATE_NOTES",
            changed_fields=changed_fields,
            previous_values=previous,
            new_values=new_values,
        )
        self.db.commit()
        return TaskPatchResponse(task=self._to_task_detail(task))

    def update_status(
        self,
        *,
        task_id: str,
        version: int,
        new_status: TaskStatusEnum,
        actor: User,
        comment: str | None = None,
    ) -> TaskPatchResponse:
        task = self._get_task_or_404(task_id)
        self._ensure_version(task, version, ["status"])
        old_status = task.status

        self._validate_status_transition(old_status, new_status, actor)

        task.status = new_status
        self._mark_tagger(task, actor)
        task = self.task_repo.save_task(task)
        self.task_repo.add_status_history(
            task_id=task.id,
            old_status=old_status,
            new_status=new_status,
            changed_by_id=actor.id,
            comment=comment,
        )
        self.task_repo.add_audit_log(
            task_id=task.id,
            actor_user_id=actor.id,
            action="UPDATE_STATUS",
            changed_fields={"status": True},
            previous_values={"status": old_status.value},
            new_values={"status": new_status.value, "comment": comment},
        )
        self.db.commit()
        return TaskPatchResponse(task=self._to_task_detail(task))

    def update_pii_annotations(
        self,
        *,
        task_id: str,
        version: int,
        pii_annotations: list[PIIAnnotation],
        actor: User,
    ) -> TaskPatchResponse:
        task = self._get_task_or_404(task_id)
        self._ensure_version(task, version, ["pii_annotations"])

        normalized_annotations = self._normalize_pii_annotations(
            pii_annotations=pii_annotations,
            transcript=task.final_transcript or "",
        )
        previous = {"pii_annotations": task.pii_annotations or []}

        if previous["pii_annotations"] == normalized_annotations:
            return TaskPatchResponse(task=self._to_task_detail(task))

        task.pii_annotations = normalized_annotations
        self._mark_tagger(task, actor)
        new_values = {"pii_annotations": normalized_annotations}
        changed_fields = {"pii_annotations": True}
        auto_started_from = self._auto_start_task_if_needed(task, actor)
        if auto_started_from:
            previous["status"] = auto_started_from.value
            new_values["status"] = task.status.value
            changed_fields["status"] = True
        task = self.task_repo.save_task(task)
        self._add_auto_start_history_if_needed(task, actor, auto_started_from)
        self.task_repo.add_audit_log(
            task_id=task.id,
            actor_user_id=actor.id,
            action="UPDATE_PII_ANNOTATIONS",
            changed_fields=changed_fields,
            previous_values=previous,
            new_values=new_values,
        )
        self.db.commit()
        return TaskPatchResponse(task=self._to_task_detail(task))

    def update_assignee(
        self,
        *,
        task_id: str,
        version: int,
        assignee_id: str | None,
        actor: User,
    ) -> TaskPatchResponse:
        task = self._get_task_or_404(task_id)
        self._ensure_version(task, version, ["assignee_id"])

        assignee = None
        if assignee_id:
            assignee = self.user_repo.get_by_id(assignee_id)
            if not assignee:
                raise ServiceError("Assignee user not found", status_code=404)
            if assignee.role not in {RoleEnum.ANNOTATOR, RoleEnum.REVIEWER, RoleEnum.ADMIN}:
                raise ServiceError("Assignee role is not valid for task assignment", status_code=422)

        if task.assignee_id == assignee_id:
            return TaskPatchResponse(task=self._to_task_detail(task))

        previous_values = {
            "assignee_id": task.assignee_id,
            "assignee_name": task.assignee.full_name if task.assignee else None,
            "assignee_email": task.assignee.email if task.assignee else None,
        }
        task.assignee_id = assignee_id
        task = self.task_repo.save_task(task)
        self.task_repo.add_audit_log(
            task_id=task.id,
            actor_user_id=actor.id,
            action="UPDATE_ASSIGNEE",
            changed_fields={"assignee_id": True},
            previous_values=previous_values,
            new_values={
                "assignee_id": assignee.id if assignee else None,
                "assignee_name": assignee.full_name if assignee else None,
                "assignee_email": assignee.email if assignee else None,
            },
        )
        self.db.commit()
        return TaskPatchResponse(task=self._to_task_detail(task))

    def claim_task(self, *, task_id: str, actor: User) -> TaskPatchResponse:
        task = self._get_task_or_404(task_id)
        if task.assignee_id:
            raise ServiceError("Task is already assigned", status_code=409)
        task.assignee_id = actor.id
        auto_started_from = self._auto_start_task_if_needed(task, actor)
        task = self.task_repo.save_task(task)
        self._add_auto_start_history_if_needed(task, actor, auto_started_from)
        self.task_repo.add_audit_log(
            task_id=task.id,
            actor_user_id=actor.id,
            action="CLAIM_TASK",
            changed_fields={
                "assignee_id": True,
                **({"status": True} if auto_started_from else {}),
            },
            previous_values={
                "assignee_id": None,
                **({"status": auto_started_from.value} if auto_started_from else {}),
            },
            new_values={
                "assignee_id": actor.id,
                "assignee_name": actor.full_name,
                "assignee_email": actor.email,
                **({"status": task.status.value} if auto_started_from else {}),
            },
        )
        self.db.commit()
        return TaskPatchResponse(task=self._to_task_detail(task))

    def claim_next_task(self, *, actor: User) -> TaskPatchResponse | None:
        task = self.task_repo.get_next_unassigned_task()
        if not task:
            return None
        return self.claim_task(task_id=task.id, actor=actor)

    def start_task(self, *, task_id: str, actor: User) -> TaskPatchResponse:
        task = self._get_task_or_404(task_id)
        if task.status == TaskStatusEnum.APPROVED:
            raise ServiceError("Approved tasks cannot be started", status_code=409)
        if task.assignee_id and task.assignee_id != actor.id:
            raise ServiceError("Task is assigned to another user", status_code=409)

        changed_fields: dict[str, bool] = {}
        previous_values: dict[str, Any] = {}
        new_values: dict[str, Any] = {}

        if task.assignee_id is None:
            task.assignee_id = actor.id
            changed_fields["assignee_id"] = True
            previous_values["assignee_id"] = None
            new_values.update(
                {
                    "assignee_id": actor.id,
                    "assignee_name": actor.full_name,
                    "assignee_email": actor.email,
                }
            )

        auto_started_from = self._auto_start_task_if_needed(task, actor)
        if auto_started_from:
            changed_fields["status"] = True
            previous_values["status"] = auto_started_from.value
            new_values["status"] = task.status.value

        if not changed_fields:
            return TaskPatchResponse(task=self._to_task_detail(task))

        task = self.task_repo.save_task(task)
        self._add_auto_start_history_if_needed(task, actor, auto_started_from)
        self.task_repo.add_audit_log(
            task_id=task.id,
            actor_user_id=actor.id,
            action="START_TASK",
            changed_fields=changed_fields,
            previous_values=previous_values,
            new_values=new_values,
        )
        self.db.commit()
        return TaskPatchResponse(task=self._to_task_detail(task))

    def bulk_update_assignees(self, *, assignments: list[BulkAssigneeItem], actor: User) -> BulkAssigneeResponse:
        updated: list[BulkAssigneeUpdated] = []
        errors: list[BulkAssigneeError] = []
        for item in assignments:
            try:
                response = self.update_assignee(
                    task_id=item.task_id,
                    version=item.version,
                    assignee_id=item.assignee_id,
                    actor=actor,
                )
                updated.append(BulkAssigneeUpdated(task=response.task))
            except ServiceError as exc:
                errors.append(BulkAssigneeError(task_id=item.task_id, status_code=exc.status_code, message=exc.message))
        return BulkAssigneeResponse(updated=updated, errors=errors)

    def get_activity(self, task_id: str) -> TaskActivityResponse:
        self._get_task_or_404(task_id)
        items = [TaskActivityItem(**item) for item in self.task_repo.list_activity(task_id)]
        return TaskActivityResponse(items=items)

    def generate_audio_url(self, task_id: str) -> tuple[str, int]:
        from itsdangerous import URLSafeTimedSerializer

        from app.core.config import get_settings

        task = self._get_task_or_404(task_id)
        settings = get_settings()
        serializer = URLSafeTimedSerializer(settings.audio_signing_secret)
        token = serializer.dumps({"task_id": task.id, "file_location": task.file_location})
        url = f"{settings.api_v1_prefix}/media/audio/{token}"
        return url, settings.audio_signing_expire_seconds

    def _get_task_or_404(self, task_id: str) -> AnnotationTask:
        task = self.task_repo.get_task(task_id)
        if not task:
            raise ServiceError("Task not found", status_code=404)
        return task

    def _to_task_detail(self, task: AnnotationTask) -> TaskDetailResponse:
        prev_task_id, next_task_id = self.task_repo.get_prev_next_task_ids(task)
        return TaskDetailResponse(
            id=task.id,
            external_id=task.external_id,
            file_location=task.file_location,
            final_transcript=task.final_transcript,
            notes=task.notes,
            status=task.status,
            speaker_gender=task.speaker_gender,
            speaker_role=task.speaker_role,
            language=task.language,
            channel=task.channel,
            duration_seconds=task.duration_seconds,
            custom_metadata=task.custom_metadata or {},
            original_row=task.original_row or {},
            pii_annotations=task.pii_annotations or [],
            assignee_id=task.assignee_id,
            assignee_name=task.assignee.full_name if task.assignee else None,
            assignee_email=task.assignee.email if task.assignee else None,
            last_tagger_id=task.last_tagger_id,
            last_tagger_name=task.last_tagger.full_name if task.last_tagger else None,
            last_tagger_email=task.last_tagger.email if task.last_tagger else None,
            version=task.version,
            created_at=task.created_at,
            updated_at=task.updated_at,
            last_saved_at=task.last_saved_at,
            transcript_variants=task.transcript_variants,
            prev_task_id=prev_task_id,
            next_task_id=next_task_id,
        )

    def _to_task_list_item(self, task: AnnotationTask) -> TaskListItemResponse:
        return TaskListItemResponse(
            id=task.id,
            external_id=task.external_id,
            file_location=task.file_location,
            status=task.status,
            assignee_id=task.assignee_id,
            assignee_name=task.assignee.full_name if task.assignee else None,
            assignee_email=task.assignee.email if task.assignee else None,
            last_tagger_id=task.last_tagger_id,
            last_tagger_name=task.last_tagger.full_name if task.last_tagger else None,
            last_tagger_email=task.last_tagger.email if task.last_tagger else None,
            updated_at=task.updated_at,
            last_saved_at=task.last_saved_at,
            language=task.language,
            speaker_role=task.speaker_role,
            version=task.version,
        )

    def _normalize_pii_annotations(
        self,
        *,
        pii_annotations: list[PIIAnnotation],
        transcript: str,
    ) -> list[dict[str, Any]]:
        normalized: list[dict[str, Any]] = []
        transcript_length = len(transcript)

        for annotation in pii_annotations:
            if annotation.end > transcript_length:
                raise ServiceError(
                    "PII annotation range exceeds transcript length",
                    status_code=422,
                )
            extracted_value = transcript[annotation.start : annotation.end]
            if not extracted_value.strip():
                raise ServiceError(
                    "PII annotation value cannot be empty",
                    status_code=422,
                )

            normalized.append(
                {
                    "id": annotation.id,
                    "label": annotation.label,
                    "start": annotation.start,
                    "end": annotation.end,
                    "value": extracted_value,
                    "source": annotation.source,
                    "confidence": annotation.confidence,
                }
            )

        normalized.sort(key=lambda item: (item["start"], item["end"], item["id"]))
        return normalized

    def _ensure_version(self, task: AnnotationTask, version: int, conflicting_fields: list[str]) -> None:
        if task.version != version:
            server_task = self._to_task_detail(task)
            raise ServiceError(
                "Conflict detected. The task has been updated by another user.",
                status_code=409,
                extra={
                    "conflicting_fields": conflicting_fields,
                    "server_task": server_task.model_dump(mode="json"),
                },
            )

    def _validate_status_transition(
        self,
        old_status: TaskStatusEnum,
        new_status: TaskStatusEnum,
        actor: User,
    ) -> None:
        if new_status == old_status:
            return
        allowed = ALLOWED_STATUS_TRANSITIONS.get(old_status, set())
        if new_status not in allowed:
            raise ServiceError(
                f"Invalid status transition from '{old_status.value}' to '{new_status.value}'",
                status_code=422,
            )
        if (
            new_status == TaskStatusEnum.IN_PROGRESS
            and old_status in {TaskStatusEnum.NEEDS_REVIEW, TaskStatusEnum.REVIEWED, TaskStatusEnum.APPROVED}
            and actor.role not in {RoleEnum.ADMIN, RoleEnum.REVIEWER}
        ):
            raise ServiceError(
                "Only reviewer/admin can move reviewed tasks back to In Progress",
                status_code=403,
            )

    def _auto_start_task_if_needed(self, task: AnnotationTask, actor: User) -> TaskStatusEnum | None:
        if task.status != TaskStatusEnum.NOT_STARTED:
            return None
        if actor.role not in {RoleEnum.ANNOTATOR, RoleEnum.REVIEWER}:
            return None
        old_status = task.status
        task.status = TaskStatusEnum.IN_PROGRESS
        return old_status

    def _add_auto_start_history_if_needed(
        self,
        task: AnnotationTask,
        actor: User,
        old_status: TaskStatusEnum | None,
    ) -> None:
        if not old_status:
            return
        self.task_repo.add_status_history(
            task_id=task.id,
            old_status=old_status,
            new_status=task.status,
            changed_by_id=actor.id,
            comment=AUTO_START_COMMENT,
        )

    def _mark_tagger(self, task: AnnotationTask, actor: User) -> None:
        task.last_tagger_id = actor.id
