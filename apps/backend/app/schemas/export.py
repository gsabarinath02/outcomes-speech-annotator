from typing import Literal

from pydantic import BaseModel


class ExportQueryParams(BaseModel):
    job_id: str | None = None
    format: Literal["csv", "xlsx"] = "csv"
