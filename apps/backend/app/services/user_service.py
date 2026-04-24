from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.enums import RoleEnum
from app.repositories.user_repository import UserRepository
from app.schemas.user import UserAdminResponse, UserListResponse
from app.services.errors import ServiceError


class UserService:
    def __init__(self, db: Session):
        self.db = db
        self.user_repo = UserRepository(db)

    def list_users(self) -> UserListResponse:
        users = self.user_repo.list_users()
        return UserListResponse(items=[UserAdminResponse.model_validate(user) for user in users])

    def create_user(
        self,
        *,
        email: str,
        full_name: str,
        password: str,
        role: RoleEnum,
        is_active: bool,
    ) -> UserAdminResponse:
        existing = self.user_repo.get_by_email(email)
        if existing:
            raise ServiceError("User with this email already exists", status_code=409)

        user = self.user_repo.create(
            email=email,
            full_name=full_name.strip(),
            password_hash=get_password_hash(password),
            role=role,
        )
        user.is_active = is_active
        self.db.commit()
        return UserAdminResponse.model_validate(user)

    def update_user(
        self,
        *,
        user_id: str,
        full_name: str | None,
        password: str | None,
        role: RoleEnum | None,
        is_active: bool | None,
    ) -> UserAdminResponse:
        user = self.user_repo.get_by_id(user_id)
        if not user:
            raise ServiceError("User not found", status_code=404)

        if full_name is not None:
            user.full_name = full_name.strip()
        if role is not None:
            user.role = role
        if password is not None:
            user.password_hash = get_password_hash(password)
        if is_active is not None:
            user.is_active = is_active

        self.db.commit()
        return UserAdminResponse.model_validate(user)
