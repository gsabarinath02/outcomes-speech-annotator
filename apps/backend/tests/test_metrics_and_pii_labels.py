from app.models.enums import TaskStatusEnum, UploadJobStatusEnum
from app.models.task import AnnotationTask, TaskTranscriptVariant
from app.models.upload import UploadFile, UploadJob


def _mapping():
    return {
        "id_column": "id",
        "file_location_column": "file_location",
        "transcript_columns": [
            {"source_key": "whisper", "column_name": "model_1_transcript", "source_label": "Whisper"},
            {"source_key": "qwen", "column_name": "model_2_transcript", "source_label": "Qwen"},
        ],
        "notes_column": "notes",
        "core_metadata_columns": {
            "speaker_gender": "speaker_gender",
            "language": "language",
        },
    }


def _import_sample_tasks(client, auth_headers, sample_excel_bytes):
    upload_response = client.post(
        "/api/v1/uploads",
        headers=auth_headers["admin"],
        files={
            "file": (
                "tasks.xlsx",
                sample_excel_bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    upload_job_id = upload_response.json()["upload_job_id"]
    client.post(f"/api/v1/uploads/{upload_job_id}/validate", headers=auth_headers["admin"], json=_mapping())
    client.post(f"/api/v1/uploads/{upload_job_id}/import", headers=auth_headers["admin"], json=_mapping())
    tasks = client.get("/api/v1/tasks", headers=auth_headers["admin"]).json()["items"]
    return upload_job_id, tasks


def _create_metrics_upload_job(db_session, admin_user):
    upload_file = UploadFile(
        original_filename="metrics.xlsx",
        stored_path="/tmp/metrics.xlsx",
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        uploaded_by_id=admin_user.id,
    )
    db_session.add(upload_file)
    db_session.flush()
    upload_job = UploadJob(
        upload_file_id=upload_file.id,
        created_by_id=admin_user.id,
        status=UploadJobStatusEnum.IMPORTED,
    )
    db_session.add(upload_job)
    db_session.flush()
    return upload_job


def _create_metrics_task(
    db_session,
    *,
    upload_job,
    external_id,
    final_transcript,
    variants,
    pii_annotations=None,
    language="en",
    status=TaskStatusEnum.COMPLETED,
    last_tagger_id=None,
):
    task = AnnotationTask(
        upload_job_id=upload_job.id,
        external_id=external_id,
        file_location=f"local:///{external_id}.wav",
        final_transcript=final_transcript,
        notes=None,
        status=status,
        language=language,
        custom_metadata={},
        original_row={},
        pii_annotations=pii_annotations or [],
        last_tagger_id=last_tagger_id,
    )
    db_session.add(task)
    db_session.flush()
    for source_key, source_label, transcript_text in variants:
        db_session.add(
            TaskTranscriptVariant(
                task_id=task.id,
                source_key=source_key,
                source_label=source_label,
                transcript_text=transcript_text,
            )
        )
    db_session.flush()
    return task


def test_admin_can_manage_pii_labels_and_taggers_get_active_labels(client, auth_headers):
    defaults = client.get("/api/v1/pii-labels", headers=auth_headers["annotator"])
    assert defaults.status_code == 200
    assert "EMAIL" in {item["key"] for item in defaults.json()["items"]}

    denied = client.post(
        "/api/v1/pii-labels",
        headers=auth_headers["annotator"],
        json={"key": "PASSPORT", "display_name": "Passport", "color": "#0f766e"},
    )
    assert denied.status_code == 403

    created = client.post(
        "/api/v1/pii-labels",
        headers=auth_headers["admin"],
        json={"key": "PASSPORT", "display_name": "Passport", "color": "#0f766e"},
    )
    assert created.status_code == 200
    label = created.json()
    assert label["key"] == "PASSPORT"
    assert label["is_active"] is True

    deactivated = client.patch(
        f"/api/v1/pii-labels/{label['id']}",
        headers=auth_headers["admin"],
        json={"is_active": False},
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["is_active"] is False

    active = client.get("/api/v1/pii-labels", headers=auth_headers["reviewer"]).json()["items"]
    assert "PASSPORT" not in {item["key"] for item in active}

    admin_list = client.get("/api/v1/pii-labels/admin", headers=auth_headers["admin"]).json()["items"]
    passport = next(item for item in admin_list if item["key"] == "PASSPORT")
    assert passport["is_active"] is False


def test_admin_metrics_compare_model_transcripts_against_corrected_ground_truth(
    client,
    auth_headers,
    sample_excel_bytes,
):
    _, tasks = _import_sample_tasks(client, auth_headers, sample_excel_bytes)
    task_id = next(task["id"] for task in tasks if task["external_id"] == "ROW-001")
    detail = client.get(f"/api/v1/tasks/{task_id}", headers=auth_headers["annotator"]).json()

    save = client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=auth_headers["annotator"],
        json={
            "version": detail["version"],
            "final_transcript": "hello from model one",
            "pii_annotations": [
                {
                    "id": "pii-1",
                    "label": "NAME",
                    "start": 0,
                    "end": 5,
                    "value": "hello",
                    "source": "manual",
                    "confidence": None,
                }
            ],
        },
    )
    assert save.status_code == 200

    response = client.get("/api/v1/metrics/admin?language=en", headers=auth_headers["admin"])
    assert response.status_code == 200
    payload = response.json()
    assert payload["overview"]["total_tasks"] == 1
    assert payload["overview"]["scored_tasks"] == 1
    assert payload["pii_metrics"]["total_annotations"] == 1
    assert payload["pii_metrics"]["by_label"]["NAME"] == 1

    model_metrics = {item["source_key"]: item for item in payload["model_metrics"]}
    assert model_metrics["whisper"]["tasks_scored"] == 1
    assert model_metrics["whisper"]["average_wer"] == 0
    assert model_metrics["whisper"]["average_cer"] == 0
    assert model_metrics["qwen"]["tasks_scored"] == 1
    assert model_metrics["qwen"]["word_errors"] == 1
    assert model_metrics["qwen"]["reference_words"] == 4
    assert model_metrics["qwen"]["average_wer"] == 0.25

    tagger = next(item for item in payload["tagger_metrics"] if item["user_email"] == "annotator@test.com")
    assert tagger["tasks_touched"] == 1
    assert tagger["pii_annotations"] == 1


def test_metrics_endpoint_is_admin_only(client, auth_headers):
    response = client.get("/api/v1/metrics/admin", headers=auth_headers["annotator"])
    assert response.status_code == 403


def test_admin_metrics_use_weighted_edit_rates_and_real_pii_counts(
    client,
    auth_headers,
    db_session,
    seed_users,
):
    upload_job = _create_metrics_upload_job(db_session, seed_users["admin"])
    task_one = _create_metrics_task(
        db_session,
        upload_job=upload_job,
        external_id="MET-001",
        final_transcript="ab cd",
        variants=[
            ("model_a", "Model A", "ab cd"),
            ("model_b", "Model B", "ab"),
        ],
        pii_annotations=[
            {
                "id": "pii-1",
                "label": "NAME",
                "start": 0,
                "end": 2,
                "value": "ab",
                "source": "manual",
                "confidence": 0.95,
            },
            {
                "id": "pii-2",
                "label": "EMAIL",
                "start": 1,
                "end": 4,
                "value": "b c",
                "source": "auto",
                "confidence": 0.5,
            },
            {
                "id": "pii-3",
                "label": "PHONE",
                "start": 4,
                "end": 5,
                "value": "d",
                "source": "manual",
                "confidence": None,
            },
        ],
        status=TaskStatusEnum.COMPLETED,
        last_tagger_id=seed_users["annotator"].id,
    )
    task_two = _create_metrics_task(
        db_session,
        upload_job=upload_job,
        external_id="MET-002",
        final_transcript="ef",
        variants=[
            ("model_a", "Model A", "ef gh"),
            ("model_b", "Model B", "zz"),
        ],
        pii_annotations=[
            {
                "id": "pii-4",
                "label": "NAME",
                "start": 0,
                "end": 1,
                "value": "e",
                "source": None,
                "confidence": None,
            }
        ],
        status=TaskStatusEnum.REVIEWED,
        last_tagger_id=seed_users["annotator"].id,
    )
    _create_metrics_task(
        db_session,
        upload_job=upload_job,
        external_id="MET-003",
        final_transcript="",
        variants=[("model_a", "Model A", "ignored because reference is empty")],
        pii_annotations=[],
        status=TaskStatusEnum.APPROVED,
        last_tagger_id=seed_users["reviewer"].id,
    )
    db_session.commit()

    response = client.get("/api/v1/metrics/admin?language=en", headers=auth_headers["admin"])
    assert response.status_code == 200
    payload = response.json()

    assert payload["overview"]["total_tasks"] == 3
    assert payload["overview"]["scored_tasks"] == 2
    assert payload["overview"]["scored_pairs"] == 4
    assert payload["overview"]["average_wer"] == 0.5
    assert payload["overview"]["average_cer"] == 0.5714

    model_metrics = {item["source_key"]: item for item in payload["model_metrics"]}
    assert model_metrics["model_a"]["tasks_scored"] == 2
    assert model_metrics["model_a"]["word_errors"] == 1
    assert model_metrics["model_a"]["reference_words"] == 3
    assert model_metrics["model_a"]["average_wer"] == 0.3333
    assert model_metrics["model_a"]["character_errors"] == 3
    assert model_metrics["model_a"]["reference_characters"] == 7
    assert model_metrics["model_a"]["average_cer"] == 0.4286
    assert model_metrics["model_b"]["word_errors"] == 2
    assert model_metrics["model_b"]["reference_words"] == 3
    assert model_metrics["model_b"]["average_wer"] == 0.6667
    assert model_metrics["model_b"]["character_errors"] == 5
    assert model_metrics["model_b"]["reference_characters"] == 7
    assert model_metrics["model_b"]["average_cer"] == 0.7143

    pii_metrics = payload["pii_metrics"]
    assert pii_metrics["total_annotations"] == 4
    assert pii_metrics["average_annotations_per_task"] == 1.33
    assert pii_metrics["low_confidence_annotations"] == 1
    assert pii_metrics["overlap_warnings"] == 1
    assert pii_metrics["by_label"] == {"EMAIL": 1, "NAME": 2, "PHONE": 1}
    assert pii_metrics["by_source"] == {"auto": 1, "manual": 3}

    tagger_metrics = {item["user_email"]: item for item in payload["tagger_metrics"]}
    assert tagger_metrics["annotator@test.com"]["tasks_touched"] == 2
    assert tagger_metrics["annotator@test.com"]["completed_tasks"] == 1
    assert tagger_metrics["annotator@test.com"]["reviewed_tasks"] == 1
    assert tagger_metrics["annotator@test.com"]["pii_annotations"] == 4
    assert tagger_metrics["reviewer@test.com"]["approved_tasks"] == 1

    worst_tasks = payload["worst_tasks"]
    assert worst_tasks[0]["task_id"] == task_two.id
    assert worst_tasks[0]["max_wer"] == 1
    assert worst_tasks[0]["average_wer"] == 1
    assert worst_tasks[1]["task_id"] == task_one.id
    assert worst_tasks[1]["max_wer"] == 0.5
    assert worst_tasks[1]["average_wer"] == 0.25
