from sqlalchemy.orm import Session

from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    verify_password,
)
from app.models.user import User
from app.repositories.user_repository import UserRepository
from app.schemas.auth import TokenResponse, UserResponse
from app.services.errors import ServiceError
from app.services.rate_limit_service import LoginRateLimiter


class AuthService:
    def __init__(self, db: Session):
        self.db = db
        self.user_repo = UserRepository(db)
        self.rate_limiter = LoginRateLimiter()

    def login(self, email: str, password: str, client_host: str | None = None) -> TokenResponse:
        user = self.user_repo.get_by_email(email)
        if user and verify_password(password, user.password_hash):
            if not user.is_active:
                raise ServiceError("User account is inactive", status_code=403)
            self.rate_limiter.reset(email, client_host)
            return self._build_token_response(user)

        if self.rate_limiter.is_blocked(email, client_host):
            raise ServiceError("Too many failed login attempts. Try again later.", status_code=429)
        self.rate_limiter.record_failure(email, client_host)
        raise ServiceError("Invalid email or password", status_code=401)

    def refresh(self, refresh_token: str) -> TokenResponse:
        try:
            payload = decode_refresh_token(refresh_token)
        except ValueError as exc:
            raise ServiceError("Invalid refresh token", status_code=401) from exc
        if payload.get("type") != "refresh":
            raise ServiceError("Invalid refresh token type", status_code=401)
        user_id = payload.get("sub")
        if not user_id:
            raise ServiceError("Invalid refresh token payload", status_code=401)
        user = self.user_repo.get_by_id(user_id)
        if not user or not user.is_active:
            raise ServiceError("User no longer available", status_code=401)
        return self._build_token_response(user)

    def _build_token_response(self, user: User) -> TokenResponse:
        access_token = create_access_token(user.id, user.role.value)
        refresh_token = create_refresh_token(user.id, user.role.value)
        return TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            user=UserResponse.model_validate(user),
        )
