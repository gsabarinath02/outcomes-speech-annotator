from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from app.models.enums import RoleEnum


class UserAdminResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    full_name: str
    role: RoleEnum
    is_active: bool
    created_at: datetime
    updated_at: datetime


class UserListResponse(BaseModel):
    items: list[UserAdminResponse]


class CreateUserRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=255)
    role: RoleEnum
    password: str = Field(min_length=8, max_length=128)
    is_active: bool = True


class UpdateUserRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=255)
    role: RoleEnum | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)
    is_active: bool | None = None

    @model_validator(mode="after")
    def validate_non_empty_update(self) -> "UpdateUserRequest":
        if (
            self.full_name is None
            and self.role is None
            and self.password is None
            and self.is_active is None
        ):
            raise ValueError("At least one field must be provided")
        return self
