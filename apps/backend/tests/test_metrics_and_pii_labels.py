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
