from datetime import date, datetime

from pydantic import BaseModel

from app.models.enums import TaskStatusEnum


class MetricsFilters(BaseModel):
    status: TaskStatusEnum | None = None
    assignee_id: str | None = None
    job_id: str | None = None
    language: str | None = None
    date_from: date | None = None
    date_to: date | None = None


class MetricsOverview(BaseModel):
    total_tasks: int
    scored_tasks: int
    scored_pairs: int
    average_wer: float | None
    average_cer: float | None
    total_pii_annotations: int
    low_confidence_annotations: int
    overlap_warnings: int


class ModelTranscriptMetric(BaseModel):
    source_key: str
    source_label: str
    tasks_scored: int
    word_errors: int
    reference_words: int
    character_errors: int
    reference_characters: int
    average_wer: float | None
    average_cer: float | None


class PIIMetrics(BaseModel):
    total_annotations: int
    average_annotations_per_task: float
    low_confidence_annotations: int
    overlap_warnings: int
    by_label: dict[str, int]
    by_source: dict[str, int]


class TaggerMetric(BaseModel):
    user_id: str | None
    user_name: str | None
    user_email: str | None
    tasks_touched: int
    completed_tasks: int
    reviewed_tasks: int
    approved_tasks: int
    pii_annotations: int


class TaskSourceErrorMetric(BaseModel):
    source_key: str
    source_label: str
    wer: float | None
    cer: float | None
    word_errors: int
    reference_words: int
    character_errors: int
    reference_characters: int


class WorstTaskMetric(BaseModel):
    task_id: str
    external_id: str
    status: TaskStatusEnum
    language: str | None
    upload_job_id: str
    assignee_name: str | None
    last_tagger_name: str | None
    max_wer: float | None
    average_wer: float | None
    source_metrics: list[TaskSourceErrorMetric]


class AdminMetricsResponse(BaseModel):
    generated_at: datetime
    filters: MetricsFilters
    overview: MetricsOverview
    status_counts: dict[str, int]
    model_metrics: list[ModelTranscriptMetric]
    pii_metrics: PIIMetrics
    tagger_metrics: list[TaggerMetric]
    worst_tasks: list[WorstTaskMetric]
