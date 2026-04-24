from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user, get_db_session, require_roles
from app.models.enums import RoleEnum, TaskStatusEnum
from app.models.user import User
from app.schemas.task import (
    AudioURLResponse,
    BulkAssigneeRequest,
    BulkAssigneeResponse,
    CombinedTaskUpdateRequest,
    TaskActivityResponse,
    TaskAudioAlignmentResponse,
    TaskDetailResponse,
    TaskListResponse,
    TaskMaskedAudioResponse,
    TaskNextResponse,
    TaskPatchResponse,
    UpdateAssigneeRequest,
    UpdateMetadataRequest,
    UpdateNotesRequest,
    UpdatePIIAnnotationsRequest,
    UpdateStatusRequest,
    UpdateTranscriptRequest,
)
from app.services.errors import ServiceError
from app.services.task_service import TaskService

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _http_error(exc: ServiceError) -> HTTPException:
    detail = {"message": exc.message}
    detail.update(exc.extra)
    return HTTPException(status_code=exc.status_code, detail=detail)


@router.get("", response_model=TaskListResponse)
def list_tasks(
    status: TaskStatusEnum | None = Query(default=None),
    search: str | None = Query(default=None),
    assignee_id: str | None = Query(default=None),
    job_id: str | None = Query(default=None),
    language: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    db: Session = Depends(get_db_session),
    _: User = Depends(get_current_user),
):
    service = TaskService(db)
    return service.list_tasks(
        status=status,
        search=search,
        assignee_id=assignee_id,
        upload_job_id=job_id,
        language=language,
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size,
    )


@router.get("/next", response_model=TaskNextResponse)
def get_next_task(
    db: Session = Depends(get_db_session),
    _: User = Depends(get_current_user),
):
    service = TaskService(db)
    return TaskNextResponse(task_id=service.get_next_task())


@router.post("/next/claim", response_model=TaskPatchResponse)
def claim_next_task(
    db: Session = Depends(get_db_session),
    current_user: User = Depends(require_roles(RoleEnum.ANNOTATOR, RoleEnum.REVIEWER)),
):
    service = TaskService(db)
    try:
        response = service.claim_next_task(actor=current_user)
        if not response:
            raise HTTPException(status_code=404, detail={"message": "No unassigned tasks available"})
        return response
    except ServiceError as exc:
        raise _http_error(exc) from exc


@router.post("/bulk-assignee", response_model=BulkAssigneeResponse)
def bulk_update_assignees(
    payload: BulkAssigneeRequest,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(require_roles(RoleEnum.ADMIN)),
):
    service = TaskService(db)
    try:
        return service.bulk_update_assignees(assignments=payload.assignments, actor=current_user)
    except ServiceError as exc:
        raise _http_error(exc) from exc


@router.get("/{task_id}", response_model=TaskDetailResponse)
def get_task(
    task_id: str,
    db: Session = Depends(get_db_session),
    _: User = Depends(get_current_user),
):
    service = TaskService(db)
    try:
        return service.get_task_detail(task_id)
    except ServiceError as exc:
        raise _http_error(exc) from exc


@router.patch("/{task_id}", response_model=TaskPatchResponse)
def update_task(
    task_id: str,
    payload: CombinedTaskUpdateRequest,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    service = TaskService(db)
    try:
        return service.save_combined_task(
            task_id=task_id,
            payload=payload,
            provided_fields=set(payload.model_fields_set),
            actor=current_user,
        )
    except ServiceError as exc:
        raise _http_error(exc) from exc


@router.post("/{task_id}/claim", response_model=TaskPatchResponse)
def claim_task(
    task_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(require_roles(RoleEnum.ANNOTATOR, RoleEnum.REVIEWER)),
):
    service = TaskService(db)
    try:
        return service.claim_task(task_id=task_id, actor=current_user)
    except ServiceError as exc:
        raise _http_error(exc) from exc


@router.post("/{task_id}/start", response_model=TaskPatchResponse)
def start_task(
    task_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(require_roles(RoleEnum.ANNOTATOR, RoleEnum.REVIEWER)),
):
    service = TaskService(db)
    try:
        return service.start_task(task_id=task_id, actor=current_user)
    except ServiceError as exc:
        raise _http_error(exc) from exc


@router.get("/{task_id}/activity", response_model=TaskActivityResponse)
def get_task_activity(
    task_id: str,
    db: Session = Depends(get_db_session),
    _: User = Depends(get_current_user),
):
    service = TaskService(db)
    try:
        return service.get_activity(task_id)
    except ServiceError as exc:
        raise _http_error(exc) from exc


@router.post("/{task_id}/alignment", response_model=TaskAudioAlignmentResponse)
def generate_task_alignment(
    task_id: str,
    force: bool = Query(default=False),
    db: Session = Depends(get_db_session),
    _: User = Depends(get_current_user),
):
    service = TaskService(db)
    try:
        return service.generate_alignment(task_id, force=force)
    except ServiceError as exc:
        raise _http_error(exc) from exc


@router.post("/{task_id}/mask-pii-audio", response_model=TaskMaskedAudioResponse)
def mask_task_pii_audio(
    task_id: str,
    force: bool = Query(default=False),
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    service = TaskService(db)
    try:
        return service.generate_masked_pii_audio(task_id, actor=current_user, force=force)
    except ServiceError as exc:
        raise _http_error(exc) from exc


@router.patch("/{task_id}/transcript", response_model=TaskPatchResponse)
def update_transcript(
    task_id: str,
    payload: UpdateTranscriptRequest,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    service = TaskService(db)
    try:
        return service.update_transcript(
            task_id=task_id,
            version=payload.version,
            final_transcript=payload.final_transcript,
            actor=current_user,
        )
    except ServiceError as exc:
        raise _http_error(exc) from exc


@router.patch("/{task_id}/metadata", response_model=TaskPatchResponse)
def update_metadata(
    task_id: str,
    payload: UpdateMetadataRequest,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    service = TaskService(db)
    try:
        return service.update_metadata(
            task_id=task_id,
            version=payload.version,
            speaker_gender=payload.speaker_gender,
            speaker_role=payload.speaker_role,
            language=payload.language,
            channel=payload.channel,
            duration_seconds=payload.duration_seconds,
            custom_metadata=payload.custom_metadata,
            provided_fields=set(payload.model_fields_set) - {"version"},
            actor=current_user,
        )
    except ServiceError as exc:
        raise _http_error(exc) from exc


@router.patch("/{task_id}/notes", response_model=TaskPatchResponse)
def update_notes(
    task_id: str,
    payload: UpdateNotesRequest,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    service = TaskService(db)
    try:
        return service.update_notes(
            task_id=task_id,
            version=payload.version,
            notes=payload.notes,
            actor=current_user,
        )
    except ServiceError as exc:
        raise _http_error(exc) from exc


@router.patch("/{task_id}/status", response_model=TaskPatchResponse)
def update_status(
    task_id: str,
    payload: UpdateStatusRequest,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    service = TaskService(db)
    try:
        return service.update_status(
            task_id=task_id,
            version=payload.version,
            new_status=payload.status,
            actor=current_user,
            comment=payload.comment,
        )
    except ServiceError as exc:
        raise _http_error(exc) from exc


@router.patch("/{task_id}/pii", response_model=TaskPatchResponse)
def update_pii(
    task_id: str,
    payload: UpdatePIIAnnotationsRequest,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    service = TaskService(db)
    try:
        return service.update_pii_annotations(
            task_id=task_id,
            version=payload.version,
            pii_annotations=payload.pii_annotations,
            actor=current_user,
        )
    except ServiceError as exc:
        raise _http_error(exc) from exc


@router.patch("/{task_id}/assignee", response_model=TaskPatchResponse)
def update_assignee(
    task_id: str,
    payload: UpdateAssigneeRequest,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(require_roles(RoleEnum.ADMIN)),
):
    service = TaskService(db)
    try:
        return service.update_assignee(
            task_id=task_id,
            version=payload.version,
            assignee_id=payload.assignee_id,
            actor=current_user,
        )
    except ServiceError as exc:
        raise _http_error(exc) from exc


@router.get("/{task_id}/audio-url", response_model=AudioURLResponse)
def get_audio_url(
    task_id: str,
    db: Session = Depends(get_db_session),
    _: User = Depends(get_current_user),
):
    service = TaskService(db)
    try:
        url, expires = service.generate_audio_url(task_id)
        return AudioURLResponse(url=url, expires_in_seconds=expires)
    except ServiceError as exc:
        raise _http_error(exc) from exc
