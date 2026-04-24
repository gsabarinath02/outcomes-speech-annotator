from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.dependencies import get_db_session, require_roles
from app.models.enums import RoleEnum
from app.models.user import User
from app.schemas.user import CreateUserRequest, UpdateUserRequest, UserAdminResponse, UserListResponse
from app.services.errors import ServiceError
from app.services.user_service import UserService

router = APIRouter(prefix="/users", tags=["users"])


def _http_error(exc: ServiceError) -> HTTPException:
    detail = {"message": exc.message}
    detail.update(exc.extra)
    return HTTPException(status_code=exc.status_code, detail=detail)


@router.get("", response_model=UserListResponse)
def list_users(
    db: Session = Depends(get_db_session),
    _: User = Depends(require_roles(RoleEnum.ADMIN)),
):
    service = UserService(db)
    return service.list_users()


@router.post("", response_model=UserAdminResponse)
def create_user(
    payload: CreateUserRequest,
    db: Session = Depends(get_db_session),
    _: User = Depends(require_roles(RoleEnum.ADMIN)),
):
    service = UserService(db)
    try:
        return service.create_user(
            email=str(payload.email),
            full_name=payload.full_name,
            password=payload.password,
            role=payload.role,
            is_active=payload.is_active,
        )
    except ServiceError as exc:
        raise _http_error(exc) from exc


@router.patch("/{user_id}", response_model=UserAdminResponse)
def update_user(
    user_id: str,
    payload: UpdateUserRequest,
    db: Session = Depends(get_db_session),
    _: User = Depends(require_roles(RoleEnum.ADMIN)),
):
    service = UserService(db)
    try:
        return service.update_user(
            user_id=user_id,
            full_name=payload.full_name,
            password=payload.password,
            role=payload.role,
            is_active=payload.is_active,
        )
    except ServiceError as exc:
        raise _http_error(exc) from exc
