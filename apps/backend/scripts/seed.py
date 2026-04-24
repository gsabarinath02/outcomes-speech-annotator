from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.enums import RoleEnum, TaskStatusEnum, UploadJobStatusEnum
from app.models.task import AnnotationTask, TaskStatusHistory, TaskTranscriptVariant
from app.models.upload import UploadFile, UploadJob
from app.models.user import User


def ensure_sample_audio_files() -> None:
    audio_dir = Path("/app/data/audio")
    audio_dir.mkdir(parents=True, exist_ok=True)
    for filename in ("out_0001.mp3", "out_0002.mp3"):
        audio_path = audio_dir / filename
        if not audio_path.exists():
            audio_path.write_bytes(b"ID3")


def upsert_user(session, email: str, full_name: str, password: str, role: RoleEnum) -> User:
    existing = session.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if existing:
        return existing
    user = User(
        email=email,
        full_name=full_name,
        password_hash=get_password_hash(password),
        role=role,
        is_active=True,
    )
    session.add(user)
    session.flush()
    return user


def seed() -> None:
    ensure_sample_audio_files()
    session = SessionLocal()
    try:
        admin = upsert_user(session, "admin@outcomes.ai", "outcomes.ai Admin", "Admin@123", RoleEnum.ADMIN)
        annotator = upsert_user(
            session,
            "annotator@outcomes.ai",
            "outcomes.ai Annotator",
            "Annotator@123",
            RoleEnum.ANNOTATOR,
        )
        reviewer = upsert_user(
            session,
            "reviewer@outcomes.ai",
            "outcomes.ai Reviewer",
            "Reviewer@123",
            RoleEnum.REVIEWER,
        )

        existing_task = session.execute(select(AnnotationTask).limit(1)).scalar_one_or_none()
        if existing_task:
            session.commit()
            print("Seed data already exists.")
            return

        upload_file = UploadFile(
            original_filename="sample_tasks.xlsx",
            stored_path="/app/data/uploads/sample_tasks.xlsx",
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            uploaded_by_id=admin.id,
        )
        session.add(upload_file)
        session.flush()

        upload_job = UploadJob(
            upload_file_id=upload_file.id,
            created_by_id=admin.id,
            status=UploadJobStatusEnum.IMPORTED,
            preview_row_count=2,
            validated_at=datetime.now(UTC),
            imported_at=datetime.now(UTC),
        )
        session.add(upload_job)
        session.flush()

        task_1 = AnnotationTask(
            upload_job_id=upload_job.id,
            external_id="OUT-0001",
            file_location="local:///app/data/audio/out_0001.mp3",
            final_transcript="",
            notes="Speaker role appears mislabeled; verify.",
            status=TaskStatusEnum.IN_PROGRESS,
            speaker_gender="female",
            speaker_role="caller",
            language="en",
            channel="mono",
            duration_seconds=Decimal("12.430"),
            custom_metadata={"accent": "unknown", "quality": "noisy"},
            original_row={
                "id": "OUT-0001",
                "file_location": "local:///app/data/audio/out_0001.mp3",
                "model_1_transcript": "hello i would like to check my booking",
                "model_2_transcript": "hello i'd like to check my booking",
            },
            assignee_id=annotator.id,
            last_tagger_id=annotator.id,
            last_saved_at=datetime.now(UTC),
        )
        session.add(task_1)
        session.flush()

        variants_1 = [
            TaskTranscriptVariant(
                task_id=task_1.id,
                source_key="whisper",
                source_label="Whisper",
                transcript_text="hello i would like to check my booking",
            ),
            TaskTranscriptVariant(
                task_id=task_1.id,
                source_key="qwen",
                source_label="Qwen",
                transcript_text="hello i'd like to check my booking",
            ),
        ]
        session.add_all(variants_1)
        session.add(
            TaskStatusHistory(
                task_id=task_1.id,
                old_status=None,
                new_status=TaskStatusEnum.IN_PROGRESS,
                changed_by_id=annotator.id,
                comment="Seeded initial task",
            )
        )

        task_2 = AnnotationTask(
            upload_job_id=upload_job.id,
            external_id="OUT-0002",
            file_location="local:///app/data/audio/out_0002.mp3",
            final_transcript="This is a sample corrected transcript.",
            notes="Language appears to be hi instead of en.",
            status=TaskStatusEnum.NEEDS_REVIEW,
            speaker_gender="male",
            speaker_role="agent",
            language="hi",
            channel="stereo",
            duration_seconds=Decimal("08.100"),
            custom_metadata={"region": "north"},
            original_row={
                "id": "OUT-0002",
                "file_location": "local:///app/data/audio/out_0002.mp3",
                "model_1_transcript": "sample asr text one",
                "model_2_transcript": "sample asr text won",
            },
            assignee_id=annotator.id,
            last_tagger_id=reviewer.id,
            last_saved_at=datetime.now(UTC),
        )
        session.add(task_2)
        session.flush()

        variants_2 = [
            TaskTranscriptVariant(
                task_id=task_2.id,
                source_key="granite",
                source_label="Granite",
                transcript_text="sample asr text one",
            ),
            TaskTranscriptVariant(
                task_id=task_2.id,
                source_key="cohere",
                source_label="Cohere",
                transcript_text="sample asr text won",
            ),
        ]
        session.add_all(variants_2)
        session.add(
            TaskStatusHistory(
                task_id=task_2.id,
                old_status=None,
                new_status=TaskStatusEnum.NEEDS_REVIEW,
                changed_by_id=reviewer.id,
                comment="Seeded initial task",
            )
        )

        session.commit()
        print("Seed complete.")
    finally:
        session.close()


if __name__ == "__main__":
    seed()
