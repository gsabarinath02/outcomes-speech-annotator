from datetime import UTC, datetime

from app.services.audio_alignment_service import AudioAlignmentService, transcript_hash


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


def _create_task(client, auth_headers, sample_excel_bytes):
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
    tasks_response = client.get("/api/v1/tasks", headers=auth_headers["annotator"])
    task = tasks_response.json()["items"][0]
    return task["id"]


def test_transcript_and_metadata_updates(client, auth_headers, sample_excel_bytes):
    task_id = _create_task(client, auth_headers, sample_excel_bytes)
    detail_response = client.get(f"/api/v1/tasks/{task_id}", headers=auth_headers["annotator"])
    version = detail_response.json()["version"]

    transcript_response = client.patch(
        f"/api/v1/tasks/{task_id}/transcript",
        headers=auth_headers["annotator"],
        json={"version": version, "final_transcript": "Corrected transcript content"},
    )
    assert transcript_response.status_code == 200
    assert transcript_response.json()["task"]["last_tagger_email"] == "annotator@test.com"
    version = transcript_response.json()["task"]["version"]

    metadata_response = client.patch(
        f"/api/v1/tasks/{task_id}/metadata",
        headers=auth_headers["annotator"],
        json={
            "version": version,
            "speaker_gender": "non-binary",
            "custom_metadata": {"custom_tag": "UPDATED", "quality": "clean"},
        },
    )
    assert metadata_response.status_code == 200
    payload = metadata_response.json()["task"]
    assert payload["speaker_gender"] == "non-binary"
    assert payload["custom_metadata"]["quality"] == "clean"


def test_combined_task_save_updates_multiple_sections_once(client, auth_headers, sample_excel_bytes):
    task_id = _create_task(client, auth_headers, sample_excel_bytes)
    detail_response = client.get(f"/api/v1/tasks/{task_id}", headers=auth_headers["annotator"])
    version = detail_response.json()["version"]

    save_response = client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=auth_headers["annotator"],
        json={
            "version": version,
            "final_transcript": "Combined corrected transcript",
            "notes": "Combined save note",
            "speaker_gender": "female",
            "status": "In Progress",
        },
    )
    assert save_response.status_code == 200
    task = save_response.json()["task"]
    assert task["version"] == version + 1
    assert task["final_transcript"] == "Combined corrected transcript"
    assert task["notes"] == "Combined save note"
    assert task["status"] == "In Progress"
    assert task["last_tagger_email"] == "annotator@test.com"


def test_combined_task_save_returns_conflict_for_stale_version(client, auth_headers, sample_excel_bytes):
    task_id = _create_task(client, auth_headers, sample_excel_bytes)
    detail_response = client.get(f"/api/v1/tasks/{task_id}", headers=auth_headers["annotator"])
    version = detail_response.json()["version"]

    first_save = client.patch(
        f"/api/v1/tasks/{task_id}/notes",
        headers=auth_headers["annotator"],
        json={"version": version, "notes": "first"},
    )
    assert first_save.status_code == 200

    stale_save = client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=auth_headers["annotator"],
        json={"version": version, "final_transcript": "stale"},
    )
    assert stale_save.status_code == 409
    assert stale_save.json()["detail"]["conflicting_fields"] == ["final_transcript"]


def test_combined_task_save_noop_does_not_increment_version(client, auth_headers, sample_excel_bytes):
    task_id = _create_task(client, auth_headers, sample_excel_bytes)
    detail = client.get(f"/api/v1/tasks/{task_id}", headers=auth_headers["annotator"]).json()

    noop_save = client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=auth_headers["annotator"],
        json={
            "version": detail["version"],
            "final_transcript": detail["final_transcript"],
            "notes": detail["notes"],
        },
    )

    assert noop_save.status_code == 200
    assert noop_save.json()["task"]["version"] == detail["version"]


def test_first_edit_automatically_starts_not_started_task(client, auth_headers, sample_excel_bytes):
    task_id = _create_task(client, auth_headers, sample_excel_bytes)
    detail = client.get(f"/api/v1/tasks/{task_id}", headers=auth_headers["annotator"]).json()
    assert detail["status"] == "Not Started"

    notes_response = client.patch(
        f"/api/v1/tasks/{task_id}/notes",
        headers=auth_headers["annotator"],
        json={"version": detail["version"], "notes": "Started with first annotation note"},
    )

    assert notes_response.status_code == 200
    task = notes_response.json()["task"]
    assert task["status"] == "In Progress"
    assert task["version"] == detail["version"] + 1

    activity = client.get(f"/api/v1/tasks/{task_id}/activity", headers=auth_headers["annotator"])
    assert activity.status_code == 200
    assert any(
        item["type"] == "status"
        and item["old_status"] == "Not Started"
        and item["new_status"] == "In Progress"
        and item["comment"] == "Automatically moved to In Progress when work started"
        for item in activity.json()["items"]
    )


def test_metadata_update_requires_at_least_one_metadata_field(client, auth_headers, sample_excel_bytes):
    task_id = _create_task(client, auth_headers, sample_excel_bytes)
    detail_response = client.get(f"/api/v1/tasks/{task_id}", headers=auth_headers["annotator"])
    original_task = detail_response.json()

    metadata_response = client.patch(
        f"/api/v1/tasks/{task_id}/metadata",
        headers=auth_headers["annotator"],
        json={"version": original_task["version"]},
    )
    assert metadata_response.status_code == 422

    unchanged_response = client.get(f"/api/v1/tasks/{task_id}", headers=auth_headers["annotator"])
    unchanged_task = unchanged_response.json()
    assert unchanged_task["speaker_gender"] == original_task["speaker_gender"]
    assert unchanged_task["language"] == original_task["language"]
    assert unchanged_task["custom_metadata"] == original_task["custom_metadata"]


def test_metadata_update_can_audit_duration_changes(client, auth_headers, sample_excel_bytes):
    task_id = _create_task(client, auth_headers, sample_excel_bytes)
    detail_response = client.get(f"/api/v1/tasks/{task_id}", headers=auth_headers["annotator"])
    version = detail_response.json()["version"]

    metadata_response = client.patch(
        f"/api/v1/tasks/{task_id}/metadata",
        headers=auth_headers["annotator"],
        json={"version": version, "duration_seconds": 42.125},
    )
    assert metadata_response.status_code == 200
    assert metadata_response.json()["task"]["duration_seconds"] == 42.125


def test_optimistic_lock_conflict(client, auth_headers, sample_excel_bytes):
    task_id = _create_task(client, auth_headers, sample_excel_bytes)
    detail_response = client.get(f"/api/v1/tasks/{task_id}", headers=auth_headers["annotator"])
    version = detail_response.json()["version"]

    first_save = client.patch(
        f"/api/v1/tasks/{task_id}/notes",
        headers=auth_headers["annotator"],
        json={"version": version, "notes": "first save"},
    )
    assert first_save.status_code == 200

    stale_save = client.patch(
        f"/api/v1/tasks/{task_id}/notes",
        headers=auth_headers["annotator"],
        json={"version": version, "notes": "stale write"},
    )
    assert stale_save.status_code == 409
    detail = stale_save.json()["detail"]
    assert detail["conflicting_fields"] == ["notes"]
    assert "server_task" in detail


def test_status_transition_permission(client, auth_headers, sample_excel_bytes):
    task_id = _create_task(client, auth_headers, sample_excel_bytes)
    detail_response = client.get(f"/api/v1/tasks/{task_id}", headers=auth_headers["annotator"])
    version = detail_response.json()["version"]

    in_progress = client.patch(
        f"/api/v1/tasks/{task_id}/status",
        headers=auth_headers["annotator"],
        json={"version": version, "status": "In Progress"},
    )
    assert in_progress.status_code == 200
    version = in_progress.json()["task"]["version"]

    completed = client.patch(
        f"/api/v1/tasks/{task_id}/status",
        headers=auth_headers["annotator"],
        json={"version": version, "status": "Completed"},
    )
    assert completed.status_code == 200
    version = completed.json()["task"]["version"]

    needs_review = client.patch(
        f"/api/v1/tasks/{task_id}/status",
        headers=auth_headers["annotator"],
        json={"version": version, "status": "Needs Review"},
    )
    assert needs_review.status_code == 200
    version = needs_review.json()["task"]["version"]

    reviewed = client.patch(
        f"/api/v1/tasks/{task_id}/status",
        headers=auth_headers["reviewer"],
        json={"version": version, "status": "Reviewed"},
    )
    assert reviewed.status_code == 200
    version = reviewed.json()["task"]["version"]

    denied = client.patch(
        f"/api/v1/tasks/{task_id}/status",
        headers=auth_headers["annotator"],
        json={"version": version, "status": "In Progress"},
    )
    assert denied.status_code == 403


def test_pii_annotation_update(client, auth_headers, sample_excel_bytes):
    task_id = _create_task(client, auth_headers, sample_excel_bytes)
    detail_response = client.get(f"/api/v1/tasks/{task_id}", headers=auth_headers["annotator"])
    version = detail_response.json()["version"]

    transcript_response = client.patch(
        f"/api/v1/tasks/{task_id}/transcript",
        headers=auth_headers["annotator"],
        json={"version": version, "final_transcript": "Contact me at john.doe@test.com"},
    )
    assert transcript_response.status_code == 200
    version = transcript_response.json()["task"]["version"]

    pii_response = client.patch(
        f"/api/v1/tasks/{task_id}/pii",
        headers=auth_headers["annotator"],
        json={
            "version": version,
            "pii_annotations": [
                {
                    "id": "pii-1",
                    "label": "EMAIL",
                    "start": 14,
                    "end": 31,
                    "value": "john.doe@test.com",
                    "source": "manual",
                    "confidence": 0.98,
                }
            ],
        },
    )
    assert pii_response.status_code == 200
    updated_task = pii_response.json()["task"]
    assert len(updated_task["pii_annotations"]) == 1
    assert updated_task["pii_annotations"][0]["label"] == "EMAIL"
    assert updated_task["pii_annotations"][0]["value"] == "john.doe@test.com"
    assert updated_task["last_tagger_email"] == "annotator@test.com"


def test_alignment_and_masked_audio_endpoints(client, auth_headers, sample_excel_bytes, monkeypatch, tmp_path):
    task_id = _create_task(client, auth_headers, sample_excel_bytes)
    detail = client.get(f"/api/v1/tasks/{task_id}", headers=auth_headers["annotator"]).json()
    transcript_response = client.patch(
        f"/api/v1/tasks/{task_id}/transcript",
        headers=auth_headers["annotator"],
        json={"version": detail["version"], "final_transcript": "Call John now"},
    )
    version = transcript_response.json()["task"]["version"]
    pii_response = client.patch(
        f"/api/v1/tasks/{task_id}/pii",
        headers=auth_headers["annotator"],
        json={
            "version": version,
            "pii_annotations": [
                {
                    "id": "pii-1",
                    "label": "NAME",
                    "start": 5,
                    "end": 9,
                    "value": "John",
                    "source": "manual",
                    "confidence": None,
                }
            ],
        },
    )
    assert pii_response.status_code == 200

    def fake_align(self, task, force=False):
        words = [
            {
                "index": 0,
                "text": "Call",
                "normalized_text": "CALL",
                "start_char": 0,
                "end_char": 4,
                "start_seconds": 0.0,
                "end_seconds": 0.2,
                "score": 0.96,
            },
            {
                "index": 1,
                "text": "John",
                "normalized_text": "JOHN",
                "start_char": 5,
                "end_char": 9,
                "start_seconds": 0.22,
                "end_seconds": 0.5,
                "score": 0.94,
            },
        ]
        task.alignment_words = words
        task.alignment_transcript_hash = transcript_hash(task.final_transcript or "")
        task.alignment_model = "test-aligner"
        task.alignment_updated_at = datetime.now(UTC)
        return words

    def fake_mask(self, task, force=False):
        fake_path = tmp_path / "masked.wav"
        fake_path.write_bytes(b"RIFFmasked")
        task.alignment_words = fake_align(self, task, force=False)
        task.masked_audio_location = str(fake_path)
        task.masked_audio_pii_hash = "pii-hash"
        task.masked_audio_updated_at = datetime.now(UTC)
        return str(fake_path), [
            {
                "start_seconds": 0.18,
                "end_seconds": 0.54,
                "labels": ["NAME"],
                "text": "John",
            }
        ]

    monkeypatch.setattr(AudioAlignmentService, "align_task_audio", fake_align)
    monkeypatch.setattr(AudioAlignmentService, "build_pii_masked_audio", fake_mask)

    alignment = client.post(f"/api/v1/tasks/{task_id}/alignment", headers=auth_headers["annotator"])
    assert alignment.status_code == 200
    assert alignment.json()["words"][1]["text"] == "John"
    assert alignment.json()["model"] == "test-aligner"

    masked = client.post(f"/api/v1/tasks/{task_id}/mask-pii-audio", headers=auth_headers["annotator"])
    assert masked.status_code == 200
    payload = masked.json()
    assert payload["masked_audio_url"].startswith("/api/v1/media/audio/")
    assert payload["masked_intervals"] == [
        {
            "start_seconds": 0.18,
            "end_seconds": 0.54,
            "labels": ["NAME"],
            "text": "John",
        }
    ]


def test_admin_can_assign_task_to_user(client, auth_headers, sample_excel_bytes, seed_users):
    task_id = _create_task(client, auth_headers, sample_excel_bytes)
    detail_response = client.get(f"/api/v1/tasks/{task_id}", headers=auth_headers["admin"])
    version = detail_response.json()["version"]

    denied = client.patch(
        f"/api/v1/tasks/{task_id}/assignee",
        headers=auth_headers["annotator"],
        json={"version": version, "assignee_id": seed_users["reviewer"].id},
    )
    assert denied.status_code == 403

    assign_response = client.patch(
        f"/api/v1/tasks/{task_id}/assignee",
        headers=auth_headers["admin"],
        json={"version": version, "assignee_id": seed_users["reviewer"].id},
    )
    assert assign_response.status_code == 200
    payload = assign_response.json()["task"]
    assert payload["assignee_id"] == seed_users["reviewer"].id
    assert payload["assignee_email"] == "reviewer@test.com"


def test_unassigned_filter_claim_next_bulk_assignment_and_activity(client, auth_headers, sample_excel_bytes, seed_users):
    task_id = _create_task(client, auth_headers, sample_excel_bytes)

    unassigned = client.get("/api/v1/tasks?assignee_id=unassigned", headers=auth_headers["admin"])
    assert unassigned.status_code == 200
    assert unassigned.json()["total"] == 1

    claim = client.post(f"/api/v1/tasks/{task_id}/claim", headers=auth_headers["annotator"])
    assert claim.status_code == 200
    claimed_task = claim.json()["task"]
    assert claimed_task["assignee_email"] == "annotator@test.com"
    assert claimed_task["status"] == "In Progress"

    claim_again = client.post(f"/api/v1/tasks/{task_id}/claim", headers=auth_headers["reviewer"])
    assert claim_again.status_code == 409

    bulk = client.post(
        "/api/v1/tasks/bulk-assignee",
        headers=auth_headers["admin"],
        json={
            "assignments": [
                {
                    "task_id": task_id,
                    "version": claimed_task["version"],
                    "assignee_id": seed_users["reviewer"].id,
                }
            ]
        },
    )
    assert bulk.status_code == 200
    assert bulk.json()["updated"][0]["task"]["assignee_email"] == "reviewer@test.com"
    assert bulk.json()["errors"] == []

    activity = client.get(f"/api/v1/tasks/{task_id}/activity", headers=auth_headers["annotator"])
    assert activity.status_code == 200
    activity_types = {item["type"] for item in activity.json()["items"]}
    assert {"audit", "status"}.issubset(activity_types)
    assert any(item["actor_email"] == "annotator@test.com" for item in activity.json()["items"])


def test_start_endpoint_claims_and_marks_task_in_progress(client, auth_headers, sample_excel_bytes):
    task_id = _create_task(client, auth_headers, sample_excel_bytes)

    start = client.post(f"/api/v1/tasks/{task_id}/start", headers=auth_headers["annotator"])

    assert start.status_code == 200
    task = start.json()["task"]
    assert task["assignee_email"] == "annotator@test.com"
    assert task["status"] == "In Progress"

    repeat_start = client.post(f"/api/v1/tasks/{task_id}/start", headers=auth_headers["annotator"])
    assert repeat_start.status_code == 200
    assert repeat_start.json()["task"]["version"] == task["version"]


def test_next_claim_and_bulk_assignment_partial_conflicts(client, auth_headers, sample_excel_bytes, seed_users):
    task_id = _create_task(client, auth_headers, sample_excel_bytes)

    next_claim = client.post("/api/v1/tasks/next/claim", headers=auth_headers["reviewer"])
    assert next_claim.status_code == 200
    assert next_claim.json()["task"]["id"] == task_id
    assert next_claim.json()["task"]["assignee_email"] == "reviewer@test.com"

    empty_next = client.post("/api/v1/tasks/next/claim", headers=auth_headers["annotator"])
    assert empty_next.status_code == 404

    claimed = next_claim.json()["task"]
    bulk = client.post(
        "/api/v1/tasks/bulk-assignee",
        headers=auth_headers["admin"],
        json={
            "assignments": [
                {
                    "task_id": task_id,
                    "version": claimed["version"] - 1,
                    "assignee_id": seed_users["annotator"].id,
                },
                {
                    "task_id": "missing-task",
                    "version": 1,
                    "assignee_id": seed_users["annotator"].id,
                },
            ]
        },
    )
    assert bulk.status_code == 200
    assert bulk.json()["updated"] == []
    assert {error["status_code"] for error in bulk.json()["errors"]} == {404, 409}
