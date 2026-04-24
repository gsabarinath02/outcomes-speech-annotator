from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.dependencies import get_db_session, require_roles
from app.models.enums import RoleEnum, TaskStatusEnum
from app.models.user import User
from app.schemas.job import ExportJobRequest, JobCreateResponse
from app.services.export_service import ExportService
from app.services.errors import ServiceError
from app.services.job_service import JobService

router = APIRouter(prefix="/exports", tags=["exports"])


def _http_error(exc: ServiceError) -> HTTPException:
    detail = {"message": exc.message}
    detail.update(exc.extra)
    return HTTPException(status_code=exc.status_code, detail=detail)


@router.get("/tasks")
def export_tasks(
    job_id: str | None = Query(default=None),
    format: str = Query(default="csv", pattern="^(csv|xlsx)$"),
    status: TaskStatusEnum | None = Query(default=None),
    assignee_id: str | None = Query(default=None),
    language: str | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    db: Session = Depends(get_db_session),
    _: User = Depends(require_roles(RoleEnum.ADMIN)),
):
    service = ExportService(db)
    try:
        payload, content_type = service.export_tasks(
            job_id=job_id,
            export_format=format,  # type: ignore[arg-type]
            status=status,
            assignee_id=assignee_id,
            language=language,
            date_from=date_from,
            date_to=date_to,
        )
    except ServiceError as exc:
        raise _http_error(exc) from exc

    filename = f"outcomes_ai_annotations_export.{format}"
    return Response(
        content=payload,
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/tasks/jobs", response_model=JobCreateResponse)
def enqueue_export_job(
    payload: ExportJobRequest,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(require_roles(RoleEnum.ADMIN)),
):
    service = JobService(db)
    try:
        job = service.enqueue_export_job(payload, current_user)
        return JobCreateResponse(job_id=job.id, status=job.status)
    except ServiceError as exc:
        raise _http_error(exc) from exc
