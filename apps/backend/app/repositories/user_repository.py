from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.user import User


class UserRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_email(self, email: str) -> User | None:
        stmt = select(User).where(User.email == email.lower())
        return self.db.execute(stmt).scalar_one_or_none()

    def get_by_id(self, user_id: str) -> User | None:
        return self.db.get(User, user_id)

    def list_users(self) -> list[User]:
        stmt = select(User).order_by(User.full_name.asc())
        return list(self.db.execute(stmt).scalars().all())

    def create(self, *, email: str, full_name: str, password_hash: str, role: str) -> User:
        user = User(email=email.lower(), full_name=full_name, password_hash=password_hash, role=role)
        self.db.add(user)
        self.db.flush()
        return user
