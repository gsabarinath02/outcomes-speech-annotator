from dataclasses import dataclass
from typing import Any


class ServiceError(Exception):
    def __init__(self, message: str, status_code: int = 400, extra: dict[str, Any] | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.extra = extra or {}


@dataclass
class ConflictPayload:
    conflicting_fields: list[str]
    server_task: Any
