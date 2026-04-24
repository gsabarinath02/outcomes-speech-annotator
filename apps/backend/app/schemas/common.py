from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class MessageResponse(BaseModel):
    message: str


class PaginationMeta(BaseModel):
    page: int
    page_size: int
    total: int


class APIError(BaseModel):
    detail: str
    extra: dict[str, Any] | None = None


class TimestampedModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    created_at: datetime
    updated_at: datetime
