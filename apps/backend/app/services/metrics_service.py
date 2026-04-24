import re
from collections import Counter, defaultdict
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.orm import Session, joinedload

from app.models.enums import TaskStatusEnum
from app.models.task import AnnotationTask
from app.schemas.metrics import (
    AdminMetricsResponse,
    MetricsFilters,
    MetricsOverview,
    ModelTranscriptMetric,
    PIIMetrics,
    TaggerMetric,
    TaskSourceErrorMetric,
    WorstTaskMetric,
)

LOW_CONFIDENCE_THRESHOLD = 0.8


def _normalize_transcript(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def _word_tokens(text: str) -> list[str]:
    normalized = _normalize_transcript(text)
    return normalized.split() if normalized else []


def _edit_distance(reference: list[Any] | str, hypothesis: list[Any] | str) -> int:
    previous = list(range(len(hypothesis) + 1))
    for row_index, reference_item in enumerate(reference, start=1):
        current = [row_index] + [0] * len(hypothesis)
        for column_index, hypothesis_item in enumerate(hypothesis, start=1):
            substitution_cost = 0 if reference_item == hypothesis_item else 1
            current[column_index] = min(
                previous[column_index] + 1,
                current[column_index - 1] + 1,
                previous[column_index - 1] + substitution_cost,
            )
        previous = current
    return previous[-1]


def _rounded_rate(errors: int, total: int) -> float | None:
    if total <= 0:
        return None
    return round(errors / total, 4)


def _safe_int(value: Any, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _safe_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _overlap_pair_count(annotations: list[dict[str, Any]]) -> int:
    count = 0
    sorted_annotations = sorted(
        annotations,
        key=lambda item: (_safe_int(item.get("start")), _safe_int(item.get("end"))),
    )
    for index, current in enumerate(sorted_annotations):
        current_start = _safe_int(current.get("start"))
        current_end = _safe_int(current.get("end"))
        for candidate in sorted_annotations[index + 1 :]:
            candidate_start = _safe_int(candidate.get("start"))
            candidate_end = _safe_int(candidate.get("end"))
            if candidate_start >= current_end:
                break
            if current_start < candidate_end and candidate_start < current_end:
                count += 1
    return count


class MetricsService:
    def __init__(self, db: Session):
        self.db = db

    def get_admin_metrics(
        self,
        *,
        status: TaskStatusEnum | None,
        assignee_id: str | None,
        upload_job_id: str | None,
        language: str | None,
        date_from: date | None,
        date_to: date | None,
    ) -> AdminMetricsResponse:
        filters = self._build_filters(
            status=status,
            assignee_id=assignee_id,
            upload_job_id=upload_job_id,
            language=language,
            date_from=date_from,
            date_to=date_to,
        )
        tasks = self._load_tasks(filters)
        status_counts = Counter(task.status.value for task in tasks)

        model_accumulators: dict[str, dict[str, Any]] = {}
        task_metrics: list[WorstTaskMetric] = []
        scored_task_ids: set[str] = set()
        scored_pairs = 0
        total_word_errors = 0
        total_reference_words = 0
        total_character_errors = 0
        total_reference_characters = 0

        for task in tasks:
            reference = task.final_transcript or ""
            reference_words = _word_tokens(reference)
            normalized_reference = _normalize_transcript(reference)
            if not reference_words and not normalized_reference:
                continue

            source_metrics: list[TaskSourceErrorMetric] = []
            for variant in task.transcript_variants:
                hypothesis = variant.transcript_text or ""
                hypothesis_words = _word_tokens(hypothesis)
                normalized_hypothesis = _normalize_transcript(hypothesis)
                word_errors = _edit_distance(reference_words, hypothesis_words)
                character_errors = _edit_distance(normalized_reference, normalized_hypothesis)
                reference_word_count = len(reference_words)
                reference_character_count = len(normalized_reference)
                wer = _rounded_rate(word_errors, reference_word_count)
                cer = _rounded_rate(character_errors, reference_character_count)

                accumulator = model_accumulators.setdefault(
                    variant.source_key,
                    {
                        "source_key": variant.source_key,
                        "source_label": variant.source_label,
                        "task_ids": set(),
                        "word_errors": 0,
                        "reference_words": 0,
                        "character_errors": 0,
                        "reference_characters": 0,
                    },
                )
                accumulator["task_ids"].add(task.id)
                accumulator["word_errors"] += word_errors
                accumulator["reference_words"] += reference_word_count
                accumulator["character_errors"] += character_errors
                accumulator["reference_characters"] += reference_character_count

                scored_task_ids.add(task.id)
                scored_pairs += 1
                total_word_errors += word_errors
                total_reference_words += reference_word_count
                total_character_errors += character_errors
                total_reference_characters += reference_character_count
                source_metrics.append(
                    TaskSourceErrorMetric(
                        source_key=variant.source_key,
                        source_label=variant.source_label,
                        wer=wer,
                        cer=cer,
                        word_errors=word_errors,
                        reference_words=reference_word_count,
                        character_errors=character_errors,
                        reference_characters=reference_character_count,
                    )
                )

            if source_metrics:
                wers = [metric.wer for metric in source_metrics if metric.wer is not None]
                task_metrics.append(
                    WorstTaskMetric(
                        task_id=task.id,
                        external_id=task.external_id,
                        status=task.status,
                        language=task.language,
                        upload_job_id=task.upload_job_id,
                        assignee_name=task.assignee.full_name if task.assignee else None,
                        last_tagger_name=task.last_tagger.full_name if task.last_tagger else None,
                        max_wer=max(wers) if wers else None,
                        average_wer=round(sum(wers) / len(wers), 4) if wers else None,
                        source_metrics=sorted(source_metrics, key=lambda item: item.source_label),
                    )
                )

        pii_metrics = self._build_pii_metrics(tasks)
        tagger_metrics = self._build_tagger_metrics(tasks)
        model_metrics = [
            ModelTranscriptMetric(
                source_key=item["source_key"],
                source_label=item["source_label"],
                tasks_scored=len(item["task_ids"]),
                word_errors=item["word_errors"],
                reference_words=item["reference_words"],
                character_errors=item["character_errors"],
                reference_characters=item["reference_characters"],
                average_wer=_rounded_rate(item["word_errors"], item["reference_words"]),
                average_cer=_rounded_rate(item["character_errors"], item["reference_characters"]),
            )
            for item in model_accumulators.values()
        ]
        model_metrics.sort(key=lambda item: item.source_label.lower())
        task_metrics.sort(key=lambda item: item.max_wer if item.max_wer is not None else -1, reverse=True)

        return AdminMetricsResponse(
            generated_at=datetime.now(UTC),
            filters=MetricsFilters(
                status=status,
                assignee_id=assignee_id,
                job_id=upload_job_id,
                language=language,
                date_from=date_from,
                date_to=date_to,
            ),
            overview=MetricsOverview(
                total_tasks=len(tasks),
                scored_tasks=len(scored_task_ids),
                scored_pairs=scored_pairs,
                average_wer=_rounded_rate(total_word_errors, total_reference_words),
                average_cer=_rounded_rate(total_character_errors, total_reference_characters),
                total_pii_annotations=pii_metrics.total_annotations,
                low_confidence_annotations=pii_metrics.low_confidence_annotations,
                overlap_warnings=pii_metrics.overlap_warnings,
            ),
            status_counts=dict(status_counts),
            model_metrics=model_metrics,
            pii_metrics=pii_metrics,
            tagger_metrics=tagger_metrics,
            worst_tasks=task_metrics[:25],
        )

    def _load_tasks(self, filters: list[Any]) -> list[AnnotationTask]:
        stmt = (
            select(AnnotationTask)
            .options(
                joinedload(AnnotationTask.transcript_variants),
                joinedload(AnnotationTask.assignee),
                joinedload(AnnotationTask.last_tagger),
            )
            .order_by(AnnotationTask.updated_at.desc())
        )
        if filters:
            stmt = stmt.where(and_(*filters))
        return list(self.db.execute(stmt).unique().scalars().all())

    def _build_filters(
        self,
        *,
        status: TaskStatusEnum | None,
        assignee_id: str | None,
        upload_job_id: str | None,
        language: str | None,
        date_from: date | None,
        date_to: date | None,
    ) -> list[Any]:
        filters: list[Any] = []
        if status:
            filters.append(AnnotationTask.status == status)
        if assignee_id:
            if assignee_id == "unassigned":
                filters.append(AnnotationTask.assignee_id.is_(None))
            else:
                filters.append(AnnotationTask.assignee_id == assignee_id)
        if upload_job_id:
            filters.append(AnnotationTask.upload_job_id == upload_job_id)
        if language:
            filters.append(AnnotationTask.language == language)
        if date_from:
            filters.append(AnnotationTask.updated_at >= datetime.combine(date_from, datetime.min.time(), tzinfo=UTC))
        if date_to:
            filters.append(AnnotationTask.updated_at <= datetime.combine(date_to, datetime.max.time(), tzinfo=UTC))
        return filters

    def _build_pii_metrics(self, tasks: list[AnnotationTask]) -> PIIMetrics:
        by_label: Counter[str] = Counter()
        by_source: Counter[str] = Counter()
        total = 0
        low_confidence = 0
        overlaps = 0

        for task in tasks:
            annotations = task.pii_annotations or []
            total += len(annotations)
            overlaps += _overlap_pair_count(annotations)
            for annotation in annotations:
                by_label[str(annotation.get("label") or "OTHER")] += 1
                by_source[str(annotation.get("source") or "manual")] += 1
                confidence = _safe_float(annotation.get("confidence"))
                if confidence is not None and confidence < LOW_CONFIDENCE_THRESHOLD:
                    low_confidence += 1

        return PIIMetrics(
            total_annotations=total,
            average_annotations_per_task=round(total / len(tasks), 2) if tasks else 0,
            low_confidence_annotations=low_confidence,
            overlap_warnings=overlaps,
            by_label=dict(sorted(by_label.items())),
            by_source=dict(sorted(by_source.items())),
        )

    def _build_tagger_metrics(self, tasks: list[AnnotationTask]) -> list[TaggerMetric]:
        grouped: dict[str | None, dict[str, Any]] = defaultdict(
            lambda: {
                "user_id": None,
                "user_name": None,
                "user_email": None,
                "tasks_touched": 0,
                "completed_tasks": 0,
                "reviewed_tasks": 0,
                "approved_tasks": 0,
                "pii_annotations": 0,
            }
        )

        for task in tasks:
            key = task.last_tagger_id
            if not key:
                continue
            item = grouped[key]
            item["user_id"] = task.last_tagger_id
            item["user_name"] = task.last_tagger.full_name if task.last_tagger else None
            item["user_email"] = task.last_tagger.email if task.last_tagger else None
            item["tasks_touched"] += 1
            item["pii_annotations"] += len(task.pii_annotations or [])
            if task.status in {TaskStatusEnum.COMPLETED, TaskStatusEnum.NEEDS_REVIEW}:
                item["completed_tasks"] += 1
            if task.status == TaskStatusEnum.REVIEWED:
                item["reviewed_tasks"] += 1
            if task.status == TaskStatusEnum.APPROVED:
                item["approved_tasks"] += 1

        metrics = [TaggerMetric(**item) for item in grouped.values()]
        metrics.sort(key=lambda item: item.tasks_touched, reverse=True)
        return metrics
