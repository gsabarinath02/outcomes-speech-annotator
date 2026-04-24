from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user, get_db_session
from app.models.user import User
from app.schemas.auth import LoginRequest, RefreshRequest, TokenResponse, UserResponse
from app.services.auth_service import AuthService
from app.services.errors import ServiceError

router = APIRouter(prefix="/auth", tags=["auth"])


def _http_error(exc: ServiceError) -> HTTPException:
    detail = {"message": exc.message}
    detail.update(exc.extra)
    return HTTPException(status_code=exc.status_code, detail=detail)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db_session)):
    service = AuthService(db)
    try:
        return service.login(payload.email, payload.password, request.client.host if request.client else None)
    except ServiceError as exc:
        raise _http_error(exc) from exc


@router.post("/refresh", response_model=TokenResponse)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db_session)):
    service = AuthService(db)
    try:
        return service.refresh(payload.refresh_token)
    except ServiceError as exc:
        raise _http_error(exc) from exc


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return current_user
